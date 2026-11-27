export type WorkoutSet = {
  id: string; exercise: string; load: string; unit: 'kg' | 'lb'; reps: number;
  exercise_type?: string; rpe?: number | null; notes?: string; set_type?: string;
};
export type Workout = {
  id: string; title: string; status: 'finished' | 'active'; sets: WorkoutSet[];
  started_at?: string | null; finished_at?: string | null; workout_date?: string;
  gym?: string; workout_timezone?: string; date_precision?: string; notes?: string;
};
export type Snapshot = { syncedAt: string | null; source: string; sessions: Workout[]; exerciseNames?: string[] };

export function parseSnapshot(input: unknown): Snapshot {
  if (!input || typeof input !== 'object') throw new Error('The history file is not valid.');
  const data = input as Record<string, unknown>;
  if (!Array.isArray(data.sessions)) throw new Error('The history file has no workout list.');
  const sessions = data.sessions.filter(s => s?.status === 'finished');
  const ids = new Set<string>();
  for (const s of sessions) {
    if (typeof s.id !== 'string' || ids.has(s.id) || typeof s.title !== 'string' || !Array.isArray(s.sets)) throw new Error('A workout record is incomplete.');
    ids.add(s.id);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s.workout_date ?? '') && !Number.isFinite(Date.parse(s.started_at ?? ''))) throw new Error('A workout is missing its date.');
    for (const set of s.sets) {
      if (typeof set.exercise !== 'string' || !['kg', 'lb'].includes(set.unit) || set.load == null || set.load === '' || !Number.isFinite(Number(set.load)) || Number(set.load) < 0 || !Number.isInteger(set.reps) || set.reps < 0 || (set.rpe != null && (!Number.isFinite(set.rpe) || set.rpe < 1 || set.rpe > 10))) throw new Error('A set contains unsupported values.');
    }
  }
  const exerciseNames = Array.isArray(data.exerciseNames) ? data.exerciseNames.filter((name): name is string => typeof name === 'string' && !!name.trim()) : [];
  return { exerciseNames, source: typeof data.source === 'string' ? data.source : 'Setwise', syncedAt: typeof data.syncedAt === 'string' ? data.syncedAt : null, sessions: [...sessions].sort((a, b) => dateKey(b).localeCompare(dateKey(a))) };
}

// Date-only imports are calendar dates, never midnight timestamps.
export function dateKey(workout: Workout): string {
  if (workout.workout_date) return workout.workout_date;
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: workout.workout_timezone || 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(workout.started_at!));
  return ['year', 'month', 'day'].map(key => parts.find(p => p.type === key)!.value).join('-');
}
export function formatDay(key: string, options: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' }) {
  return new Date(`${key}T12:00:00Z`).toLocaleDateString('en-US', { ...options, timeZone: 'UTC' });
}
export const cleanText = (text: string) => text.replace(/[\u2013\u2014]/g, '-');
export function title(workout: Workout) {
  return /^Workout\s*[-\u2013\u2014]\s*\d{4}-\d{2}-\d{2}$/.test(workout.title) ? 'Workout' : cleanText(workout.title);
}
export const exerciseKey = (name: string) => name.trim().replace(/\s+/g, ' ').toLowerCase();
export function exercises(workout: Workout) {
  const groups = new Map<string, { name: string; sets: WorkoutSet[] }>();
  workout.sets.forEach(set => {
    const key = exerciseKey(set.exercise);
    if (!groups.has(key)) groups.set(key, { name: cleanText(set.exercise), sets: [] });
    groups.get(key)!.sets.push(set);
  });
  return [...groups.values()];
}
export function duration(workout: Workout): number | null {
  if (workout.date_precision === 'date' || !workout.started_at || !workout.finished_at) return null;
  const minutes = Math.round((Date.parse(workout.finished_at) - Date.parse(workout.started_at)) / 60000);
  return Number.isFinite(minutes) && minutes > 0 ? minutes : null;
}
export function workoutTimes(workout: Workout): string {
  const zone = workout.workout_timezone || 'America/New_York';
  const start = workout.date_precision === 'date' ? NaN : Date.parse(workout.started_at ?? '');
  const end = workout.date_precision === 'date' ? NaN : Date.parse(workout.finished_at ?? '');
  if (!Number.isFinite(start) && !Number.isFinite(end)) return 'Times not recorded';
  const clock = new Intl.DateTimeFormat('en-US', { timeZone: zone, hour: 'numeric', minute: '2-digit' });
  if (!Number.isFinite(start)) return `Ended ${clock.format(end)}`;
  if (!Number.isFinite(end)) return `Started ${clock.format(start)}`;
  const date = new Intl.DateTimeFormat('en-US', { timeZone: zone, month: 'short', day: 'numeric', year: 'numeric' });
  const endDay = date.format(start) === date.format(end) ? '' : ` (${date.format(end)})`;
  return `${clock.format(start)} to ${clock.format(end)}${endDay}`;
}
export const gyms: string[] = (process.env.EXPO_PUBLIC_GYMS || 'Home gym|Local gym').split('|').map((name: string) => name.trim()).filter(Boolean);

export function gymLabel(workout: Workout): string {
  if (workout.gym) return workout.gym;
  const notes = [workout.notes, ...workout.sets.map(set => set.notes)];
  const gymsFound = new Set<string>();
  for (const note of notes) {
    for (const match of (note ?? '').matchAll(/\bGyms?:\s*([^.;\n]+)/gi)) {
      const name = cleanText(match[1]).replace(/\s*\(user-confirmed\)/gi, '').trim();
      if (name) gymsFound.add(gyms.find(gym => gym.toLocaleLowerCase() === name.toLocaleLowerCase()) ?? name);
    }
  }
  return [...gymsFound].join(' / ');
}

function pounds(set: WorkoutSet) {
  return Number(set.load) * (set.unit === 'kg' ? 1 / 0.45359237 : 1);
}
export function bestSet(sets: WorkoutSet[]) {
  return sets.reduce((best, set) => {
    const delta = pounds(set) - pounds(best);
    return delta > 0 || (delta === 0 && set.reps > best.reps) ? set : best;
  });
}
export function setLabel(set: WorkoutSet) {
  return set.exercise_type === 'reps_only' || Number(set.load) === 0
    ? `${set.reps} reps` : `${set.load} ${set.unit} × ${set.reps}`;
}
export function volumeLabel(workout: Workout) {
  const volume = workout.sets.reduce((sum, set) => sum + pounds(set) * set.reps, 0);
  return volume > 0 ? Math.round(volume).toLocaleString('en-US') + ' lb' : null;
}
export function filterHistory(workouts: Workout[], query: string, month = 'all', day: string | null = null) {
  const needle = query.toLocaleLowerCase().trim();
  return workouts.filter(w => (month === 'all' || dateKey(w).startsWith(month)) && (!day || dateKey(w) === day) && (!needle || `${w.title} ${gymLabel(w)} ${dateKey(w)} ${w.sets.map(s => s.exercise).join(' ')}`.toLocaleLowerCase().includes(needle)));
}
export function calendarDays(month: string): (string | null)[] {
  const [year, m] = month.split('-').map(Number);
  const offset = (new Date(Date.UTC(year, m - 1, 1)).getUTCDay() + 6) % 7;
  const count = new Date(Date.UTC(year, m, 0)).getUTCDate();
  const days: (string | null)[] = [...Array(offset).fill(null), ...Array.from({ length: count }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`)];
  while (days.length % 7) days.push(null);
  return days;
}
