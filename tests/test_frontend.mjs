/** Dependency-free UI/controller regression tests. Run: node --test tests/test_frontend.mjs
 * This lightweight DOM harness validates command/state transitions. It is not visual browser QA.
 */
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
const source = await readFile(new URL('../static/app.js', import.meta.url), 'utf8');
const clone = value => JSON.parse(JSON.stringify(value));
const key = 'setwise.pending.v1';
const setPayload = { exercise: 'Bench press', load: '40', unit: 'kg', reps: '8', rpe: '7' };
function makeServer() {
  const server = { state: { active_session: null, sessions: [], routines: [], summary: { finished_sessions: 0, total_sets: 0, volume_kg: 0, exercises: [] } }, requests: [], ledger: new Map(), failAfterApply: false, connected: true };
  server.fetch = async (url, opts = {}) => {
    if (!server.connected) throw new Error('Offline');
    if (url === '/api/state') return { ok: true, json: async () => clone(server.state) };
    assert.equal(url, '/api/commands');
    const body = JSON.parse(opts.body); server.requests.push(body);
    let result;
    if (server.ledger.has(body.request_id)) {
      const previous = server.ledger.get(body.request_id);
      assert.equal(opts.body, previous.body, 'Retries must preserve the exact command body');
      return { ok: true, json: async () => clone(previous.response) };
    }
    const active = server.state.active_session;
    if (!['start_session', 'save_routine'].includes(body.action) && body.expected_revision !== active.revision) return { ok: false, status: 409, json: async () => ({ error: { code: 'revision_conflict', message: 'The saved session changed.' } }) };
    if (body.action === 'start_session') {
      const routine = server.state.routines.find(item => item.id === body.payload.routine_id);
      result = { id: webcrypto.randomUUID(), title: body.payload.title, status: 'active', revision: 0, started_at: new Date().toISOString(), finished_at: null, sets: [], plan: routine?.template || [], can_undo: false };
      server.state.active_session = result; server.state.sessions.unshift(result);
    } else if (body.action === 'save_routine') {
      const item = server.state.sessions.find(item => item.id === body.payload.session_id);
      result = { id: webcrypto.randomUUID(), name: body.payload.name, template: item.sets.map(({ exercise, load, unit, reps, rpe }) => ({ exercise, load, unit, reps, rpe })), created_at: new Date().toISOString() };
      server.state.routines.unshift(result);
    } else {
      result = active;
      if (body.action === 'log_set') {
        const { session_id, ...payload } = body.payload;
        result.sets.push({ ...payload, id: webcrypto.randomUUID(), load_kg: String(Number(payload.load) * (payload.unit === 'lb' ? .45359237 : 1)) });
      } else if (body.action === 'edit_set') {
        const set = result.sets.find(item => item.id === body.payload.set_id);
        Object.assign(set, body.payload, { load_kg: body.payload.load });
      } else if (body.action === 'remove_set') result.sets = result.sets.filter(item => item.id !== body.payload.set_id);
      else if (body.action === 'finish_session') { result.status = 'finished'; result.finished_at = new Date().toISOString(); server.state.active_session = null; }
      result.revision++; result.can_undo = result.sets.length > 0;
    }
    const response = { result: clone(result), event_id: webcrypto.randomUUID() };
    server.ledger.set(body.request_id, { body: opts.body, response });
    if (server.failAfterApply) { server.failAfterApply = false; server.connected = false; throw new Error('Response lost'); }
    return { ok: true, json: async () => clone(response) };
  };
  return server;
}
function boot(server, saved = new Map()) {
  const listeners = new Map(), windowListeners = new Map(), timers = new Map();
  let timerId = 0;
  const node = () => ({ innerHTML: '', textContent: '', open: false, className: '', classList: { add() {}, remove() {} }, querySelector() { return null; }, addEventListener() {}, showModal() { this.open = true; }, close() { this.open = false; }, append() {}, getBoundingClientRect() { return { left: 0, top: 0, bottom: 100, right: 100 }; } });
  const nodes = new Map(['#main', '#connection', '#desktop-nav', '#mobile-nav', '#toast', '#dialog', '#single-tab-note'].map(id => [id, node()]));
  const document = { hidden: false, activeElement: null, querySelector: selector => nodes.get(selector) || null, querySelectorAll: () => [], addEventListener: (type, callback) => listeners.set(type, callback), createElement: node };
  const window = { addEventListener: (type, callback) => windowListeners.set(type, callback), scrollTo() {} };
  const context = vm.createContext({ document, window, location: { hash: '#today', reload() {} }, navigator: { onLine: true }, localStorage: { getItem: k => saved.get(k) ?? null, setItem: (k, v) => saved.set(k, v) }, crypto: webcrypto, fetch: server.fetch, AbortController, Map, Date, console, setTimeout: (fn, delay) => { timers.set(++timerId, { fn, delay }); return timerId; }, clearTimeout: id => timers.delete(id), setInterval() {}, FormData: class { constructor(form) { this.values = form.values; } get(name) { return this.values[name] ?? ''; } *[Symbol.iterator]() { yield* Object.entries(this.values); } } });
  vm.runInContext(source, context);
  const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
  return {
    saved, nodes, flush,
    async submit(id, values, dataset = {}) { await listeners.get('submit')({ target: { id, values, dataset, reportValidity: () => true }, preventDefault() {} }); await flush(); },
    async click(action, data = {}) { const target = { disabled: false, dataset: { action, ...data } }; await listeners.get('click')({ target: { closest: () => target } }); await flush(); },
    async event(type, detail = {}) { await windowListeners.get(type)?.(detail); await flush(); },
    async go(tab) { context.location.hash = '#' + tab; await windowListeners.get('hashchange')?.({}); await flush(); },
    async cooldown() { const matching = [...timers.entries()].filter(([, timer]) => timer.delay === 600); for (const [id, timer] of matching) { timers.delete(id); timer.fn(); } await flush(); },
    html() { return nodes.get('#main').innerHTML; },
    queue() { return JSON.parse(saved.get(key) || '[]'); }
  };
}
async function started() { const server = makeServer(), app = boot(server); await app.flush(); await app.submit('start-form', { title: 'Test strength' }); return { server, app }; }

test('empty UI, start, log, edit, remove, finish and save routine', async () => {
  const server = makeServer(), app = boot(server); await app.flush();
  assert.match(app.html(), /Start a workout/); assert.equal(server.state.sessions.length, 0);
  await app.submit('start-form', { title: 'Test <workout>' });
  assert.match(app.html(), /Test &lt;workout&gt;/); assert.doesNotMatch(app.html(), /<workout>/);
  await app.submit('set-form', setPayload);
  assert.equal(server.state.active_session.sets.length, 1);
  assert.equal(app.queue().length, 0);
  const id = server.state.active_session.sets[0].id;
  await app.submit('edit-form', { ...setPayload, load: '42.5' }, { id });
  assert.equal(server.state.active_session.sets[0].load, '42.5');
  await app.click('confirm-remove', { id }); assert.equal(server.state.active_session.sets.length, 0);
  await app.submit('set-form', setPayload);
  const sessionId = server.state.active_session.id;
  await app.click('confirm-finish'); assert.equal(server.state.active_session, null);
  assert.match(app.html(), /Look at all that work/);
  await app.submit('routine-form', { name: 'Repeatable workout' }, { id: sessionId });
  assert.equal(server.state.routines.length, 1); assert.equal(server.state.routines[0].template.length, 1);
  await app.click('start-routine', { id: server.state.routines[0].id });
  assert.equal(server.state.active_session.plan.length, 1); assert.equal(server.state.active_session.sets.length, 0);
});

test('lost response retries the exact persisted body without duplicating a saved set', async () => {
  const { server, app } = await started();
  server.failAfterApply = true;
  await app.submit('set-form', setPayload);
  assert.equal(server.state.active_session.sets.length, 1);
  assert.equal(app.queue()[0].phase, 'uncertain');
  const original = clone(app.queue()[0].body);
  assert.match(app.html(), /ON THIS DEVICE · NOT SAVED/);
  server.connected = true;
  await app.click('retry-sync');
  assert.equal(server.state.active_session.sets.length, 1); assert.equal(app.queue().length, 0);
  assert.deepEqual(server.requests.at(-1), original);
});

test('offline adds preserve independent IDs and sequential expected revisions', async () => {
  const { server, app } = await started();
  await app.event('offline'); server.connected = false;
  await app.submit('set-form', setPayload); await app.cooldown();
  await app.submit('set-form', { ...setPayload, reps: '10' }); await app.cooldown();
  const pending = app.queue(); assert.equal(pending.length, 2);
  assert.deepEqual(pending.map(item => item.body.expected_revision), [0, 1]);
  assert.notEqual(pending[0].body.request_id, pending[1].body.request_id);
  assert.equal(server.state.active_session.sets.length, 0);
  server.connected = true; await app.event('online');
  assert.equal(app.queue().length, 0); assert.equal(server.state.active_session.sets.length, 2);
  assert.deepEqual(server.requests.slice(-2), pending.map(item => item.body));
});

test('a revision conflict stops replay until explicit review and resend', async () => {
  const { server, app } = await started();
  await app.event('offline'); server.connected = false;
  await app.submit('set-form', setPayload); await app.cooldown();
  const oldId = app.queue()[0].body.request_id;
  server.state.active_session.revision = 1; server.connected = true;
  await app.event('online');
  assert.equal(app.queue()[0].phase, 'conflict'); assert.equal(server.state.active_session.sets.length, 0);
  const calls = server.requests.length;
  await app.click('retry-sync'); assert.equal(server.requests.length, calls, 'Retry connection must not silently replay a conflict');
  await app.click('review-queue'); assert.match(app.nodes.get('#dialog').innerHTML, /Review your pending sets/);
  await app.click('confirm-resend');
  assert.equal(app.queue().length, 0); assert.equal(server.state.active_session.sets.length, 1);
  assert.notEqual(server.requests.at(-1).request_id, oldId); assert.equal(server.requests.at(-1).expected_revision, 1);
});

test('pending queue survives a page restart with the same idempotency key', async () => {
  const { server, app } = await started();
  server.failAfterApply = true; await app.submit('set-form', setPayload);
  const original = clone(app.queue()[0].body);
  const resumed = boot(server, app.saved); await resumed.flush();
  assert.equal(resumed.queue()[0].body.request_id, original.request_id);
  server.connected = true; await resumed.click('retry-sync');
  assert.equal(resumed.queue().length, 0); assert.equal(server.state.active_session.sets.length, 1);
  assert.deepEqual(server.requests.at(-1), original);
});

test('double submit while a save is in flight creates only one request', async () => {
  const { server, app } = await started();
  const a = app.submit('set-form', setPayload); const b = app.submit('set-form', setPayload);
  await Promise.all([a, b]);
  assert.equal(server.state.active_session.sets.length, 1);
});

test('unreadable pending storage blocks commands instead of overwriting it', async () => {
  const server = makeServer(); const saved = new Map([[key, '{corrupt']]);
  const app = boot(server, saved); await app.flush();
  assert.match(app.html(), /Changes paused/);
  await app.submit('start-form', { title: 'Should not start' });
  assert.equal(server.requests.length, 0); assert.equal(saved.get(key), '{corrupt');
});

test('rendered frontend has no inline styles, script handlers, or external assets', async () => {
  const { app } = await started(); await app.submit('set-form', { ...setPayload, exercise: '<img src=x onerror=alert(1)>' });
  assert.doesNotMatch(app.html(), /<img|\sstyle=|\sonclick=/);
  assert.match(app.html(), /&lt;img/);
  assert.doesNotMatch(source, /style="|onclick="|https?:\/\//);
});

test('edit/finish cancellation and hash back-forward close dialogs without changes', async () => {
  const { server, app } = await started(); await app.submit('set-form', setPayload);
  const id = server.state.active_session.sets[0].id;
  const requests = server.requests.length;
  await app.click('edit-set', { id });
  assert.equal(app.nodes.get('#dialog').open, true); assert.match(app.nodes.get('#dialog').innerHTML, /Edit this set/);
  await app.click('close-dialog');
  assert.equal(app.nodes.get('#dialog').open, false); assert.equal(server.requests.length, requests);
  await app.click('finish'); assert.match(app.nodes.get('#dialog').innerHTML, /Finished sessions are read-only/);
  await app.go('history');
  assert.equal(app.nodes.get('#dialog').open, false); assert.match(app.html(), /The beginning of your progress/);
  await app.go('today'); assert.match(app.html(), /Test strength/);
  assert.equal(server.state.active_session.sets.length, 1); assert.equal(server.requests.length, requests);
});

test('queued-set discard is explicit, cancellable, and never removes a saved set', async () => {
  const { server, app } = await started(); await app.submit('set-form', setPayload);
  await app.event('offline'); server.connected = false;
  await app.submit('set-form', { ...setPayload, load: '45' }); await app.cooldown();
  await app.click('discard-queue'); assert.match(app.nodes.get('#dialog').innerHTML, /Discard pending changes/);
  await app.click('close-dialog'); assert.equal(app.queue().length, 1);
  await app.click('discard-queue'); await app.click('confirm-discard');
  assert.equal(app.queue().length, 0); assert.equal(server.state.active_session.sets.length, 1);
});

test('an uncertain request cannot be discarded before checking its saved status', async () => {
  const { server, app } = await started(); server.failAfterApply = true;
  await app.submit('set-form', setPayload);
  await app.click('discard-queue');
  assert.equal(app.nodes.get('#dialog').open, false); assert.equal(app.queue().length, 1);
  assert.match(app.nodes.get('#toast').textContent, /Retry this interrupted request first/);
  await app.click('confirm-discard'); assert.equal(app.queue().length, 1);
});

test('all tabs render empty states, exports, fallback single-tab note and progress history', async () => {
  const { server, app } = await started();
  await app.go('routines'); assert.match(app.html(), /Your repeatable routines live here/);
  await app.go('history'); assert.match(app.html(), /api\/export.csv/);
  await app.go('insights'); assert.match(app.html(), /Progress will take shape here/);
  assert.equal(app.nodes.get('#single-tab-note').hidden, false);
  server.state.summary = { finished_sessions: 2, total_sets: 2, volume_kg: 680, exercises: [{ exercise: 'Bench press', sets: 2, reps: 16, volume_kg: '680', best_load_kg: '45', comparison: { previous_session_id: 'old', last_session_id: 'new', volume_delta_kg: '40', total_reps_delta: 0, best_load_delta_kg: '5' }, history: [{ session_id: 'new', title: 'Latest strength', started_at: new Date().toISOString(), sets: [{ ...setPayload, load: '45', load_kg: '45' }], volume_kg: '360', total_reps: 8, best_load_kg: '45', mean_rpe: 7 }] }] };
  await app.click('retry-sync');
  assert.match(app.html(), /LATEST VS PREVIOUS SESSION/); assert.match(app.html(), /\+5 kg/); assert.match(app.html(), /\+40 kg/);
  assert.match(app.html(), /Latest strength/); assert.match(app.html(), /avg RPE 7/);
  assert.doesNotMatch(app.html(), /style="/);
});

test('a planned routine set only prefills the form until explicitly logged', async () => {
  const { server, app } = await started(); await app.submit('set-form', setPayload);
  const id = server.state.active_session.id;
  await app.click('confirm-finish'); await app.submit('routine-form', { name: 'Repeat' }, { id });
  await app.click('start-routine', { id: server.state.routines[0].id });
  const requests = server.requests.length;
  await app.click('use-plan', { index: '0' });
  assert.equal(server.requests.length, requests); assert.equal(server.state.active_session.sets.length, 0);
  assert.match(app.html(), /value="Bench press"/); assert.match(app.html(), /value="40"/);
});

test('malformed but valid-JSON state and draft caches cannot prevent startup', async () => {
  for (const bad of [{}, [], 'wrong', { sessions: [], routines: [], active_session: {} }, { sessions: [null], routines: [], active_session: null }]) {
    const server = makeServer(); const saved = new Map([['setwise.state.v1', JSON.stringify(bad)], ['setwise.draft.v1', 'null'], [key, '[]']]);
    const app = boot(server, saved); await app.flush();
    assert.match(app.html(), /Start a workout/); assert.equal(saved.get(key), '[]');
    await app.submit('start-form', { title: 'Recovered cleanly' });
    assert.match(app.html(), /Log a set/); assert.equal(server.state.active_session.title, 'Recovered cleanly');
  }
});

test('discarding an invalid presentation cache does not discard a durable pending command', async () => {
  const { server, app } = await started(); server.failAfterApply = true;
  await app.submit('set-form', setPayload);
  const original = clone(app.queue()[0].body);
  app.saved.set('setwise.state.v1', '{}'); app.saved.set('setwise.draft.v1', '[]');
  const resumed = boot(server, app.saved); await resumed.flush();
  assert.equal(resumed.queue()[0].body.request_id, original.request_id);
  server.connected = true; await resumed.click('retry-sync');
  assert.equal(resumed.queue().length, 0); assert.equal(server.state.active_session.sets.length, 1);
  assert.deepEqual(server.requests.at(-1), original);
});


test('routine without a prescribed weight requires actual load entry and keeps effort blank', async () => {
  const server = makeServer();
  server.state.routines.push({ id: 'choose-load', name: 'Squat return', created_at: '2026-10-19T12:00:00Z',
    notes: 'Two easy sets; three-minute rest.', template: [{ exercise: 'Barbell Back Squat', load: '0', unit: 'lb', reps: 5, rpe: null, load_unset: true, source_load: null, notes: 'Leave 4–5 reps available.' }] });
  const app = boot(server); await app.flush();
  await app.go('routines');
  assert.match(app.html(), /Two easy sets; three-minute rest/);
  await app.click('start-routine', { id: 'choose-load' });
  assert.equal(server.state.active_session.sets.length, 0);
  assert.match(app.html(), /Choose weight × 5/);
  await app.click('use-plan', { index: '0' });
  const draft = JSON.parse(app.saved.get('setwise.draft.v1'));
  assert.equal(draft.load, ''); assert.equal(draft.rpe, ''); assert.equal(draft.unit, 'lb');
  assert.equal(server.state.active_session.sets.length, 0);
});
