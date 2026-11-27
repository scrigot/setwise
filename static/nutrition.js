/* Nutrition journal: chat supplies interpreted evidence; this UI reviews the same local database. */
(() => {
  'use strict';
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
  const keys = ['kcal','protein_g','carbs_g','fat_g','fiber_g'];
  const labels = ['Calories','Protein','Carbs','Fat','Fiber'];
  const format = value => Number(value).toLocaleString(undefined, {maximumFractionDigits:1});
  const localTime = value => { const d = value ? new Date(value) : new Date(); return new Date(d.getTime() - d.getTimezoneOffset()*60000).toISOString().slice(0,16); };
  const localZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const today = () => { const p = new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date()); return ['year','month','day'].map(k=>p.find(x=>x.type===k).value).join('-'); };
  const storageKey = 'setwise.nutrition.pending.v1'; // gitleaks:allow -- browser localStorage namespace, not a credential
  let root, data, results = [], attribution = '', notice = '', error = '', message = '', loading = false, busy = false, pending = null;
  let day = today(), timezone = 'America/New_York', page = 1;
  const blank = () => ({title:'',time:localTime(),status:'logged',notes:'',evidence:'',items:[],meal_id:null,revision:null});
  let draft = blank();
  let foodDraft = {name:'',basis:'per_serving',quantity:'1',kcal:'',protein_g:'',carbs_g:'',fat_g:'',fiber_g:'',source_kind:'label',source_url:'',source_page:'',source_notes:'',serving_description:'',estimated:false,portion_method:'label_serving'};
  let query = '', barcode = '';
  try { pending = JSON.parse(localStorage.getItem(storageKey) || 'null'); } catch { error = 'Pending meal storage could not be read. Export and repair this browser storage before logging.'; pending = {invalid:true}; }
  if (pending && (typeof pending.request_id !== 'string' || !['log_meal','edit_meal','delete_meal','restore_meal','save_food'].includes(pending.action) || !pending.payload || typeof pending.payload !== 'object')) pending = {invalid:true};
  async function request(url, body) {
    const controller = new AbortController(), timer = setTimeout(()=>controller.abort(),20000);
    try {
      const response = await fetch(url, {method:body?'POST':'GET',headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined,cache:'no-store',signal:controller.signal});
      const value = await response.json();
      if (!response.ok) { const e = new Error(value.error?.message || 'Request failed'); e.status=response.status; throw e; }
      return value;
    } finally { clearTimeout(timer); }
  }
  function visible() { return root?.isConnected && location.hash === '#nutrition'; }
  function field(name,label,value='',type='text',extra='') { return `<div class="form-group"><label for="n-${name}">${label}</label><input id="n-${name}" name="${name}" type="${type}" value="${escape(value)}" ${extra}></div>`; }
  function options(values,selected) { return values.map(([v,l])=>`<option value="${v}"${v===selected?' selected':''}>${l}</option>`).join(''); }
  function nutrientText(totals) { return keys.slice(0,4).map((key,i)=>`${format(totals[key].known)}${totals[key].missing_items?' + unknown':''} ${i?'g '+labels[i].toLowerCase():'kcal'}`).join(' · '); }
  function sum(items) { return Object.fromEntries(keys.map(key=>[key,{known:items.reduce((n,item)=>n+(item.food.nutrients[key]===null?0:Number(item.food.nutrients[key])*Number(item.quantity)/(item.food.basis==='per_serving'?1:100)),0),missing_items:items.filter(item=>item.food.nutrients[key]===null).length}])) ; }
  function sourceLink(source) { return source.url ? `<a href="${escape(source.url)}" target="_blank" rel="noopener noreferrer">${escape(source.kind.replaceAll('_',' '))}${source.page?' · p. '+escape(source.page):''}</a>` : escape(source.kind.replaceAll('_',' ')); }
  function itemList(items,editable=false) { return items.map((item,i)=>`<div class="nutrition-item"><div><strong>${escape(item.food.name)}</strong><p>${escape(item.quantity)} ${escape(item.quantity_unit)}${item.estimated?' · Estimated':''} · ${sourceLink(item.food.source)}</p><p>${escape(item.food.serving_description || item.food.notes || '')}</p>${item.notes?`<p>${escape(item.notes)}</p>`:''}</div>${editable?`<button class="btn text" type="button" data-ncmd="remove-item" data-index="${i}">Remove</button>`:''}</div>`).join(''); }
  function render() {
    if (!visible()) return;
    const totals = data?.totals;
    root.innerHTML = `<div class="heading-row exports"><div><p class="eyebrow">FOOD, WITH CONTEXT</p><h1>Your nutrition journal.</h1><p class="subtext">Log in chat. Check portions, sources and daily totals here.</p></div><a class="btn secondary small" href="/api/nutrition/export.json" download>Export nutrition</a></div>
    ${error?`<div class="notice error" role="alert">${escape(error)}</div>`:''}${message?`<div class="notice" role="status">${escape(message)}</div>`:''}
    ${pending?`<div class="notice"><div><strong>${pending.invalid?'Pending data needs repair':'A save is awaiting confirmation'}</strong><p>Retry the same request to check whether it saved. It will not create a duplicate. Keep this browser’s storage.</p>${!pending.invalid?'<button class="btn secondary small" data-ncmd="retry">Retry saved request</button>':''}</div></div>`:''}
    <form id="nutrition-day" class="card nutrition-filter"><div class="field-row">${field('day','Journal date',day,'date','required')}${field('timezone','Daily totals timezone',timezone,'text','required maxlength="100"')}</div><button class="btn secondary small" type="submit">${loading?'Refreshing…':'View day'}</button></form>
    <div id="daily-tracking"></div>
    <div class="stats-grid nutrition-stats">${keys.slice(0,4).map((key,i)=>`<div class="stat"><div class="stat-label">${labels[i]}</div><div class="stat-value">${!totals||!data.logged_meals?'—':format(totals[key].known)}<span class="stat-unit">${i?'g':'kcal'}</span></div><div class="stat-note">${totals?.[key].missing_items?`Partial · ${totals[key].missing_items} item(s) unknown`:data?.logged_meals?'Recorded items':'No logged meals'}</div></div>`).join('')}</div>
    <p class="scope-label">Totals cover recorded items only; drafts and removed meals are excluded. ${data?.estimated_meals || 0} logged meal(s) include estimates.</p>
    <div class="content-grid nutrition-grid"><section class="card"><div class="section-top"><h2>${draft.meal_id?'Correct meal':'Build a meal'}</h2></div>
    <p class="subtext space-below">In chat, send a description, food photo or official nutrition PDF and ask to log it. Here, use a food lookup or enter a label.</p>
    <form id="nutrition-search"><div class="field-row">${field('query','USDA food search',query,'search','maxlength="120"')}${field('barcode','Product barcode',barcode,'text','inputmode="numeric" maxlength="14"')}</div><div class="nutrition-actions"><button class="btn secondary small" type="submit" name="lookup" value="search">Search foods</button><button class="btn secondary small" type="submit" name="lookup" value="barcode">Look up barcode</button></div></form>
    ${notice?`<p class="form-help">${escape(notice)}</p>`:''}${results.length?`<div class="nutrition-results">${results.map((food,i)=>`<div class="nutrition-item"><div><strong>${escape(food.name)}</strong><p>${escape(food.basis.replaceAll('_',' '))} · ${food.nutrients.kcal===null?'Unknown':format(food.nutrients.kcal)} kcal · ${escape(food.notes)}</p></div><button type="button" class="btn soft small" data-ncmd="choose-food" data-index="${i}">Use food</button></div>`).join('')}</div>`:''}${attribution?`<p class="form-help">${escape(attribution)}</p>`:''}
    ${data?.foods.length?`<details class="plan"><summary>Saved foods & recipes (${data.foods.length} most recent)</summary>${data.foods.map((food,i)=>`<div class="nutrition-item"><strong>${escape(food.name)}</strong><button class="btn text" data-ncmd="saved-food" data-index="${i}">Use</button></div>`).join('')}</details>`:''}
    <details class="plan" id="nutrition-food-details" open><summary>Label or selected food</summary><form id="nutrition-food">
    ${field('name','Food name',foodDraft.name,'text','required maxlength="200"')}
    <div class="field-row"><div class="form-group"><label for="n-basis">Nutrition values are for</label><select id="n-basis" name="basis">${options([['per_serving','One serving'],['per_100g','100 grams'],['per_100ml','100 milliliters']],foodDraft.basis)}</select></div>${field('quantity','Amount eaten (servings, g or ml to match)',foodDraft.quantity,'number','required min="0.000001" max="100000" step="any"')}</div>
    <div class="nutrition-nutrients">${keys.map((key,i)=>field(key,labels[i]+(i?' (g)':' (kcal)'),foodDraft[key],'number','min="0" max="100000" step="any" placeholder="Unknown"')).join('')}</div>
    ${field('serving_description','Serving / cooking state',foodDraft.serving_description,'text','maxlength="300" placeholder="e.g. 1 scoop (30 g), cooked rice"')}
    <div class="field-row"><div class="form-group"><label for="n-source_kind">Source</label><select id="n-source_kind" name="source_kind">${options([['label','Package label'],['restaurant_pdf','Official nutrition PDF'],['manual','Manual entry'],['estimate','Estimate'],['recipe','Recipe'],['usda','USDA selected food'],['open_food_facts','Barcode selected food']],foodDraft.source_kind)}</select></div><div class="form-group"><label for="n-portion_method">Portion measured by</label><select id="n-portion_method" name="portion_method">${options([['label_serving','Label serving'],['weighed','Weighed'],['user_report','Your description'],['photo_estimate','Photo estimate'],['recipe_estimate','Recipe estimate']],foodDraft.portion_method)}</select></div></div>
    ${field('source_url','Source link (optional)',foodDraft.source_url,'url','maxlength="2000"')}${field('source_page','PDF page / menu item (optional)',foodDraft.source_page,'text','maxlength="100"')}${field('source_notes','Source / conversion notes',foodDraft.source_notes,'text','maxlength="2000"')}
    <label class="nutrition-check"><input type="checkbox" name="estimated" ${foodDraft.estimated?'checked':''}> Portion or nutrition is estimated</label>
    <div class="nutrition-actions"><button type="submit" class="btn soft small">Add item to meal</button><button type="button" class="btn secondary small" data-ncmd="save-food">Save reusable food</button></div></form></details>
    <form id="nutrition-meal">${field('title','Meal name',draft.title,'text','required maxlength="200"')}${field('time',`Meal time (${escape(localZone)})`,draft.time,'datetime-local','required')}
    <div class="form-group"><label for="n-status">Status</label><select id="n-status" name="status">${options([['logged','Log in daily totals'],['draft','Draft · exclude from totals']],draft.status)}</select></div>
    ${itemList(draft.items,true)}${draft.items.length?`<p class="form-help">Meal preview: ${nutrientText(sum(draft.items))}</p>`:'<p class="form-help">Add at least one food item.</p>'}
    ${field('notes','Meal notes',draft.notes,'text','maxlength="2000"')}${field('evidence','Photo / PDF context and assumptions',draft.evidence,'text','maxlength="4000"')}
    <div class="nutrition-actions"><button class="btn" type="submit" ${busy||pending||!draft.items.length?'disabled':''}>${draft.meal_id?'Save correction':'Save meal'}</button><button class="btn secondary small" type="button" data-ncmd="clear-meal" ${pending?'disabled':''}>${draft.meal_id?'Cancel correction':'Clear meal'}</button></div><p class="form-help">Saves locally. A photo does not establish an exact portion.</p></form></section>
    <section class="card"><div class="section-top"><h2>Meals · ${escape(day)}</h2><button class="btn text" data-ncmd="refresh">Refresh</button></div>${!data?'<p>Loading nutrition journal…</p>':!data.meals.length?'<div class="empty-state"><h3>No meals recorded yet.</h3><p>Ask chat to log a meal, or add one here.</p></div>':data.meals.map(meal=>`<article class="nutrition-meal${meal.deleted?' nutrition-deleted':''}"><div class="section-top"><h3>${escape(meal.title)}</h3><span class="pill">${meal.deleted?'Removed':meal.status==='draft'?'Draft':meal.estimated?'Estimated':'Logged'}</span></div><p class="subtext">${escape(new Date(meal.occurred_at).toLocaleString(undefined,{timeZone:timezone}))} · ${escape(timezone)}</p><p class="nutrition-total">${nutrientText(meal.totals)}</p><details class="plan"><summary>Foods & sources</summary>${itemList(meal.items)}${meal.notes?`<p>${escape(meal.notes)}</p>`:''}${meal.evidence?`<p class="form-help">Evidence: ${escape(meal.evidence)}</p>`:''}${meal.items.map(item=>item.food.source.notes?`<p class="form-help">${escape(item.food.name)}: ${escape(item.food.source.notes)}</p>`:'').join('')}</details><div class="nutrition-actions">${meal.deleted?`<button class="btn secondary small" data-ncmd="restore" data-id="${meal.id}">Restore</button>`:`<button class="btn secondary small" data-ncmd="edit" data-id="${meal.id}">Correct</button><button class="btn text" data-ncmd="delete" data-id="${meal.id}">Remove</button>`}</div></article>`).join('')}
    <div class="nutrition-actions">${page>1?'<button class="btn secondary small" data-ncmd="previous">Previous</button>':''}${data?.has_more?'<button class="btn secondary small" data-ncmd="next">Next meals</button>':''}</div><p class="form-help">Corrections and removals stay in your nutrition export’s audit history.</p></section></div>
    <section class="card space-above"><h2>Using chat</h2><p class="subtext">“Log lunch: 180 g cooked chicken breast, 150 g cooked rice, and 1 tbsp olive oil. Use USDA and show the source.”</p><p class="form-help">For photos, include portion sizes, sauces and cooking oils when known. Chat can read an official nutrition PDF and save the page and serving as evidence. The local web app itself does not analyze images or browse PDFs. A connected ChatGPT test plugin needs its new nutrition tools enabled before it can save meals.</p></section>`;
    const tracker = root.querySelector('#daily-tracking');
    if (tracker && window.SetwiseTracking) window.SetwiseTracking.mount(tracker,day,timezone);
  }
  async function refresh() {
    if (loading) return;
    loading = true; render();
    const requested = `${day}|${timezone}|${page}`;
    try { const next = await request(`/api/nutrition/state?${new URLSearchParams({day,timezone,page})}`); if(requested===`${day}|${timezone}|${page}`)data=next; }
    catch(e){ error=e.message; }
    finally{loading=false;render();}
  }
  function foodFromForm() {
    const nutrients = Object.fromEntries(keys.map(key=>[key,foodDraft[key]===''?null:foodDraft[key]]));
    if (!foodDraft.name.trim() || keys.every(key=>nutrients[key]===null)) throw new Error('Enter a food name and at least one nutrient. Leave unknown values blank.');
    for (const value of Object.values(nutrients)) if(value!==null && (!Number.isFinite(Number(value)) || Number(value)<0)) throw new Error('Nutrients must be nonnegative numbers.');
    const source = {...(foodDraft.selectedSource || {}),kind:foodDraft.source_kind};
    if(foodDraft.source_url)source.url=foodDraft.source_url;else delete source.url;
    if(foodDraft.source_page)source.page=foodDraft.source_page;else delete source.page;
    source.notes=foodDraft.source_notes;
    return {name:foodDraft.name,basis:foodDraft.basis,nutrients,source,serving_description:foodDraft.serving_description,ingredients:foodDraft.ingredients || '',notes:foodDraft.food_notes || ''};
  }
  function choose(food) {
    foodDraft={...foodDraft,name:food.name,basis:food.basis,quantity:food.basis==='per_serving'?'1':'100',...Object.fromEntries(keys.map(key=>[key,food.nutrients[key]??''])),source_kind:food.source.kind,source_url:food.source.url || '',source_page:food.source.page || '',source_notes:food.source.notes || '',selectedSource:food.source,serving_description:food.serving_description || '',ingredients:food.ingredients || '',food_notes:food.notes || '',estimated:false,portion_method:'user_report'};
    render();root.querySelector('#n-quantity')?.focus();
  }
  async function send(body) {
    if(busy || pending?.invalid)return;
    busy=true;error='';message='';
    if(!pending){
      try{localStorage.setItem(storageKey,JSON.stringify(body));pending=body;}
      catch{busy=false;error='Browser storage is unavailable. Meal was not submitted.';render();return;}
    }
    render();
    try {
      await request('/api/nutrition/commands',pending);
      const action=pending.action;
      localStorage.removeItem(storageKey);pending=null;
      if(['log_meal','edit_meal'].includes(action))draft=blank();
      message=action==='save_food'?'Reusable food saved.':'Nutrition saved. Daily totals updated.';
      await refresh();
    } catch(e){
      error=e.message;
      if(e.status && e.status<500){localStorage.removeItem(storageKey);pending=null;if(e.status===409)await refresh();}
    } finally{busy=false;render();}
  }
  async function submit(event) {
    const form=event.target;
    if(!form.id?.startsWith('nutrition-'))return;
    event.preventDefault();
    if(busy||pending && form.id!=='nutrition-day'){error='Resolve the pending save before submitting another change.';render();return;}
    if(!form.reportValidity())return;
    error='';message='';
    try {
      if(form.id==='nutrition-day'){day=form.elements.day.value;timezone=form.elements.timezone.value;page=1;data=null;await refresh();}
      else if(form.id==='nutrition-search'){
        const useBarcode=event.submitter?.value==='barcode';
        const value=await request(useBarcode?`/api/nutrition/foods/barcode/${encodeURIComponent(barcode)}`:`/api/nutrition/foods/search?q=${encodeURIComponent(query)}`);
        results=value.foods || [value.food];attribution=value.attribution;notice=value.notice;
        if(!results.length)message='No matching foods found. Try a more specific description or enter a label.';
      } else if(form.id==='nutrition-food'){
        if(!Number.isFinite(Number(foodDraft.quantity)) || Number(foodDraft.quantity)<=0)throw new Error('Enter a positive portion amount.');
        const food=foodFromForm();
        draft.items.push({food,quantity:foodDraft.quantity,quantity_unit:food.basis==='per_serving'?'serving':food.basis==='per_100ml'?'ml':'g',estimated:foodDraft.estimated || ['photo_estimate','recipe_estimate'].includes(foodDraft.portion_method) || food.source.kind==='estimate',portion_method:foodDraft.portion_method});
        message='Item added to meal. Save the meal when ready.';
      } else if(form.id==='nutrition-meal'){
        if(!draft.items.length)throw new Error('Add at least one food item.');
        const meal={title:draft.title,occurred_at:draft.original_time===draft.time?draft.original_occurred_at:new Date(draft.time).toISOString(),items:draft.items,status:draft.status,notes:draft.notes,evidence:draft.evidence};
        await send({request_id:crypto.randomUUID(),action:draft.meal_id?'edit_meal':'log_meal',payload:draft.meal_id?{meal_id:draft.meal_id,meal}:meal,...(draft.meal_id?{expected_revision:draft.revision}:{})});
      }
    } catch(e){error=e.message;}
    render();
  }
  function input(event) {
    const el=event.target, form=el.closest('form');if(!form)return;
    const value=el.type==='checkbox'?el.checked:el.value;
    if(form.id==='nutrition-food')foodDraft[el.name]=value;
    if(form.id==='nutrition-meal')draft[el.name]=value;
    if(form.id==='nutrition-search'){if(el.name==='query')query=value;if(el.name==='barcode')barcode=value;}
  }
  async function click(event) {
    const button=event.target.closest('[data-ncmd]');if(!button || button.disabled)return;
    const action=button.dataset.ncmd;
    if(busy)return;
    error='';message='';
    try{
      if(action==='refresh')return await refresh();
      if(action==='retry')return await send(pending);
      if(action==='choose-food')choose(results[Number(button.dataset.index)]);
      if(action==='saved-food')choose(data.foods[Number(button.dataset.index)]);
      if(action==='remove-item')draft.items.splice(Number(button.dataset.index),1);
      if(action==='clear-meal')draft=blank();
      if(action==='save-food')await send({request_id:crypto.randomUUID(),action:'save_food',payload:{food:foodFromForm()}});
      if(['edit','delete','restore'].includes(action)){
        const meal=data.meals.find(m=>m.id===button.dataset.id);if(!meal)return;
        if(action==='edit')draft={...meal,items:structuredClone(meal.items).map(({totals,...item})=>item),time:localTime(meal.occurred_at),original_time:localTime(meal.occurred_at),original_occurred_at:meal.occurred_at,meal_id:meal.id,revision:meal.revision};
        else await send({request_id:crypto.randomUUID(),action:action==='delete'?'delete_meal':'restore_meal',payload:{meal_id:meal.id},expected_revision:meal.revision});
      }
      if(action==='next'){page++;await refresh();}
      if(action==='previous'){page--;await refresh();}
    }catch(e){error=e.message;}
    render();
  }
  window.SetwiseNutrition={mount(host){root=host;root.onsubmit=submit;root.oninput=input;root.onchange=input;root.onclick=click;render();refresh();}};
  setInterval(()=>{if(visible()&&!busy&&!pending&&!root.contains(document.activeElement))refresh();},30000);
})();
