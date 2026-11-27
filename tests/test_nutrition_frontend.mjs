import {readFile} from 'node:fs/promises';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';
const source=await readFile(new URL('../static/nutrition.js',import.meta.url),'utf8');
const empty={totals:Object.fromEntries(['kcal','protein_g','carbs_g','fat_g','fiber_g'].map(k=>[k,{known:'0',missing_items:0}])),meals:[],foods:[],logged_meals:0,estimated_meals:0};
function boot({storage=new Map(),loseResponse=false}={}){
 const root={isConnected:true,innerHTML:'',contains(){return false;},querySelector(){return null;}};
 const calls=[],ledger=new Map();let applied=0;
 const context={window:{},location:{hash:'#nutrition'},document:{activeElement:null},Intl,Date,URLSearchParams,AbortController,crypto:webcrypto,structuredClone,setTimeout,clearTimeout,setInterval(){},localStorage:{getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},fetch:async(url,options)=>{
  if(!options.body)return{ok:true,json:async()=>({...empty})};
  const body=JSON.parse(options.body);calls.push(body);
  if(!ledger.has(body.request_id)){ledger.set(body.request_id,{result:{id:'meal'}});applied++;}
  if(loseResponse){loseResponse=false;throw new Error('Lost response');}
  return{ok:true,json:async()=>ledger.get(body.request_id)};
 }};
 vm.runInContext(source,vm.createContext(context));context.window.SetwiseNutrition.mount(root);
 const flush=async()=>{for(let i=0;i<30;i++)await Promise.resolve();};
 const input=(form,name,value)=>root.oninput({target:{name,value,type:typeof value==='boolean'?'checkbox':'text',checked:value,closest:()=>({id:form})}});
 const submit=async id=>{await root.onsubmit({target:{id,reportValidity:()=>true},preventDefault(){}});await flush();};
 const click=async(cmd,data={})=>{await root.onclick({target:{closest:()=>({dataset:{ncmd:cmd,...data},disabled:false})}});await flush();};
 const add=async()=>{input('nutrition-food','name','Test <food>');input('nutrition-food','kcal','200');input('nutrition-food','protein_g','10');input('nutrition-food','quantity','1.5');await submit('nutrition-food');input('nutrition-meal','title','Test <meal>');};
 return{root,storage,calls,flush,input,submit,click,add,applied:()=>applied};
}
test('empty days are unlogged, user content escapes and unknown macros stay partial',async()=>{
 const ui=boot();await ui.flush();assert.match(ui.root.innerHTML,/No logged meals/);await ui.add();assert.match(ui.root.innerHTML,/Test &lt;food&gt;/);assert.match(ui.root.innerHTML,/300 kcal/);assert.match(ui.root.innerHTML,/unknown/);await ui.submit('nutrition-meal');assert.equal(ui.calls.length,1);assert.equal(ui.calls[0].payload.items[0].food.nutrients.fat_g,null);
});
test('lost response persists exact idempotent command and retries without duplicate application',async()=>{
 const ui=boot({loseResponse:true});await ui.flush();await ui.add();await ui.submit('nutrition-meal');assert.equal(ui.applied(),1);assert.match(ui.root.innerHTML,/awaiting confirmation/);assert.equal(ui.storage.size,1);await ui.click('retry');assert.equal(ui.applied(),1);assert.equal(ui.storage.size,0);assert.deepEqual(ui.calls[0],ui.calls[1]);
});
test('photo portions are always marked estimated',async()=>{
 const ui=boot();await ui.flush();ui.input('nutrition-food','portion_method','photo_estimate');await ui.add();await ui.submit('nutrition-meal');assert.equal(ui.calls[0].payload.items[0].estimated,true);assert.equal(ui.calls[0].payload.items[0].portion_method,'photo_estimate');
});
test('invalid quantity and unknown-only food cannot be added',async()=>{
 const ui=boot();await ui.flush();ui.input('nutrition-food','name','Unknown');await ui.submit('nutrition-food');assert.match(ui.root.innerHTML,/at least one nutrient/);ui.input('nutrition-food','kcal','20');ui.input('nutrition-food','quantity','-2');await ui.submit('nutrition-food');assert.match(ui.root.innerHTML,/positive portion/);assert.equal(ui.calls.length,0);
});
test('malformed pending data blocks writes',async()=>{
 const storage=new Map([['setwise.nutrition.pending.v1','broken json']]);const ui=boot({storage});await ui.flush();assert.match(ui.root.innerHTML,/Pending data needs repair/);await ui.add();await ui.submit('nutrition-meal');assert.equal(ui.calls.length,0);
});
test('UI contains no remote assets, inline scripts or event attributes',()=>{
 assert.doesNotMatch(source,/<script|\son(?:click|submit|input)=|style=/i);
});
