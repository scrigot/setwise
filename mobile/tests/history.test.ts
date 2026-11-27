import test from 'node:test';
import assert from 'node:assert/strict';
import { calendarDays, dateKey, duration, exercises, filterHistory, parseSnapshot, Workout } from '../src/history';
const base: Workout = { id:'a', title:'Evening session', status:'finished', workout_date:'2026-11-26', date_precision:'date', started_at:null, finished_at:null, sets:[{id:'s1',exercise:'Bench press',load:'82.5',unit:'lb',reps:8,rpe:null}] };
test('date-only records do not shift with timezone or invent durations', () => { assert.equal(dateKey(base),'2026-11-26'); assert.equal(duration(base),null); });
test('timestamp records use recorded timezone', () => { const w = {...base,workout_date:undefined,started_at:'2026-11-27T02:00:00Z',workout_timezone:'America/New_York'}; assert.equal(dateKey(w),'2026-11-26'); });
test('sort by workout day, exclude active workouts, preserve source units and missing RPE', () => { const parsed=parseSnapshot({sessions:[{...base,id:'old',workout_date:'2026-10-01'},{...base,id:'active',status:'active'},base]}); assert.deepEqual(parsed.sessions.map(w=>w.id),['a','old']); assert.equal(parsed.sessions[0].sets[0].unit,'lb'); assert.equal(parsed.sessions[0].sets[0].rpe,null); });
test('search matches exercise names and combines with month and day filters', () => { assert.equal(filterHistory([base],'BENCH','2026-11','2026-11-26').length,1); assert.equal(filterHistory([base],'bench','2026-10').length,0); assert.equal(filterHistory([base],'row').length,0); });
test('group case and whitespace only, preserving equipment variants', () => { const w={...base,sets:[...base.sets,{...base.sets[0],id:'s2',exercise:'  BENCH   PRESS '},{...base.sets[0],id:'s3',exercise:'Smith bench press'}]}; assert.deepEqual(exercises(w).map(g=>g.sets.length),[2,1]); });
test('calendar has Monday-first offset and leap day', () => { const days=calendarDays('2024-02'); assert.deepEqual(days.slice(0,4),[null,null,null,'2024-02-01']); assert.ok(days.includes('2024-02-29')); assert.equal(days.length%7,0); });
test('reject malformed history rather than silently inventing data', () => { assert.throws(()=>parseSnapshot({sessions:[{...base,sets:[{...base.sets[0],unit:'unknown'}]}]})); assert.throws(()=>parseSnapshot({sessions:[base,base]})); assert.throws(()=>parseSnapshot({sessions:[{...base,workout_date:null,started_at:null}]})); });
test('empty history is valid',()=>assert.deepEqual(parseSnapshot({sessions:[]}).sessions,[]));

test('summary uses the heaviest comparable load, breaks ties on reps, and preserves reps-only sets', async () => {
  const { bestSet, setLabel, volumeLabel, gymLabel, gyms } = await import('../src/history');
  const set = base.sets[0];
  const candidates = [{...set, load:'100', unit:'lb' as const}, {...set, load:'50', unit:'kg' as const, reps:6}, {...set, load:'50', unit:'kg' as const, reps:9}];
  assert.equal(setLabel(bestSet(candidates)), '50 kg × 9');
  assert.equal(setLabel({...set,load:'0',reps:13}), '13 reps');
  assert.equal(volumeLabel({...base,sets:[{...set,load:'100',unit:'lb',reps:9}]}), '900 lb');
  const workout = {...base, notes:`Gyms: ${gyms[1]}. Only logged sets.`};
  assert.equal(gymLabel(workout), gyms[1]);
  assert.equal(gymLabel({...workout,gym:gyms[0]}), gyms[0]);
  assert.equal(filterHistory([workout], gyms[1]).length,1);
});

test('reference estimates, historical PR counts, unit conversion, and tied sets', async () => {
  const { workoutRecords, estimatedMax } = await import('../src/records');
  const make = (id:string, load:string, reps:number) => ({...base.sets[0],id,load,reps,unit:'lb' as const});
  const set = make('a','260',9);
  for(const [load,reps,estimate] of [[260,9,334],[150,9,193],[305,8,379]]) {
    assert.equal(Math.round(estimatedMax(make('ref',String(load),reps))!), estimate);
  }
  const before = {...base,id:'before',workout_date:'2026-08-25',sets:[make('prev','240',9)]};
  const tied={...set,id:'tie'};
  const body={...make('body','0',13),exercise:'Leg raise'};
  const day={...base,id:'day',workout_date:'2026-08-26',sets:[set,tied,body]};
  const later={...base,id:'after',workout_date:'2026-08-27',sets:[{...set,load:String(260*0.45359237),unit:'kg' as const}]};
  const records=workoutRecords([later,day,before]);
  assert.equal(records.get('before')?.count,0);
  assert.equal(records.get('day')?.count,3);
  assert.deepEqual(records.get('day')?.badges.get(set),['1RM','VOL.','WEIGHT']);
  assert.equal(records.get('day')?.badges.has(tied),false);
  assert.equal(records.get('day')?.badges.has(body),false);
  assert.equal(estimatedMax(body),null);
  assert.equal(records.get('after')?.count,0);
});

test('only beatable working-set baselines count, including for bodyweight exercises', async () => {
  const { workoutRecords } = await import('../src/records');
  const day = (id: string, reps: number, setType = 'normal'): Workout => ({
    ...base, id, workout_date: `2026-11-${id}`,
    sets: [{ ...base.sets[0], load: '0', exercise_type: 'reps_only', reps, set_type: setType }],
  });
  const workouts = [day('01', 20, 'warmup'), day('02', 8), day('03', 8), day('04', 10), day('05', 9)];
  const records = workoutRecords(workouts);
  assert.deepEqual(workouts.map(w => records.get(w.id)?.count), [0, 0, 0, 1, 0]);
  assert.deepEqual(records.get('04')?.badges.get(workouts[3].sets[0]), ['REPS']);
});
test('two workouts with unknown ordering do not create a false baseline for one another', async () => {
  const { workoutRecords } = await import('../src/records');
  const a = {...base, id:'a'};
  const b = {...base, id:'b', sets:[{...base.sets[0], reps:12}]};
  assert.equal(workoutRecords([a,b]).get('b')?.count, 0);
  const timed = (w: Workout, hour: number) => ({...w, date_precision:'timestamp', started_at:`2026-11-26T${hour}:00:00-05:00`});
  assert.equal(workoutRecords([timed(b,14),timed(a,10)]).get('b')?.count, 2);
});
test('card clock range respects date precision, timezone, and overnight ends', async () => {
  const { workoutTimes } = await import('../src/history');
  assert.equal(workoutTimes(base), 'Times not recorded');
  const w = {...base, date_precision:'timestamp', started_at:'2026-11-27T04:45:00Z', finished_at:'2026-11-27T05:20:00Z'};
  assert.equal(workoutTimes(w), '11:45 PM to 12:20 AM (Nov 27, 2026)');
});
