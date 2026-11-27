/* Setwise: same-origin, dependency-free workout journal. No analytics or remote assets. */
(() => {
  'use strict';
  const KEYS = { queue: 'setwise.pending.v1', cache: 'setwise.state.v1', draft: 'setwise.draft.v1' };
  const $ = (query, root = document) => root.querySelector(query);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  const number = (value, digits = 1) => Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: digits });
  const day = value => new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const fullDate = value => new Date(value).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
  const uuid = () => crypto.randomUUID ? crypto.randomUUID() : '10000000-1000-4000-8000-100000000000'.replace(/[018]/g, c => (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16));
  const iconPaths = {
    nutrition: '<circle cx="12" cy="12" r="9"/><path d="M8 6v12m-2-9h4m6-3v12m0-12c4 0 4 7 0 7"/>',
    today: '<rect x="4" y="5" width="16" height="16" rx="4"/><path d="M8 3v4m8-4v4M4 11h16m-11 5 2 2 4-4"/>',
    routines: '<rect x="4" y="4" width="7" height="7" rx="2"/><rect x="14" y="4" width="7" height="7" rx="2"/><rect x="4" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/>',
    history: '<path d="M3 11a9 9 0 1 1 2 7M3 4v7h7m2-4v6l4 2"/>',
    insights: '<path d="M4 20V10m8 10V4m8 16v-7"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    arrow: '<path d="M5 12h14m-5-5 5 5-5 5"/>',
    dumbbell: '<path d="M7 8v8m10-8v8M4 10v4m16-4v4M7 12h10M4 12H2m18 0h2"/>',
    check: '<path d="m5 12 4 4L19 6"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    edit: '<path d="m15 5 4 4M4 20l5-1L20 8a3 3 0 0 0-4-4L5 15l-1 5Z"/>',
    remove: '<path d="M3 6h18m-16 0 1 14h12l1-14M9 6V3h6v3m-5 4v6m4-6v6"/>',
    undo: '<path d="M3 10h10a7 7 0 0 1 0 14M3 10l6-6M3 10l6 6" transform="translate(1 -2) scale(.9)"/>',
    save: '<path d="M5 3h14v18l-7-4-7 4V3Z"/>',
    close: '<path d="m6 6 12 12M6 18 18 6"/>',
    download: '<path d="M12 3v12m-5-5 5 5 5-5M4 15v5h16v-5"/>',
    alert: '<path d="m12 3 10 18H2L12 3Z"/><path d="M12 9v5m0 3v.1"/>',
    cloud: '<path d="M7 18H6a4 4 0 1 1 0-8 6 6 0 0 1 11-3 5 5 0 0 1 1 10h-1m-5-5v9m-3-3 3 3 3-3"/>',
    repeat: '<path d="M4 9h14l-4-4m4 10H4l4 4m10-14 3 4-3 4M4 11l-3 4 3 4"/>',
    list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.1M3 12h.1M3 18h.1"/>',
    activity: '<path d="M2 12h5l3-8 4 16 3-8h5"/>',
    shield: '<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Z"/><path d="m8 12 3 3 5-6"/>',
    trophy: '<path d="M8 3h8v6a4 4 0 0 1-8 0V3Zm0 2H4v3a4 4 0 0 0 4 4m8-7h4v3a4 4 0 0 1-4 4m-4 1v6m-4 2h8"/>'
  };
  const icon = name => `<svg aria-hidden="true" viewBox="0 0 24 24">${iconPaths[name] || iconPaths.dumbbell}</svg>`;
  let storageProblem = '';
  function readStorage(key, fallback) {
    try { const value = localStorage.getItem(key); return value === null ? fallback : JSON.parse(value); }
    catch { if (key === KEYS.queue) storageProblem = 'Your pending-change storage could not be read. Changes are paused to keep your data safe.'; return fallback; }
  }
  const queue = readStorage(KEYS.queue, []);
  if (!Array.isArray(queue) || queue.some(item => !item?.body?.request_id || !item?.body?.action || !item?.body?.payload)) storageProblem = 'Your pending-change storage is invalid. Changes are paused to keep your data safe.';
  const state = {
    data: readStorage(KEYS.cache, null),
    tab: ['today', 'routines', 'history', 'insights', 'nutrition'].includes(location.hash.slice(1)) ? location.hash.slice(1) : 'today',
    pending: Array.isArray(queue) ? queue.map(item => ({ ...item, phase: item.phase === 'sending' ? 'uncertain' : item.phase })) : [],
    online: navigator.onLine, checked: false, loading: true, syncing: false, busy: false, fetching: false, writerReady: !navigator.locks,
    error: '', storageProblem, draft: readStorage(KEYS.draft, { exercise: '', load: '', unit: 'kg', reps: '8', rpe: '' }),
    startTitle: '', lastSaved: '', toastTimer: null, modalReturn: null
  };
  const record = value => !!value && typeof value === 'object' && !Array.isArray(value);
  const numeric = value => (typeof value === 'number' || typeof value === 'string') && value !== '' && Number.isFinite(Number(value));
  const validSet = value => record(value) && typeof value.exercise === 'string' && numeric(value.load) && ['kg', 'lb'].includes(value.unit) && Number.isInteger(Number(value.reps));
  const validSession = value => record(value) && typeof value.id === 'string' && typeof value.title === 'string' && ['active', 'finished'].includes(value.status) && Number.isInteger(value.revision) && typeof value.started_at === 'string' && Array.isArray(value.sets) && value.sets.every(validSet) && Array.isArray(value.plan) && value.plan.every(validSet);
  const validRoutine = value => record(value) && typeof value.id === 'string' && typeof value.name === 'string' && typeof value.created_at === 'string' && Array.isArray(value.template) && value.template.every(validSet);
  function validState(value) {
    return record(value) && Array.isArray(value.sessions) && value.sessions.every(validSession) && Array.isArray(value.routines) && value.routines.every(validRoutine) && (value.active_session == null || validSession(value.active_session)) && record(value.summary) && ['finished_sessions', 'total_sets', 'volume_kg'].every(key => numeric(value.summary[key])) && Array.isArray(value.summary.exercises) && value.summary.exercises.every(item => record(item) && typeof item.exercise === 'string' && ['sets', 'reps', 'volume_kg', 'best_load_kg'].every(key => numeric(item[key])) && (item.history == null || (Array.isArray(item.history) && item.history.every(entry => record(entry) && Array.isArray(entry.sets) && entry.sets.every(validSet)))));
  }
  // Presentation caches are disposable; pending commands are never cleared with them.
  if (!validState(state.data)) state.data = null;
  if (!record(state.draft)) state.draft = { exercise: '', load: '', unit: 'kg', reps: '8', rpe: '' };
  function store(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; }
    catch { state.storageProblem = 'This browser cannot save pending changes. Allow site storage or free up space before logging a set.'; return false; }
  }
  function persistQueue() { return store(KEYS.queue, state.pending); }
  function session() { return state.data?.active_session; }
  function finished() { return (state.data?.sessions || []).filter(item => item.status === 'finished').sort((a, b) => new Date(b.finished_at) - new Date(a.finished_at)); }
  function isLocked() { return state.busy || state.syncing || !state.writerReady || !!state.storageProblem; }
  function queueBlocked() { return state.pending.some(item => ['conflict', 'error'].includes(item.phase) || item.body.action !== 'log_set'); }
  function mutationDisabled() { return isLocked() || state.pending.length > 0 || !state.online; }
  function setDisabled() { return isLocked() || queueBlocked() || !session(); }
  const disabled = condition => condition ? ' disabled' : '';
  const stats = sets => ({ count: sets.length, reps: sets.reduce((sum, set) => sum + Number(set.reps), 0), volume: sets.reduce((sum, set) => sum + Number(set.load_kg ?? (set.unit === 'lb' ? Number(set.load) * .45359237 : set.load)) * Number(set.reps), 0) });
  function elapsed(item) {
    const diff = Math.max(0, Math.floor((new Date(item.finished_at || Date.now()) - new Date(item.started_at)) / 60000));
    return diff < 60 ? `${diff} min` : `${Math.floor(diff / 60)}h ${diff % 60}m`;
  }
  function loadText(set) { if (set.load_unset) return `Choose weight × ${number(set.reps, 0)}`; if (set.exercise_type === 'reps_only') return `${number(set.reps, 0)} reps`; return `${number(set.load, 3)} ${esc(set.unit)} × ${number(set.reps, 0)}`; }
  function toast(message) {
    const el = $('#toast'); el.textContent = message; el.classList.add('visible');
    clearTimeout(state.toastTimer); state.toastTimer = setTimeout(() => el.classList.remove('visible'), 3800);
  }
  async function request(path, options = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    try {
      const response = await fetch(path, { ...options, signal: controller.signal, headers: { 'Content-Type': 'application/json', ...options.headers }, cache: 'no-store' });
      let data; try { data = await response.json(); } catch { throw Object.assign(new Error('The server returned an unreadable response. Retry safely using the same request.'), { network: true }); }
      if (!response.ok) throw Object.assign(new Error(data.error?.message || 'The request could not be completed.'), { status: response.status, code: data.error?.code, details: data.error?.details });
      return data;
    } catch (error) {
      if (!error.status) error.network = true;
      throw error;
    } finally { clearTimeout(timeout); }
  }
  async function refresh({ renderPage = true, quiet = false } = {}) {
    if (state.fetching) return false;
    state.fetching = true;
    try {
      const data = await request('/api/state');
      if (!validState(data)) throw new Error('The server returned an invalid state.');
      const preference = data.imported_references?.find(item => item.kind === 'preferences')?.source_data;
      if (preference && !readStorage(KEYS.draft, null)) state.draft.unit = preference.weight_unit === 'lbs' ? 'lb' : 'kg';
      state.data = data; state.online = true; state.checked = true; state.error = ''; store(KEYS.cache, data);
      return true;
    } catch (error) {
      state.online = false; state.checked = true;
      if (!quiet) state.error = state.data ? 'The server is unreachable. Your last saved session is shown below.' : 'Could not reach your local server. Check that it is running, then try again.';
      return false;
    } finally {
      state.fetching = false; state.loading = false;
      if (renderPage) render(); else renderConnection();
    }
  }
  function applyResult(result) {
    if (!result || !state.data) return;
    if ('status' in result) {
      state.data.sessions = state.data.sessions.filter(item => item.id !== result.id);
      state.data.sessions.unshift(result);
      if (result.status === 'active') state.data.active_session = result;
      else if (state.data.active_session?.id === result.id) state.data.active_session = null;
    } else if ('template' in result) {
      state.data.routines = state.data.routines.filter(item => item.id !== result.id);
      state.data.routines.unshift(result);
    }
    store(KEYS.cache, state.data);
  }
  async function syncQueue() {
    if (state.syncing || !state.writerReady || !state.online || state.storageProblem || !state.pending.length) return;
    if (['conflict', 'error'].includes(state.pending[0].phase)) return;
    state.syncing = true; render();
    let completed = 0;
    try {
      while (state.pending.length && state.online && !state.storageProblem) {
        const item = state.pending[0];
        if (['conflict', 'error'].includes(item.phase)) break;
        item.phase = 'sending';
        if (!persistQueue()) break;
        renderConnection();
        try {
          const response = await request('/api/commands', { method: 'POST', body: JSON.stringify(item.body) });
          applyResult(response.result);
          state.pending.shift();
          if (!persistQueue()) { state.pending.unshift(item); break; }
          completed += 1;
          if (item.body.action !== 'log_set') state.lastSaved = '';
          if (item.body.action === 'finish_session') {
            state.tab = 'history'; location.hash = 'history';
            toast('Workout finished. Nice work showing up.');
          } else if (item.body.action === 'save_routine') toast('Routine saved. Ready for your next session.');
          else if (item.body.action === 'start_session') { state.tab = 'today'; location.hash = 'today'; toast('Session started. Make it count.'); }
          else if (item.body.action === 'log_set') state.lastSaved = response.result?.sets?.at(-1)?.id || '';
          else if (item.body.action === 'edit_set') toast('Set updated');
          else if (item.body.action === 'remove_set') toast('Set removed. You can undo that.');
          else if (item.body.action === 'undo') toast('Last set change undone');
          item.phase = 'saved';
        } catch (error) {
          item.message = error.message;
          item.code = error.code;
          if (error.network || error.status >= 500) {
            item.phase = 'uncertain'; state.online = false;
            item.message = 'The connection dropped. The server may already have saved this. Retrying the same request will not duplicate it.';
          } else if (error.status === 409) item.phase = 'conflict';
          else item.phase = 'error';
          persistQueue();
          if (!error.network) await refresh({ renderPage: false, quiet: true });
          break;
        }
      }
      if (completed && !state.pending.length) {
        await refresh({ renderPage: false, quiet: true });
        if (completed > 1) toast(`${completed} pending changes saved`);
        else if (state.lastSaved) toast('Set saved');
      }
    } finally { state.syncing = false; state.busy = false; render(); }
  }
  async function command(action, payload) {
    if (isLocked()) return false;
    if (action !== 'log_set' && (state.pending.length || !state.online)) { toast('Save pending changes and reconnect before continuing'); return false; }
    if (action === 'log_set' && queueBlocked()) return false;
    const body = { request_id: uuid(), action, payload };
    if (!['start_session', 'save_routine'].includes(action)) {
      const previous = state.pending.filter(item => item.body.payload.session_id === payload.session_id).at(-1);
      body.expected_revision = previous ? previous.body.expected_revision + 1 : session()?.revision;
    }
    const item = { body, phase: 'queued', created_at: new Date().toISOString() };
    state.pending.push(item);
    if (!persistQueue()) { state.pending.pop(); render(); return false; }
    state.busy = true;
    if (state.online) { state.busy = false; await syncQueue(); }
    else {
      render(); toast('Set queued on this device. Not yet saved to the server.');
      setTimeout(() => { state.busy = false; render(); }, 600);
    }
    return true;
  }
  function renderNavigation() {
    const nav = [['today', 'Today'], ['routines', 'Routines'], ['history', 'History'], ['insights', 'Insights'], ['nutrition', 'Nutrition']].map(([key, label]) => `<a class="nav-link${state.tab === key ? ' active' : ''}" href="#${key}"${state.tab === key ? ' aria-current="page"' : ''}>${icon(key)}<span>${label}</span>${state.tab === key ? '<span class="nav-arrow" aria-hidden="true">›</span>' : ''}</a>`).join('');
    $('#desktop-nav').innerHTML = nav; $('#mobile-nav').innerHTML = nav;
  }
  function renderConnection() {
    const el = $('#connection');
    const label = state.syncing ? 'Saving changes' : !state.checked ? 'Connecting' : state.online ? (state.pending.length ? `${state.pending.length} pending` : 'Connected locally') : 'Offline';
    el.className = `connection ${state.online && state.checked ? 'online' : 'offline'}`;
    el.innerHTML = `<span class="status-dot"></span><span>${esc(label)}</span>`;
  }
  function renderNotices() {
    let html = '';
    if (state.storageProblem) html += `<div class="notice error">${icon('alert')}<div><strong>Changes paused</strong><p>${esc(state.storageProblem)} Your server-saved workouts are unaffected.</p></div></div>`;
    const first = state.pending[0];
    if (first && ['conflict', 'error'].includes(first.phase)) {
      const canReview = first.code === 'revision_conflict' && state.pending.every(item => item.body.action === 'log_set') && session()?.id === first.body.payload.session_id;
      html += `<div class="notice error">${icon('alert')}<div><strong>${first.phase === 'conflict' ? 'These changes need your review' : 'A change could not be saved'}</strong><p>${esc(first.message || 'The session changed elsewhere.')} Nothing will be overwritten automatically.</p><div class="notice-actions">${canReview ? `<button class="btn small secondary" data-action="review-queue"${disabled(isLocked() || !state.online)}>Review & retry</button>` : ''}<button class="btn small secondary" data-action="discard-queue"${disabled(isLocked())}>Discard pending changes</button></div></div></div>`;
    } else if (first) {
      const uncertain = first.phase === 'uncertain';
      html += `<div class="notice">${icon('cloud')}<div><strong>${state.syncing ? 'Saving your changes…' : `${state.pending.length} ${state.pending.length === 1 ? 'change' : 'changes'} waiting to save`}</strong><p>${uncertain ? 'A request was interrupted. Retry is safe: the same request will never create a duplicate.' : 'Stored on this device, separate from your saved sets. Keep this page open to sync when the server returns.'}</p>${!state.syncing ? `<div class="notice-actions"><button class="btn small secondary" data-action="retry-sync"${disabled(isLocked())}>Retry connection</button>${state.pending.every(item => item.phase === 'queued') ? '<button class="btn small secondary" data-action="discard-queue">Discard queued changes</button>' : ''}</div>` : ''}</div></div>`;
    } else if (!state.online && state.checked) html += `<div class="notice">${icon('cloud')}<div><strong>You’re offline</strong><p>${esc(state.error || 'The local server is unavailable.')} ${session() ? 'New sets can be queued on this device.' : 'Reconnect to start a workout.'}</p><div class="notice-actions"><button class="btn small secondary" data-action="retry-sync">Try again</button></div></div></div>`;
    return html;
  }
  const heading = (eyebrow, title, subtitle, extra = '') => `<div class="heading-row${extra ? ' exports' : ''}"><div><p class="eyebrow">${eyebrow}</p><h1>${title}</h1><p class="subtext">${subtitle}</p></div>${extra || `<span class="date-label">${esc(fullDate(Date.now()))}</span>`}</div>`;
  const empty = (symbol, title, text, action = '', full = false) => `<div class="empty-state${full ? ' full-empty' : ''}"><div class="empty-icon">${icon(symbol)}</div><h3>${title}</h3><p>${text}</p>${action}</div>`;
  function statsCards(sets, label = 'This session') {
    const s = stats(sets);
    return `<div class="stats-grid"><div class="stat"><div class="stat-label">${icon('dumbbell')} Sets logged</div><div class="stat-value">${s.count}</div><div class="stat-note">${label}</div></div><div class="stat"><div class="stat-label">${icon('repeat')} Total reps</div><div class="stat-value">${number(s.reps, 0)}</div><div class="stat-note">One rep at a time</div></div><div class="stat"><div class="stat-label">${icon('activity')} Volume</div><div class="stat-value">${number(s.volume, 0)}<span class="stat-unit">kg</span></div><div class="stat-note">Load × reps</div></div></div>`;
  }
  function recentCard() {
    const list = finished().slice(0, 3);
    return `<section class="card"><div class="section-top"><h2>Recent sessions</h2><a class="btn text" href="#history">View all ${icon('arrow')}</a></div>${list.length ? list.map(item => `<div class="list-item"><div class="icon-box grey">${icon('check')}</div><div class="list-item-content"><h3>${esc(item.title)}</h3><p>${esc(day(item.finished_at))} · ${item.sets.length} sets · ${elapsed(item)}</p></div><button class="icon-button" data-action="view-session" data-id="${esc(item.id)}" aria-label="View ${esc(item.title)}">${icon('arrow')}</button></div>`).join('') : empty('history', 'Your story starts here', 'Finish a workout and it’ll find a home here.')}</section>`;
  }
  function renderToday() {
    const active = session();
    if (!active) {
      return heading('SHOW UP FOR YOURSELF', 'Small steps. Stronger you.', 'A simple space to put in the work.') + renderNotices() + `<section class="hero"><div><p class="eyebrow">YOUR NEXT CHAPTER</p><h2>Every strong day<br>starts with one set.</h2><p>Start a session, log the work, and build on it.</p></div><div class="hero-art" aria-hidden="true"><i class="weight bar"></i><i class="weight plate-a"></i><i class="weight plate-b"></i><i class="weight plate-c"></i><i class="weight plate-d"></i></div></section><div class="content-grid"><section class="card"><div class="card-header"><div class="title-with-icon"><div class="icon-box">${icon('plus')}</div><div><h2>Start a workout</h2><p class="subtext">A fresh session. A little more progress.</p></div></div></div><form id="start-form"><div class="form-group"><label for="session-title">Session name</label><input id="session-title" name="title" autocomplete="off" maxlength="100" placeholder="e.g. Monday strength" value="${esc(state.startTitle)}" required></div><button class="btn full" type="submit"${disabled(mutationDisabled())}>${icon('plus')} Start session</button></form>${state.data.routines.length ? `<div class="scope-label">Have a plan? <a href="#routines">Start from a saved routine</a></div>` : '<p class="scope-label">No plan needed. Add exercises as you go, then save your session as a routine.</p>'}</section><div class="stack">${recentCard()}<aside class="card tip-card"><p class="eyebrow">BUILT AROUND YOUR PROGRESS</p><h3>Make consistency the goal.</h3><p>Repeat a routine, notice the small wins, and come back for the next set.</p></aside></div></div>`;
    }
    const pendingSets = state.pending.filter(item => item.body.action === 'log_set' && item.body.payload.session_id === active.id);
    return heading('ONE SET AT A TIME', 'You’re putting in the work.', 'Keep it simple. Keep it moving.') + renderNotices() + `<section class="hero session-hero"><div><p class="eyebrow">CURRENT SESSION</p><h2>${esc(active.title)}</h2><div class="session-meta"><span>${icon('clock')}<span class="elapsed" data-started="${esc(active.started_at)}">${elapsed(active)}</span></span><span>${icon('dumbbell')}${new Set(active.sets.map(set => set.exercise)).size} exercises</span></div></div><div class="hero-badge"><span class="status-dot"></span>IN PROGRESS</div></section>${statsCards(active.sets)}<div class="content-grid"><section class="card"><div class="card-header"><div class="title-with-icon"><div class="icon-box">${icon('dumbbell')}</div><div><h2>Log a set</h2><p class="subtext">Your next rep starts here.</p></div></div></div>${active.plan?.length ? renderPlan(active.plan) : ''}<form id="set-form">${setFields(state.draft, 'log')}<button class="btn full" type="submit"${disabled(setDisabled())}>${state.syncing ? '<span class="spinner"></span> Saving…' : `${icon('plus')} ${state.online ? 'Log set' : 'Queue set offline'}`}</button><p class="form-help">${state.online ? 'Each set saves to your local server. Edit or undo anytime during the session.' : 'This set stays on this device until the local server reconnects.'}</p></form></section><section class="card"><div class="section-top"><h2>Your session <span class="pill">${active.sets.length} ${active.sets.length === 1 ? 'set' : 'sets'}</span></h2><button class="btn text" data-action="undo"${disabled(mutationDisabled() || !active.can_undo)}>${icon('undo')} Undo</button></div><div class="session-summary"><span>Logged and saved</span><span class="pill saved">${icon('check')} Server saved</span></div>${active.sets.length ? renderSets(active.sets, true) : empty('dumbbell', 'Ready for your first set', 'Choose an exercise and log your load and reps.')}${pendingSets.length ? `<div class="pending-list"><div class="pending-title">${icon('cloud')} ON THIS DEVICE · NOT SAVED</div>${pendingSets.map(item => `<div class="pending-row"><strong>${esc(item.body.payload.exercise)}</strong>${loadText(item.body.payload)}${item.body.payload.rpe != null ? ` · RPE ${number(item.body.payload.rpe)}` : ''}<div class="pending-meta">${item.phase === 'conflict' ? 'Needs review before saving' : item.phase === 'error' ? 'Could not save' : item.phase === 'uncertain' ? 'Awaiting server confirmation' : 'Waiting to sync'}</div></div>`).join('')}</div>` : ''}<div class="session-actions"><button class="btn full" data-action="finish"${disabled(mutationDisabled())}>${icon('check')} Finish workout</button></div><p class="scope-label">Finish to add this workout to your history and insights.</p></section></div>`;
  }
  function setFields(values, prefix) {
    const exercises = [...new Set([...(state.data?.summary?.exercises || []).map(item => item.exercise), ...Object.values(state.data?.sessions || []).flatMap(item => item.sets.map(set => set.exercise)), 'Back squat', 'Bench press', 'Deadlift', 'Overhead press', 'Barbell row', 'Pull-up', 'Romanian deadlift', 'Dumbbell curl'])];
    return `<div class="form-group"><label for="${prefix}-exercise">Exercise</label><input id="${prefix}-exercise" name="exercise" list="${prefix}-exercises" maxlength="100" placeholder="e.g. Bench press" value="${esc(values.exercise)}" autocomplete="off" required><datalist id="${prefix}-exercises">${exercises.map(name => `<option value="${esc(name)}"></option>`).join('')}</datalist></div><div class="form-group field-row"><div class="field"><label for="${prefix}-load">Weight</label><div class="load-field"><input id="${prefix}-load" name="load" type="number" inputmode="decimal" min="0" max="2000" step="0.0001" value="${esc(values.load)}" placeholder="0" required><label for="${prefix}-unit" class="visually-hidden">Weight unit</label><select id="${prefix}-unit" name="unit"><option value="kg"${values.unit === 'kg' ? ' selected' : ''}>kg</option><option value="lb"${values.unit === 'lb' ? ' selected' : ''}>lb</option></select></div></div><div class="field"><label for="${prefix}-reps">Reps</label><input id="${prefix}-reps" name="reps" type="number" inputmode="numeric" min="1" max="1000" step="1" value="${esc(values.reps)}" placeholder="8" required></div><div class="field"><label for="${prefix}-rpe">RPE <span class="optional">(opt.)</span></label><input id="${prefix}-rpe" name="rpe" type="number" inputmode="decimal" min="1" max="10" step="0.5" value="${esc(values.rpe ?? '')}" placeholder="—"></div></div><p class="form-help rpe-help">RPE is effort from 1–10. Use 0 weight for unweighted sets.</p>`;
  }
  function renderPlan(plan) {
    return `<details class="plan"><summary>Your routine · ${plan.length} planned ${plan.length === 1 ? 'set' : 'sets'}</summary><div class="plan-items">${plan.map((set, index) => `<div class="plan-row"><div><strong>${esc(set.exercise)}</strong><p>${loadText(set)}${set.rest_seconds != null ? ` · ${number(set.rest_seconds, 0)}s rest` : ''}${set.notes ? ` · ${esc(set.notes)}` : ''}${set.rpe != null ? ` · RPE ${number(set.rpe)}` : ''}</p></div><button class="btn text" type="button" data-action="use-plan" data-index="${index}"${disabled(setDisabled())}>Use ${icon('arrow')}</button></div>`).join('')}</div></details>`;
  }
  function renderSets(sets, editable) {
    const groups = new Map();
    sets.forEach(set => { if (!groups.has(set.exercise)) groups.set(set.exercise, []); groups.get(set.exercise).push(set); });
    return [...groups.entries()].map(([exercise, group]) => `<div class="set-group"><div class="set-group-header"><h3>${esc(exercise)}</h3><span>${group.length} ${group.length === 1 ? 'set' : 'sets'}</span></div>${group.map((set, index) => `<div class="set-row${set.id === state.lastSaved ? ' saved-flash' : ''}"><span class="set-number">${index + 1}</span><div><div class="set-primary">${loadText(set)}<span class="set-meta">${set.exercise_type === 'reps_only' ? '' : ' reps'}</span></div><div class="set-meta">${set.rpe != null ? `RPE ${number(set.rpe)}${set.rpe_source ? ` (${esc(set.rpe_source)})` : ''} · ` : ''}${set.set_type && set.set_type !== 'normal' ? `${esc(set.set_type)} · ` : ''}${set.notes ? `${esc(set.notes)} · ` : ''}${set.rest_seconds != null ? `${number(set.rest_seconds, 0)}s rest · ` : ''}${set.exercise_type === 'reps_only' ? 'Reps only; no weight recorded' : `${number(Number(set.load_kg ?? (set.unit === 'lb' ? Number(set.load) * .45359237 : set.load)) * Number(set.reps))} kg volume`}</div></div>${editable ? `<div class="set-actions"><button class="icon-button" data-action="edit-set" data-id="${esc(set.id)}" aria-label="Edit ${esc(exercise)} set ${index + 1}"${disabled(mutationDisabled())}>${icon('edit')}</button><button class="icon-button danger" data-action="remove-set" data-id="${esc(set.id)}" aria-label="Remove ${esc(exercise)} set ${index + 1}"${disabled(mutationDisabled())}>${icon('remove')}</button></div>` : ''}</div>`).join('')}</div>`).join('');
  }
  function renderRoutines() {
    const routines = state.data.routines;
    return heading('YOUR REPEATABLE GOOD DAYS', 'A plan worth coming back to.', 'Turn a great session into your next starting point.') + renderNotices() + (routines.length ? `${session() ? '<div class="notice info">' + icon('routines') + '<div>Finish your active workout before starting another routine.</div></div>' : ''}<div class="routine-grid">${routines.map(item => `<section class="card routine-card"><div class="routine-top"><div class="icon-box">${icon('routines')}</div><span class="pill">${item.template.length} planned sets</span></div><h2>${esc(item.name)}</h2>${item.notes ? `<p class="subtext">${esc(item.notes)}</p>` : ''}<p class="routine-detail">${new Set(item.template.map(set => set.exercise)).size} exercises · Saved ${esc(day(item.created_at))}</p><div class="routine-exercises">${[...new Set(item.template.map(set => set.exercise))].map(name => `<span>${esc(name)}</span>`).join('')}</div><button class="btn soft" data-action="start-routine" data-id="${esc(item.id)}"${disabled(mutationDisabled() || !!session())}>Start routine ${icon('arrow')}</button></section>`).join('')}</div><p class="scope-label">Routine sets are suggestions. Nothing is logged until you add it during your session.</p>` : `<section class="card">${empty('routines', 'Your repeatable routines live here', 'After a workout, save it as a routine. Your exercises, weights, and reps will be ready next time.', '<a class="btn" href="#today">Go to your workout ' + icon('arrow') + '</a>', true)}</section>`);
  }
  function renderHistory() {
    const list = finished();
    return heading('A RECORD OF SHOWING UP', 'Look at all that work.', 'Every finished session, all in one place.', exportButtons()) + renderNotices() + (list.length ? `<p class="history-label">${list.length} finished ${list.length === 1 ? 'session' : 'sessions'} · newest first</p><div class="history-grid">${list.map(item => `<section class="card history-card"><div class="history-date">${esc(fullDate(item.finished_at))}</div><h2>${esc(item.title)}</h2><div class="history-stats"><span><strong>${item.sets.length}</strong> sets</span><span><strong>${number(stats(item.sets).volume, 0)}</strong> kg volume</span><span><strong>${elapsed(item)}</strong></span></div><div class="history-actions"><button class="btn secondary small" data-action="view-session" data-id="${esc(item.id)}">View session ${icon('arrow')}</button><button class="btn soft small" data-action="save-routine" data-id="${esc(item.id)}"${disabled(mutationDisabled() || !item.sets.length)}>${icon('save')} Save routine</button></div></section>`).join('')}</div>` : `<section class="card">${empty('history', 'The beginning of your progress', 'Your finished workouts will appear here. Start with one session and build from there.', '<a class="btn" href="#today">Go to your workout ' + icon('arrow') + '</a>', true)}</section>`);
  }
  function exportButtons() { return '<div class="export-links"><a class="btn secondary small" href="/api/export.csv" download="setwise-workouts.csv" aria-label="Export all workout sets as CSV">' + icon('download') + ' CSV</a><a class="btn secondary small" href="/api/export.json" download="setwise-backup.json" aria-label="Export workout backup as JSON">JSON</a></div>'; }
  function renderProgression(item) {
    const history = item.history || [];
    const comparison = item.comparison;
    const delta = (value, unit) => `${Number(value) > 0 ? '+' : ''}${number(value)}${unit ? ' ' + unit : ''}`;
    const latest = history[0];
    return `<div class="progression"><p class="progression-label">LATEST VS PREVIOUS SESSION</p>${comparison ? `<div class="comparison-grid"><div><strong>${delta(comparison.best_load_delta_kg, 'kg')}</strong><span>Heaviest load</span></div><div><strong>${delta(comparison.total_reps_delta, '')}</strong><span>Total reps</span></div><div><strong>${delta(comparison.volume_delta_kg, 'kg')}</strong><span>Volume</span></div></div>` : '<p class="comparison-empty">Finish another session with this exercise to compare.</p>'}${history.length ? `<details class="exercise-history"><summary>Session history · ${history.length} ${history.length === 1 ? 'session' : 'sessions'}</summary>${history.map(entry => `<div class="exercise-history-row"><div class="analysis-row"><strong>${esc(day(entry.started_at))} · ${esc(entry.title)}</strong><button class="btn text" data-action="view-session" data-id="${esc(entry.session_id)}" aria-label="View ${esc(entry.title)}">${icon('arrow')}</button></div><p>${entry.sets.length} sets · ${entry.total_reps} reps · ${number(entry.volume_kg)} kg volume${entry.mean_rpe != null ? ' · avg RPE ' + number(entry.mean_rpe) : ''}</p><div class="history-set-chips">${entry.sets.map(set => `<span>${loadText(set)}${set.rpe != null ? ' · RPE ' + number(set.rpe) : ''}</span>`).join('')}</div></div>`).join('')}</details>` : ''}</div>`;
  }
  function renderInsights() {
    const summary = state.data.summary || { finished_sessions: 0, total_sets: 0, volume_kg: 0, exercises: [] };
    const exercises = [...(summary.exercises || [])].sort((a, b) => Number(b.volume_kg) - Number(a.volume_kg));
    const maxVolume = Math.max(1, ...exercises.map(item => Number(item.volume_kg)));
    const dates = Array.from({ length: 7 }, (_, index) => { const date = new Date(); date.setDate(date.getDate() - 6 + index); date.setHours(0, 0, 0, 0); return date; });
    const week = dates.map(date => ({ day: date.toLocaleDateString(undefined, { weekday: 'narrow' }), count: finished().filter(item => { const when = new Date(item.finished_at); return when >= date && when < new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1); }).length }));
    const maxCount = Math.max(1, ...week.map(item => item.count));
    return heading('PROGRESS, IN PERSPECTIVE', 'Your effort adds up.', 'A clear view of the work you’ve already done.') + renderNotices() + `<div class="stats-grid"><div class="stat"><div class="stat-label">${icon('check')} Sessions</div><div class="stat-value">${summary.finished_sessions}</div><div class="stat-note">Finished workouts</div></div><div class="stat"><div class="stat-label">${icon('dumbbell')} Total sets</div><div class="stat-value">${number(summary.total_sets, 0)}</div><div class="stat-note">Logged with intention</div></div><div class="stat"><div class="stat-label">${icon('activity')} Total volume</div><div class="stat-value">${number(summary.volume_kg, 0)}<span class="stat-unit">kg</span></div><div class="stat-note">Load × reps</div></div></div><div class="analysis-grid"><section class="card"><div class="card-header"><div><h2>Exercise breakdown</h2><p class="subtext">Your saved work, exercise by exercise.</p></div><div class="icon-box">${icon('insights')}</div></div>${exercises.length ? exercises.map(item => `<div class="exercise-analysis"><div class="analysis-row"><strong>${esc(item.exercise)}</strong><span>${number(item.volume_kg)} kg</span></div><progress class="volume-bar" aria-hidden="true" max="${maxVolume}" value="${Number(item.volume_kg)}"></progress><div class="analysis-details"><span>${item.sets} sets · ${item.reps} reps</span><span>Best load ${number(item.best_load_kg)} kg</span></div>${renderProgression(item)}</div>`).join('') : empty('activity', 'Progress will take shape here', 'Finish your first workout to see your exercise stats.')}<p class="scope-label">Finished sessions only. All loads convert to kg for comparison. Volume is weight × reps; unweighted sets add no load volume. Best load is your heaviest logged set, not an estimated max.</p></section><div class="stack"><section class="card"><div class="section-top"><h2>Your last 7 days</h2><span class="pill">Consistency</span></div><div class="metric-big">${week.reduce((sum, item) => sum + item.count, 0)} <span>sessions</span></div><p class="subtext">Every session is a step forward.</p><div class="activity-chart" role="img" aria-label="Finished workouts over the past seven days: ${week.map((item, index) => `${day(dates[index])}: ${item.count}`).join('; ')}">${week.map(item => `<div class="chart-column"><svg class="chart-svg" viewBox="0 0 24 80" aria-hidden="true"><rect class="chart-rect${!item.count ? ' empty' : ''}" x="0" y="${80 - (item.count ? item.count / maxCount * 76 : 4)}" width="24" height="${item.count ? item.count / maxCount * 76 : 4}" rx="4"/></svg><span class="chart-label">${item.day}</span></div>`).join('')}</div></section><aside class="card tip-card"><p class="eyebrow">YOUR DATA, YOURS TO KEEP</p><h3>Take your progress with you.</h3><p>Export a CSV to explore your sets, or a JSON backup of your sessions and routines.</p><div class="space-above">${exportButtons()}</div></aside></div></div>`;
  }
  function render() {
    renderNavigation(); renderConnection();
    if (!state.data) {
      $('#main').innerHTML = state.loading ? '<section class="card loading-card"><span class="spinner"></span><p class="subtext space-above">Opening your workout journal…</p></section>' : heading('YOUR WORKOUT JOURNAL', 'Let’s get you connected.', 'Your local server keeps your workouts safe.') + renderNotices();
      return;
    }
    if (state.tab === 'nutrition') {
      if (window.SetwiseNutrition) window.SetwiseNutrition.mount($('#main'));
      else $('#main').innerHTML = heading('NUTRITION', 'Reload to open nutrition.', 'The nutrition interface could not load. Reconnect to your local server and reload.');
      return;
    }
    const renderers = { today: renderToday, routines: renderRoutines, history: renderHistory, insights: renderInsights };
    $('#main').onsubmit = $('#main').oninput = $('#main').onchange = $('#main').onclick = null;
    $('#main').innerHTML = renderers[state.tab]();
  }
  function openDialog(title, content) {
    state.modalReturn = document.activeElement;
    const dialog = $('#dialog');
    dialog.innerHTML = `<div class="dialog-top"><h2 id="dialog-title">${esc(title)}</h2><button class="icon-button" data-action="close-dialog" aria-label="Close dialog">${icon('close')}</button></div>${content}`;
    if (!dialog.open) dialog.showModal();
    setTimeout(() => { const field = $('input:not([type="hidden"])', dialog); if (field) { field.focus(); field.select(); } }, 30);
  }
  function closeDialog() { $('#dialog').close(); if (state.modalReturn?.isConnected) state.modalReturn.focus(); }
  function showDialogError(message) {
    let error = $('.inline-error', $('#dialog'));
    if (!error) { error = document.createElement('div'); error.className = 'inline-error'; error.setAttribute('role', 'alert'); $('#dialog').append(error); }
    error.textContent = message;
  }
  function getSession(id) { return state.data?.sessions.find(item => item.id === id) || (session()?.id === id ? session() : null); }
  function showSession(id) {
    const item = getSession(id); if (!item) return;
    openDialog(item.title, `<div class="dialog-body"><p>${esc(fullDate(item.finished_at || item.started_at))} · ${elapsed(item)} · ${item.sets.length} sets</p>${item.source ? `<p>Imported from ${esc(item.source.system)} · ${esc(item.started_at)} – ${esc(item.finished_at)}</p>` : ''}${item.notes ? `<p>${esc(item.notes)}</p>` : ''}</div><div class="dialog-detail">${item.sets.length ? renderSets(item.sets, false) : '<p class="subtext">No sets were logged in this session.</p>'}</div><div class="dialog-actions"><button class="btn secondary" data-action="view-events" data-id="${esc(id)}">View audit log</button><button class="btn soft" data-action="save-routine" data-id="${esc(id)}"${disabled(mutationDisabled() || !item.sets.length)}>${icon('save')} Save routine</button></div>`);
  }
  async function retryConnection() {
    if (state.syncing || state.busy) return;
    state.busy = true; render();
    await refresh(); state.busy = false;
    if (state.online) await syncQueue();
    render();
  }
  async function reviewQueue() {
    const ok = await refresh({ renderPage: true });
    if (!ok) { toast('Reconnect before reviewing changes'); return; }
    const pendingSets = state.pending;
    if (!pendingSets.length || pendingSets.some(item => item.body.action !== 'log_set') || session()?.id !== pendingSets[0].body.payload.session_id) { toast('This workout is no longer active. Review its history before discarding pending changes.'); return; }
    openDialog('Review your pending sets', `<div class="dialog-body"><p>The saved session changed. Review the latest saved sets and these pending sets before adding them. They will be new sets; existing sets will stay as they are.</p><p><strong>${session().sets.length} sets currently saved</strong> · revision ${session().revision}</p></div><details class="plan"><summary>View current saved sets</summary><div class="plan-preview">${session().sets.length ? renderSets(session().sets, false) : '<p class="subtext">No saved sets.</p>'}</div></details><div class="dialog-detail">${pendingSets.map(item => `<div class="review-item"><strong>${esc(item.body.payload.exercise)}</strong><br>${loadText(item.body.payload)}${item.body.payload.rpe != null ? ` · RPE ${number(item.body.payload.rpe)}` : ''}</div>`).join('')}</div><div class="dialog-actions"><button class="btn secondary" data-action="close-dialog">Cancel</button><button class="btn" data-action="confirm-resend">Resend ${pendingSets.length} ${pendingSets.length === 1 ? 'set' : 'sets'}</button></div>`);
  }
  function formValues(form) {
    const data = new FormData(form);
    return { exercise: String(data.get('exercise')).trim(), load: String(data.get('load')).trim(), unit: data.get('unit'), reps: Number(data.get('reps')), rpe: data.get('rpe') === '' ? null : Number(data.get('rpe')) };
  }
  document.addEventListener('input', event => {
    if (event.target.closest('#set-form')) { const data = new FormData($('#set-form')); state.draft = Object.fromEntries(data); store(KEYS.draft, state.draft); }
    if (event.target.id === 'session-title') state.startTitle = event.target.value;
  });
  document.addEventListener('change', event => {
    if (event.target.closest('#set-form')) { state.draft = Object.fromEntries(new FormData($('#set-form'))); store(KEYS.draft, state.draft); }
  });
  document.addEventListener('submit', async event => {
    const form = event.target;
    if (!['start-form', 'set-form', 'edit-form', 'routine-form'].includes(form.id)) return;
    event.preventDefault();
    if (!form.reportValidity() || isLocked()) return;
    if (form.id === 'start-form') {
      const title = String(new FormData(form).get('title')).trim();
      if (!title) { toast('Give your session a name'); return; }
      await command('start_session', { title });
    } else if (form.id === 'set-form') {
      const values = formValues(form);
      if (!values.exercise) { toast('Choose an exercise first'); return; }
      if (!session()) return;
      await command('log_set', { session_id: session().id, ...values });
    } else if (form.id === 'edit-form') {
      const values = formValues(form);
      if (!values.exercise) { showDialogError('Choose an exercise.'); return; }
      const id = form.dataset.id; closeDialog();
      await command('edit_set', { session_id: session().id, set_id: id, ...values });
    } else if (form.id === 'routine-form') {
      const name = String(new FormData(form).get('name')).trim();
      if (!name) { showDialogError('Give your routine a name.'); return; }
      const id = form.dataset.id; closeDialog(); await command('save_routine', { name, session_id: id });
    }
  });
  document.addEventListener('click', async event => {
    const target = event.target.closest('[data-action]');
    if (!target || target.disabled) return;
    const action = target.dataset.action, id = target.dataset.id;
    if (action === 'close-dialog') { closeDialog(); return; }
    if (action === 'retry-sync') { await retryConnection(); return; }
    if (action === 'view-session') { showSession(id); return; }
    if (action === 'view-events') {
      target.disabled = true;
      try { const events = await request(`/api/sessions/${encodeURIComponent(id)}/events`); openDialog('Session audit log', `<p class="subtext space-below">An append-only record of saved changes.</p><pre class="audit-list">${esc(JSON.stringify(events, null, 2))}</pre><button class="btn secondary full" data-action="view-session" data-id="${esc(id)}">Back to session</button>`); }
      catch (error) { showDialogError(error.message); target.disabled = false; }
      return;
    }
    if (isLocked()) return;
    if (action === 'use-plan') {
      const set = session()?.plan[Number(target.dataset.index)]; if (!set) return;
      state.draft = { exercise: set.exercise, load: set.load_unset ? '' : set.load, unit: set.unit, reps: set.reps, rpe: set.rpe ?? '' }; store(KEYS.draft, state.draft); render();
      $('#log-load')?.focus(); return;
    }
    if (action === 'edit-set') {
      const set = session()?.sets.find(item => item.id === id); if (!set) return;
      openDialog('Edit this set', `<form id="edit-form" data-id="${esc(id)}">${setFields(set, 'edit')}<div class="dialog-actions"><button class="btn secondary" type="button" data-action="close-dialog">Cancel</button><button class="btn" type="submit">Save changes</button></div></form>`);
    } else if (action === 'remove-set') {
      const set = session()?.sets.find(item => item.id === id); if (!set) return;
      openDialog('Remove this set?', `<div class="dialog-body"><p><strong>${esc(set.exercise)}</strong><br>${loadText(set)}</p><p>You can bring it back with Undo while this session is active.</p></div><div class="dialog-actions"><button class="btn secondary" data-action="close-dialog">Keep set</button><button class="btn danger" data-action="confirm-remove" data-id="${esc(id)}">Remove set</button></div>`);
    } else if (action === 'confirm-remove') { closeDialog(); await command('remove_set', { session_id: session().id, set_id: id }); }
    else if (action === 'undo') await command('undo', { session_id: session().id });
    else if (action === 'finish') {
      openDialog('Finish this workout?', `<div class="dialog-body"><p>You logged <strong>${session().sets.length} ${session().sets.length === 1 ? 'set' : 'sets'}</strong> in <strong>${elapsed(session())}</strong>. Your session will move to History, ready to review or save as a routine.</p><p>Finished sessions are read-only in this version. Check your sets before finishing.</p></div><div class="dialog-actions"><button class="btn secondary" data-action="close-dialog">Keep training</button><button class="btn" data-action="confirm-finish">${icon('check')} Finish workout</button></div>`);
    } else if (action === 'confirm-finish') { closeDialog(); state.lastSaved = ''; await command('finish_session', { session_id: session().id }); }
    else if (action === 'save-routine') {
      const item = getSession(id); if (!item) return;
      openDialog('Save a little structure', `<div class="dialog-body"><p>Reuse these ${item.sets.length} sets as a starting point for your next workout. You can adjust each set as you go.</p></div><form id="routine-form" data-id="${esc(id)}"><div class="form-group"><label for="routine-name">Routine name</label><input id="routine-name" name="name" maxlength="100" value="${esc(item.title)}" required></div><div class="dialog-actions"><button class="btn secondary" type="button" data-action="close-dialog">Cancel</button><button class="btn" type="submit">${icon('save')} Save routine</button></div></form>`);
    } else if (action === 'start-routine') {
      const routine = state.data.routines.find(item => item.id === id); if (!routine || session()) return;
      await command('start_session', { title: routine.name, routine_id: id });
    } else if (action === 'discard-queue') {
      if (state.pending.some(item => item.phase === 'uncertain' || item.phase === 'sending')) { toast('Retry this interrupted request first so its saved status is known'); return; }
      openDialog('Discard pending changes?', `<div class="dialog-body"><p>This removes ${state.pending.length} unsaved ${state.pending.length === 1 ? 'change' : 'changes'} from this device. Server-saved sets will stay as they are.</p><p>This cannot be undone.</p></div><div class="dialog-actions"><button class="btn secondary" data-action="close-dialog">Keep changes</button><button class="btn danger" data-action="confirm-discard">Discard pending</button></div>`);
    } else if (action === 'confirm-discard') {
      if (state.pending.some(item => item.phase === 'uncertain' || item.phase === 'sending')) return;
      state.pending = []; persistQueue(); closeDialog(); render(); toast('Pending changes discarded');
    } else if (action === 'review-queue') await reviewQueue();
    else if (action === 'confirm-resend') {
      if (!session() || !state.pending.length || state.pending.some(item => item.body.action !== 'log_set' || item.body.payload.session_id !== session().id)) return;
      const revision = session().revision;
      state.pending = state.pending.map((item, index) => ({ ...item, body: { ...item.body, request_id: uuid(), expected_revision: revision + index }, phase: 'queued', message: '', code: '' }));
      if (!persistQueue()) return;
      closeDialog(); await syncQueue();
    }
  });
  $('#dialog').addEventListener('click', event => { if (event.target === $('#dialog')) { const box = $('#dialog').getBoundingClientRect(); if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) closeDialog(); } });
  window.addEventListener('hashchange', () => {
    const tab = location.hash.slice(1);
    if (['today', 'routines', 'history', 'insights', 'nutrition'].includes(tab)) { if ($('#dialog').open) closeDialog(); state.tab = tab; state.lastSaved = ''; render(); window.scrollTo({ top: 0, behavior: 'instant' }); }
  });
  window.addEventListener('online', retryConnection);
  window.addEventListener('offline', () => { state.online = false; render(); });
  window.addEventListener('storage', event => {
    if (event.key === KEYS.queue) {
      // A single browser tab owns writes. Cross-tab writes pause rather than risk duplicates.
      state.storageProblem = 'Pending changes were modified in another tab. Close other Setwise tabs and reload this tab before continuing.';
      render();
    }
  });
  setInterval(() => { document.querySelectorAll('.elapsed[data-started]').forEach(el => { el.textContent = elapsed({ started_at: el.dataset.started }); }); }, 30000);
  setInterval(async () => {
    if (document.hidden || state.syncing || state.busy || $('#dialog').open) return;
    const typing = document.activeElement?.matches('input, select');
    const oldState = JSON.stringify(state.data), oldOnline = state.online;
    const ok = await refresh({ renderPage: false, quiet: true });
    if (ok && state.pending.length) await syncQueue();
    else if (!typing && (oldState !== JSON.stringify(state.data) || oldOnline !== state.online)) render();
  }, 15000);
  if (!navigator.locks) $('#single-tab-note').hidden = false;
  // One writer per origin prevents two tabs from racing on the durable local queue.
  // Browsers without Web Locks still pause when another tab changes queue storage.
  if (navigator.locks) {
    navigator.locks.request('setwise-writer-v1', { ifAvailable: true }, async lock => {
      if (!lock) {
        state.storageProblem = 'Another Setwise tab is open. Use that tab, or close it and reload here to make changes.';
        render(); return;
      }
      state.writerReady = true; render();
      if (state.checked && state.online) syncQueue();
      await new Promise(resolve => window.addEventListener('pagehide', () => { state.writerReady = false; resolve(); }, { once: true }));
    }).catch(() => { state.storageProblem = 'The browser could not secure this tab’s write access. Reload before making changes.'; render(); });
  }
  window.addEventListener('pageshow', event => { if (event.persisted) location.reload(); });
  render();
  refresh().then(() => { if (state.online) syncQueue(); });
})();
