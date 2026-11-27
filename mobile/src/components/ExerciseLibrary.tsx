import React, { useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { CaretDown, CaretRight, MagnifyingGlass } from 'phosphor-react-native';
import { bestSet, cleanText, dateKey, exerciseKey, exercises, formatDay, setLabel, Snapshot, Workout } from '../history';
import { styles as s } from '../styles';
import { colors as c } from '../theme';

type Entry = { name: string; history: { workout: Workout; summary: string }[] };

function indexExercises(data: Snapshot) {
  const entries = new Map<string, Entry>();
  for (const name of data.exerciseNames ?? []) {
    entries.set(exerciseKey(name), { name: cleanText(name), history: [] });
  }
  for (const workout of data.sessions) {
    for (const group of exercises(workout)) {
      const key = exerciseKey(group.sets[0].exercise);
      const entry = entries.get(key) ?? { name: group.name, history: [] };
      entry.history.push({ workout, summary: setLabel(bestSet(group.sets)) });
      entries.set(key, entry);
    }
  }
  return [...entries.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function ExerciseLibrary({ data, error, refreshing, refresh, onWorkout }: {
  data: Snapshot; error: string | null; refreshing: boolean; refresh: () => void; onWorkout: (workout: Workout) => void;
}) {
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const entries = useMemo(() => indexExercises(data), [data]);
  const visible = entries.filter(entry => exerciseKey(entry.name).includes(exerciseKey(query)));
  return <View style={[s.content, { flex: 1, paddingTop: 24, paddingBottom: 0 }]}>
    <Text accessibilityRole="header" style={s.title}>Exercises</Text>
    <Text style={s.subtitle}>{entries.length} exercises in your library</Text>
    <View style={[s.search, { marginVertical: 16 }]}><MagnifyingGlass size={20} color={c.muted} />
      <TextInput value={query} onChangeText={setQuery} placeholder="Find an exercise" accessibilityLabel="Find an exercise"
        placeholderTextColor={c.muted} style={s.searchInput} autoCorrect={false} returnKeyType="search" selectionColor={c.green} />
    </View>
    {error && <Pressable accessibilityRole="button" onPress={refresh}><Text style={s.errorText}>{error} Tap to retry.</Text></Pressable>}
    <FlatList data={visible} refreshing={refreshing} onRefresh={refresh} keyboardShouldPersistTaps="handled"
      keyExtractor={entry => exerciseKey(entry.name)} renderItem={({ item }) => {
        const open = expanded === item.name;
        const count = item.history.length;
        return <View style={styles.entry}>
          <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} onPress={() => setExpanded(open ? null : item.name)} style={styles.row}>
            <View style={s.grow}><Text style={s.sectionTitle}>{item.name}</Text>
              <Text style={s.caption}>{count === 0 ? 'No logged workouts' : `${count} logged ${count === 1 ? 'workout' : 'workouts'}`}</Text></View>
            {open ? <CaretDown size={18} color={c.green} /> : <CaretRight size={18} color={c.muted} />}
          </Pressable>
          {open && (count ? item.history.map(({ workout, summary }) => <Pressable key={workout.id} accessibilityRole="button"
            onPress={() => onWorkout(workout)} style={styles.workout}>
            <Text style={s.notesLabel}>{formatDay(dateKey(workout), { month: 'short', day: 'numeric', year: 'numeric' })}</Text>
            <Text style={s.backText}>{summary}</Text><CaretRight size={15} color={c.muted} />
          </Pressable>) : <Text style={styles.empty}>Log this exercise in a workout to start its history.</Text>)}
        </View>;
      }} ListEmptyComponent={<Text style={s.emptyCopy}>{refreshing ? 'Loading exercises…' : query ? 'No matching exercises.' : 'No exercises available.'}</Text>} />
  </View>;
}
const styles = StyleSheet.create({
  entry: { borderBottomWidth: 1, borderBottomColor: c.raised },
  row: { minHeight: 64, paddingVertical: 10, flexDirection: 'row', gap: 12, alignItems: 'center' },
  workout: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, paddingHorizontal: 12, backgroundColor: c.surface },
  empty: { ...s.emptyCopy, paddingBottom: 12 },
});
