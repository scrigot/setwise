"""Read-only, fixed-host food lookups. No personal diary, photos or credentials sent."""
import json
import re
import threading
import time
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, build_opener, HTTPRedirectHandler

from .nutrition import NUTRIENTS, validate_food
from .store import DomainError, now, text_field


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None  # Fixed providers only; never follow a provider redirect to another URL.


class FoodSources:
    def __init__(self):
        self.cache = {}
        self.lock = threading.Lock()

    def _get(self, url):
        with self.lock:
            cached = self.cache.get(url)
            if cached and time.monotonic() - cached[0] < 1800:
                return cached[1]
            try:
                request = Request(url, headers={'User-Agent': 'Setwise/0.2 (local personal nutrition journal)', 'Accept': 'application/json'})
                with build_opener(NoRedirect()).open(request, timeout=12) as response:
                    # Follow no redirects to an unrelated host.
                    from urllib.parse import urlsplit
                    if urlsplit(response.url).hostname != urlsplit(url).hostname:
                        raise DomainError('food_source_unavailable', 'Food source redirected unexpectedly.', 502)
                    raw = response.read(2_000_001)
                    if len(raw) > 2_000_000:
                        raise ValueError('Oversized response')
                    data = json.loads(raw)
                    if not isinstance(data, dict):
                        raise ValueError('Unexpected response')
            except HTTPError as exc:
                if exc.code == 429:
                    raise DomainError('food_source_limit', 'Food lookup limit reached. Use a label or saved food, or retry later. USDA demo access allows 30 requests/hour and 50/day per IP.', 429)
                if exc.code == 404:
                    raise DomainError('food_not_found', 'No product found for this barcode.', 404)
                raise DomainError('food_source_unavailable', 'Food source is unavailable. Your journal is unchanged.', 502)
            except (URLError, TimeoutError, OSError, ValueError):
                raise DomainError('food_source_unavailable', 'Food source could not be read. Use a label or retry later.', 502)
            if len(self.cache) >= 100:
                self.cache.pop(next(iter(self.cache)))
            self.cache[url] = (time.monotonic(), data)
            return data

    def search(self, query, page=1):
        query = text_field(query, 'food query', 120)
        if type(page) is not int or not 1 <= page <= 100:
            raise DomainError('invalid_input', 'Food search page must be 1–100.')
        params = urlencode({'api_key': 'DEMO_KEY', 'query': query, 'pageSize': 10, 'pageNumber': page})
        data = self._get('https://api.nal.usda.gov/fdc/v1/foods/search?' + params)
        if not isinstance(data.get('foods'), list):
            raise DomainError('food_source_unavailable', 'USDA returned an unexpected response.', 502)
        foods = []
        for entry in data['foods']:
            try:
                nutrients = {}
                for nutrient in entry.get('foodNutrients', []):
                    nutrient_id = nutrient.get('nutrientId')
                    key = {1003: 'protein_g', 1004: 'fat_g', 1005: 'carbs_g', 1079: 'fiber_g', 1008: 'kcal', 2047: 'kcal', 2048: 'kcal'}.get(nutrient_id)
                    unit = str(nutrient.get('unitName', '')).upper()
                    if key and unit == ('KCAL' if key == 'kcal' else 'G'):
                        if key not in nutrients or nutrient_id == 1008:
                            nutrients[key] = nutrient.get('value')
                fdc_id = str(entry['fdcId'])
                food = validate_food({'name': entry['description'], 'basis': 'per_100g', 'nutrients': nutrients,
                        'source': {'kind': 'usda', 'id': fdc_id, 'url': f'https://fdc.nal.usda.gov/food-details/{fdc_id}/nutrients', 'retrieved_at': now(),
                                   'notes': 'USDA FoodData Central (CC0). ' + str(entry.get('dataType', ''))},
                        'serving_description': '100 g; match raw/cooked form and exact brand before use',
                        'notes': entry.get('brandOwner', '')})
                foods.append(food)
            except (KeyError, TypeError, AttributeError, DomainError):
                continue  # Malformed provider entries never become valid foods.
        return {'provider': 'USDA FoodData Central', 'attribution': 'USDA FoodData Central · CC0 / public domain', 'foods': foods,
                'page': page, 'has_more': isinstance(data.get('totalPages'), int) and page < data['totalPages'],
                'notice': 'Public demo access: 30 requests/hour and 50/day per IP. Match portions and raw/cooked form.'}

    def barcode(self, code):
        if not isinstance(code, str) or not re.fullmatch(r'\d{8,14}', code):
            raise DomainError('invalid_input', 'Use an 8–14 digit product barcode.')
        fields = 'code,product_name,brands,nutriments,serving_size,ingredients_text,nutrition_data_per,product_quantity_unit'
        data = self._get(f'https://world.openfoodfacts.org/api/v3/product/{code}.json?fields={fields}')
        product = data.get('product')
        if not isinstance(product, dict):
            raise DomainError('food_not_found', 'No product found for this barcode.', 404)
        # OFF uses _100g suffix for both 100g and 100ml. Keep its explicit volume indication.
        basis = 'per_100ml' if product.get('nutrition_data_per') == '100ml' or product.get('product_quantity_unit') in ('ml', 'l', 'cl', 'dl') else 'per_100g'
        raw = product.get('nutriments', {})
        if not isinstance(raw, dict):
            raise DomainError('food_source_unavailable', 'Product has no usable nutrition data.', 502)
        nutrients = {key: raw.get(source + '_100g') for key, source in zip(NUTRIENTS, ('energy-kcal', 'proteins', 'carbohydrates', 'fat', 'fiber'))}
        try:
            food = validate_food({'name': product.get('product_name') or f'Product {code}', 'basis': basis, 'nutrients': nutrients,
                    'source': {'kind': 'open_food_facts', 'id': code, 'url': f'https://world.openfoodfacts.org/product/{code}', 'retrieved_at': now(),
                               'notes': 'Open Food Facts · ODbL / DbCL. Community data: verify the package label and serving basis.'},
                    'serving_description': product.get('serving_size', ''), 'ingredients': product.get('ingredients_text', ''),
                    'notes': product.get('brands', '')})
        except DomainError:
            raise DomainError('food_source_unavailable', 'Product has incomplete or invalid nutrition data. Use its package label.', 502)
        return {'food': food, 'provider': 'Open Food Facts', 'attribution': 'Open Food Facts · ODbL / DbCL',
                'notice': 'Community data; verify your label, units, ingredients and allergens. Not an allergen safety check.'}
