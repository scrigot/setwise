/* Dated measurements and supplement adherence; independent of calorie totals. */
(() => {
  'use strict';
  const esc = v => String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
  const fmt = v => Number(v).toLocaleString(undefined,{maximumFractionDigits:1});
  const key='setwise.tracking.pending.v1';
  let root,day,timezone,data,error='',message='',busy=false,pending=null,sequence=0;
  let draft={weight:'',unit:'lb',creatine:'',notes:'',weightNotes:''};
  try {pending=JSON.parse(localStorage.getItem(key)||'null');} catch {pending={invalid:true};}
  if(pending && (typeof pending.request_id!=='string'||!['save_entry','remove_entry','restore_entry'].includes(pending.action)||!pending.payload))pending={invalid:true};
  async function request(path,body) {
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),20000);
    try {
      const response=await fetch(path,{method:body?'POST':'GET',headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined,signal:controller.signal,cache:'no-store'});
      const value=await response.json();
      if(!response.ok){const e=new Error(value.error?.message||'Tracking request failed.');e.status=response.status;throw e;}
      return value;
    } finally {clearTimeout(timer);}
  }
  const current=kind=>data?.entries.find(r=>r.day===day&&r.kind===kind);
  function render() {
    if(!root?.isConnected)return;
    const weight=current('bodyweight'),creatine=current('creatine'),average=data?.trend.at(-1);
    const disabled=busy||pending?'disabled':'';
    const input=(name,label,value,type='number',extra='')=>`<div class="form-group"><label for="t-${name}">${label}</label><input id="t-${name}" name="${name}" type="${type}" value="${esc(value)}" ${extra}></div>`;
    const buttons=(kind,entry)=>entry?.deleted?`<button class="btn secondary small" data-tcmd="restore" data-kind="${kind}" type="button" ${disabled}>Restore</button>`:`<button class="btn soft small" type="submit" ${disabled}>${entry?'Save correction':kind==='bodyweight'?'Save weigh-in':'Mark creatine taken'}</button>${entry?` <button class="btn text" type="button" data-tcmd="remove" data-kind="${kind}" ${disabled}>Remove</button>`:''}`;
    root.innerHTML=`<section class="card space-below"><div class="section-top"><h2>Bodyweight & creatine</h2><button class="btn text" type="button" data-tcmd="refresh" ${busy?'disabled':''}>Refresh</button></div>
    <p class="subtext">${esc(day)} · ${esc(timezone)}. Daily records; exact times are optional and never assumed.</p>
    ${error?`<p class="notice error" role="alert">${esc(error)}</p>`:''}${message?`<p role="status">${esc(message)}</p>`:''}
    ${pending?`<p class="notice">${pending.invalid?'Pending tracking data needs repair. Keep browser storage.':'A tracking save is awaiting confirmation.'} ${!pending.invalid?'<button class="btn secondary small" type="button" data-tcmd="retry">Retry saved request</button>':''}</p>`:''}
    <div class="content-grid nutrition-grid"><form id="tracking-weight"><h3>Weigh-in</h3><p>${weight&&!weight.deleted?`${esc(weight.value)} ${esc(weight.unit)} recorded`:'No weigh-in recorded for this date.'}</p><div class="field-row">${input('weight','Bodyweight',draft.weight,'number','required min="0.000001" step="any"')}<div class="form-group"><label for="t-unit">Weight unit</label><select id="t-unit" name="unit"><option value="lb"${draft.unit==='lb'?' selected':''}>lb</option><option value="kg"${draft.unit==='kg'?' selected':''}>kg</option></select></div></div>${buttons('bodyweight',weight)}
    <p class="form-help">7-day average: ${average?.measurements?`${fmt(Number(average.average_kg)/(draft.unit==='lb'?0.45359237:1))} ${esc(draft.unit)} · ${average.measurements}/7 days recorded`:'Not enough data yet.'}</p></form>
    <form id="tracking-creatine"><h3>Creatine</h3><p>${creatine&&!creatine.deleted?`Taken · ${creatine.value===null?'dose unknown':esc(creatine.value)+' g'}`:'No creatine entry for this date.'}</p>${input('creatine','Dose (grams; leave blank if unknown)',draft.creatine,'number','min="0.000001" max="100" step="any"')}${input('notes','Notes (optional)',draft.notes,'text','maxlength="2000"')}${buttons('creatine',creatine)}<p class="form-help">Records that you took it. A blank day means unknown, not a missed dose.</p></form></div>
    <details class="plan"><summary>Last 30 days · recorded weigh-ins & creatine</summary>${(data?.entries||[]).filter(r=>!r.deleted).map(r=>`<div class="nutrition-item"><span>${esc(r.day)} · ${r.kind==='bodyweight'?'Bodyweight':'Creatine taken'}</span><strong>${r.value===null?'Dose unknown':esc(r.value)+' '+esc(r.unit)}</strong></div>`).join('')||'<p>No entries in this range.</p>'}</details><p class="form-help">Tracking is separate from food totals and included in Export nutrition. Weight averages use recorded days only.</p></section>`;
  }
  async function refresh(prefill=false) {
    const token=++sequence;
    try {
      const start=new Date(day+'T12:00:00Z');start.setUTCDate(start.getUTCDate()-29);
      const next=await request('/api/tracking/state?'+new URLSearchParams({start_date:start.toISOString().slice(0,10),end_date:day,timezone}));
      if(token!==sequence)return;
      data=next;
      if(prefill){const w=current('bodyweight'),c=current('creatine');draft={weight:w?.value??'',unit:w?.unit||draft.unit,creatine:c?.value??'',notes:c?.notes||'',weightNotes:w?.notes||''};}
    } catch(e){if(token===sequence)error=e.message;}
    if(token===sequence)render();
  }
  async function send(body) {
    if(busy||pending?.invalid)return;
    busy=true;error='';message='';
    try {
      if(!pending){localStorage.setItem(key,JSON.stringify(body));pending=body;}
      render();await request('/api/tracking/commands',pending);
      localStorage.removeItem(key);pending=null;message='Tracking saved.';await refresh(true);
    } catch(e) {
      error=e.message;
      if(e.status&&e.status<500){localStorage.removeItem(key);pending=null;await refresh();}
    } finally {busy=false;render();}
  }
  async function submit(event) {
    event.preventDefault();event.stopPropagation();
    if(busy||pending||!event.target.reportValidity())return;
    const kind=event.target.id==='tracking-weight'?'bodyweight':'creatine',entry=current(kind);
    const value=kind==='bodyweight'?draft.weight:draft.creatine;
    await send({request_id:crypto.randomUUID(),action:'save_entry',payload:{day,timezone,kind,value:value===''?null:value,unit:kind==='bodyweight'?draft.unit:'g',notes:kind==='creatine'?draft.notes:draft.weightNotes,occurred_at:entry?.occurred_at??null},...(entry?{expected_revision:entry.revision}:{})});
  }
  async function click(event) {
    const button=event.target.closest('[data-tcmd]');if(!button||button.disabled)return;
    event.stopPropagation();if(busy)return;
    if(button.dataset.tcmd==='retry')return send(pending);
    if(button.dataset.tcmd==='refresh')return refresh(true);
    if(pending)return;
    const kind=button.dataset.kind,entry=current(kind);if(!entry)return;
    await send({request_id:crypto.randomUUID(),action:button.dataset.tcmd==='remove'?'remove_entry':'restore_entry',payload:{day,timezone,kind},expected_revision:entry.revision});
  }
  window.SetwiseTracking={mount(host,selectedDay,zone){
    const changed=day!==selectedDay||timezone!==zone;
    root=host;day=selectedDay;timezone=zone;
    if(changed){data=null;draft={weight:'',unit:'lb',creatine:'',notes:'',weightNotes:''};}
    root.onsubmit=submit;root.onclick=click;
    root.oninput=root.onchange=event=>{if(event.target.name in draft)draft[event.target.name]=event.target.value;event.stopPropagation();if(event.target.name==='unit')render();};
    render();if(changed||!data)refresh(true);
  }};
})();
