import {readFile} from 'node:fs/promises';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';
const source=await readFile(new URL('../static/tracking.js',import.meta.url),'utf8');
function boot({loseResponse=false,entries=[]}={}){
 const root={isConnected:true,innerHTML:''},storage=new Map(),calls=[],ledger=new Map();
 const context={window:{},Intl,Date,URLSearchParams,AbortController,setTimeout,clearTimeout,crypto:webcrypto,localStorage:{getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},fetch:async(url,options)=>{
  if(!options.body)return {ok:true,json:async()=>({entries,trend:[{day:'2026-10-19',measurements:0,average_kg:null}]})};
  const body=JSON.parse(options.body);calls.push(body);
  if(!ledger.has(body.request_id))ledger.set(body.request_id,{result:{id:'entry'}});
  if(loseResponse){loseResponse=false;throw new Error('Lost response');}
  return {ok:true,json:async()=>ledger.get(body.request_id)};
 }};
 vm.runInContext(source,vm.createContext(context));context.window.SetwiseTracking.mount(root,'2026-10-19','America/New_York');
 const flush=async()=>{for(let i=0;i<30;i++)await Promise.resolve();};
 const input=(name,value)=>root.oninput({target:{name,value},stopPropagation(){}});
 const submit=async id=>{await root.onsubmit({target:{id,reportValidity:()=>true},preventDefault(){},stopPropagation(){}});await flush();};
 const click=async cmd=>{await root.onclick({target:{closest:()=>({dataset:{tcmd:cmd},disabled:false})},stopPropagation(){}});await flush();};
 return {root,storage,calls,ledger,flush,input,submit,click};
}
test('creatine can be recorded taken without inventing a dose or time',async()=>{
 const ui=boot();await ui.flush();assert.match(ui.root.innerHTML,/No weigh-in recorded/);assert.match(ui.root.innerHTML,/Not enough data/);
 await ui.submit('tracking-creatine');assert.equal(ui.calls[0].payload.value,null);assert.equal(ui.calls[0].payload.occurred_at,null);assert.equal(ui.calls[0].payload.kind,'creatine');
});
test('weight preserves explicit units and corrections preserve source notes and time',async()=>{
 const entry={day:'2026-10-19',kind:'bodyweight',value:'74',unit:'kg',revision:3,notes:'Measured after breakfast',occurred_at:'2026-10-19T13:00:00Z'};
 const ui=boot({entries:[entry]});await ui.flush();ui.input('weight','73.5');await ui.submit('tracking-weight');
 assert.equal(ui.calls[0].expected_revision,3);assert.equal(ui.calls[0].payload.unit,'kg');assert.equal(ui.calls[0].payload.notes,entry.notes);assert.equal(ui.calls[0].payload.occurred_at,entry.occurred_at);
});
test('uncertain saves persist and retry exact request without duplication',async()=>{
 const ui=boot({loseResponse:true});await ui.flush();await ui.submit('tracking-creatine');assert.equal(ui.storage.size,1);assert.match(ui.root.innerHTML,/awaiting confirmation/);
 await ui.click('retry');assert.equal(ui.storage.size,0);assert.equal(ui.ledger.size,1);assert.deepEqual(ui.calls[0],ui.calls[1]);
});
test('user values escape and no inline scripts or event attributes are generated',async()=>{
 const ui=boot({entries:[{day:'2026-10-19',kind:'creatine',value:null,unit:'g',notes:'<test>',revision:0}]});await ui.flush();assert.match(ui.root.innerHTML,/&lt;test&gt;/);assert.match(ui.root.innerHTML,/Taken · dose unknown/);
 assert.doesNotMatch(source,/<script|\son(?:click|submit|input)=|style=/i);
});
