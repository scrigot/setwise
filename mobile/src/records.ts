import { dateKey, exerciseKey, exercises, Workout, WorkoutSet } from './history';

export type Badge = '1RM' | 'VOL.' | 'WEIGHT' | 'REPS';
export type WorkoutRecords = { count: number; badges: Map<WorkoutSet, Badge[]> };

export function estimatedMax(set: WorkoutSet): number | null {
  const load = Number(set.load);
  if (load <= 0 || set.exercise_type === 'reps_only' || set.reps < 1) return null;
  // Brzycki matches the reference at 1-10 reps. Epley stays finite for longer sets.
  return set.reps <= 10 ? load * 36 / (37 - set.reps) : load * (1 + set.reps / 30);
}

function scores(set: WorkoutSet): [Badge, number][] {
  if (set.reps <= 0 || set.set_type === 'warmup') return [];
  const estimate = estimatedMax(set);
  if (estimate === null) return [['REPS', set.reps]];
  const kgPerUnit = set.unit === 'lb' ? 0.45359237 : 1;
  const kg = Number(set.load) * kgPerUnit;
  return [['1RM', estimate * kgPerUnit], ['VOL.', kg * set.reps], ['WEIGHT', kg]];
}

type MetricHistory = {
  best: number;
  day: string;
  beforeDay?: number;
  instant: number;
  beforeInstant?: number;
  timedBest?: number;
};

export function workoutRecords(history: Workout[]) {
  const records = new Map<string, WorkoutRecords>();
  const previous = new Map<string, Map<Badge, MetricHistory>>();
  const ordered = history.filter(w => w.status === 'finished').map(workout => ({
    workout, day: dateKey(workout),
    instant: workout.date_precision === 'date' ? NaN : Date.parse(workout.started_at ?? ''),
  })).sort((a, b) => a.day.localeCompare(b.day) || (a.instant || 0) - (b.instant || 0));

  for (const { workout, day, instant } of ordered) {
    const result: WorkoutRecords = { count: 0, badges: new Map() };
    records.set(workout.id, result);
    for (const group of exercises(workout)) {
      const key = exerciseKey(group.sets[0].exercise);
      const metrics = previous.get(key) ?? new Map<Badge, MetricHistory>();
      previous.set(key, metrics);
      const winners = new Map<Badge, { score: number; set: WorkoutSet }>();
      for (const set of group.sets) {
        for (const [badge, score] of scores(set)) {
          if (score > (winners.get(badge)?.score ?? 0) + 0.000001) winners.set(badge, { score, set });
        }
      }
      for (const [badge, { score, set }] of winners) {
        const prior = metrics.get(badge);
        const beforeDay = prior?.day === day ? prior.beforeDay : prior?.best;
        // A same-day date-only entry or simultaneous start cannot establish which workout came first.
        const timedBest = prior?.day === day ? prior.timedBest : beforeDay;
        const beforeInstant = prior?.day === day && prior.instant === instant ? prior.beforeInstant : timedBest;
        const baseline = Number.isFinite(instant) ? beforeInstant : beforeDay;
        if (baseline !== undefined && score > baseline + 0.000001) {
          result.badges.set(set, [...(result.badges.get(set) ?? []), badge]);
          result.count++;
        }
        metrics.set(badge, {
          day, instant, beforeDay, beforeInstant, best: Math.max(prior?.best ?? 0, score),
          timedBest: Number.isFinite(instant) ? Math.max(timedBest ?? 0, score) : timedBest,
        });
      }
    }
  }
  return records;
}
