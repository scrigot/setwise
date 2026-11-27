import React, { useMemo, useRef, useState } from 'react';
import { FlatList, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { ExerciseLibrary } from './src/components/ExerciseLibrary';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { useFonts, Manrope_400Regular, Manrope_600SemiBold, Manrope_700Bold, Manrope_800ExtraBold } from '@expo-google-fonts/manrope';
import { ArrowDown, Barbell, CalendarBlank, CaretLeft, CaretRight, Check, ClockCounterClockwise, Info, ListBullets, MagnifyingGlass, X } from 'phosphor-react-native';
import { colors as c, fonts as f } from './src/theme';
import { Pill } from './src/components/Pill';
import { calendarDays, cleanText, dateKey, duration, exercises, filterHistory, formatDay, title, workoutTimes, Workout } from './src/history';
import { styles as s } from './src/styles';
import { useHistory } from './src/useHistory';

import { WorkoutCard } from './src/components/WorkoutCard';
import { GymPicker } from './src/components/GymPicker';
import { workoutRecords, WorkoutRecords } from './src/records';
import { SetResult, row } from './src/components/SetResult';
const icon = { size: 21, color: c.text, weight: 'regular' as const };
export default function App() {
  const [loaded, fontError] = useFonts({ Manrope_400Regular, Manrope_600SemiBold, Manrope_700Bold, Manrope_800ExtraBold });
  return <SafeAreaProvider><StatusBar style="light" /><SafeAreaView style={s.safe}>
    {loaded || fontError ? <HistoryScreen /> : <View style={[s.content, { paddingTop: 30 }]} accessibilityLabel="Loading workout history" accessibilityRole="progressbar">
      {[70, 140, 52, 180, 110, 110].map((height, i) => <View key={i} style={{ height, backgroundColor: c.raised, borderRadius: 8, marginBottom: 16 }} />)}
    </View>}
  </SafeAreaView></SafeAreaProvider>;
}
function HistoryScreen() {
  const { data, error, refreshing, refresh } = useHistory();
  const { tab } = useLocalSearchParams<{ tab?: string }>();
  const library = tab === 'exercises';
  const records = useMemo(() => workoutRecords(data.sessions), [data.sessions]);
  const [query, setQuery] = useState('');
  const [month, setMonth] = useState('all');
  const [day, setDay] = useState<string | null>(null);
  const [calendar, setCalendar] = useState(false);
  const [oldest, setOldest] = useState(false);
  const [selected, setSelected] = useState<Workout | null>(null);
  const [info, setInfo] = useState(false);
  const search = useRef<React.ComponentRef<typeof TextInput>>(null);
  const list = useRef<FlatList<Workout>>(null);
  const months = useMemo(() => [...new Set(data.sessions.map(w => dateKey(w).slice(0, 7)))].sort().reverse(), [data]);
  const calendarMonth = month === 'all' ? (months[0] ?? new Date().toISOString().slice(0, 7)) : month;
  const filtered = useMemo(() => {
    const values = filterHistory(data.sessions, query, calendar && month === 'all' ? calendarMonth : month, day);
    return oldest ? values.reverse() : values;
  }, [data, query, month, day, oldest, calendar, calendarMonth]);
  const reset = () => { setQuery(''); setMonth('all'); setDay(null); setCalendar(false); };
  const changeMonth = (value: string) => { setMonth(value); setDay(null); };
  const moveMonth = (direction: number) => {
    const [y, m] = calendarMonth.split('-').map(Number);
    changeMonth(new Date(Date.UTC(y, m - 1 + direction, 1)).toISOString().slice(0, 7));
  };
  const header = <>
    <View style={s.brandRow}><View style={s.brandLockup}><View style={s.brandIcon}><Barbell size={20} color={c.text} weight="bold" /></View><Text style={s.brand}>setwise</Text></View>
      <Pressable accessibilityRole="button" accessibilityLabel="About your saved history" onPress={() => setInfo(true)} style={({ pressed }) => [s.circle, pressed && s.pressed]}><Info {...icon} /></Pressable>
    </View>
    <View style={s.titleRow}><View><Text style={s.title}>Your history</Text><Text style={s.subtitle}>{error ? 'Offline or sync interrupted' : refreshing ? 'Checking your journal…' : 'Synced with Setwise'}</Text></View><View style={s.historyMark}><ClockCounterClockwise size={27} color={c.subtle} /></View></View>
    <View style={s.search}><MagnifyingGlass size={20} color={c.muted} />
      <TextInput ref={search} autoFocus={tab === 'search'} value={query} onChangeText={setQuery} placeholder="Find a workout, exercise or gym" placeholderTextColor={c.muted} style={s.searchInput} accessibilityLabel="Search workouts or exercises" returnKeyType="search" autoCorrect={false} selectionColor={c.green} />
      {!!query && <Pressable accessibilityRole="button" accessibilityLabel="Clear search" hitSlop={10} onPress={() => setQuery('')}><X size={19} color={c.text} /></Pressable>}
    </View>
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.filters}><Pill active={month === 'all'} onPress={() => changeMonth('all')}>ALL TIME</Pill>
      {months.map(m => <Pill key={m} active={m === month} onPress={() => changeMonth(m)}>{formatDay(`${m}-01`, { month: 'short', year: '2-digit' }).toUpperCase()}</Pill>)}
    </ScrollView>
    <View style={s.sectionRow}><View style={s.sectionHeading}><Text style={s.sectionTitle}>{calendar ? 'Training days' : query || month !== 'all' ? 'Your workouts' : 'Recent workouts'}</Text><Text style={s.resultCount}>{filtered.length}</Text></View>
      <View style={s.viewControls}><Pressable accessibilityRole="button" accessibilityLabel={oldest ? 'Sort newest first' : 'Sort oldest first'} onPress={() => setOldest(!oldest)} style={s.smallControl}><ArrowDown size={17} color={c.muted} style={oldest ? { transform: [{ rotate: '180deg' }] } : undefined} /></Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel={calendar ? 'Show workout list' : 'Show workout calendar'} accessibilityState={{ selected: calendar }} onPress={() => { setCalendar(!calendar); setDay(null); }} style={s.smallControl}>{calendar ? <ListBullets {...icon} color={c.green} /> : <CalendarBlank {...icon} color={c.muted} />}</Pressable></View>
    </View>
    {calendar && <View style={s.calendar}>
      <View style={s.calendarHeading}><Pressable accessibilityRole="button" accessibilityLabel="Previous month" style={s.smallControl} onPress={() => moveMonth(-1)}><CaretLeft {...icon} /></Pressable><Text style={s.sectionTitle}>{formatDay(`${calendarMonth}-01`, { month: 'long', year: 'numeric' })}</Text><Pressable accessibilityRole="button" accessibilityLabel="Next month" style={s.smallControl} onPress={() => moveMonth(1)}><CaretRight {...icon} /></Pressable></View>
      <View style={s.calendarGrid}>{['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => <View key={i} style={s.dayCell}><Text style={s.weekLabel}>{d}</Text></View>)}</View>
      <View style={s.calendarGrid}>{calendarDays(calendarMonth).map((date, i) => {
        const count = data.sessions.filter(w => dateKey(w) === date).length;
        return <View key={date || `blank-${i}`} style={s.dayCell}>{date && <Pressable accessibilityRole="button" accessibilityLabel={`${formatDay(date, { month: 'long', day: 'numeric' })}, ${count} workouts`} accessibilityState={{ selected: day === date }} onPress={() => setDay(day === date ? null : date)} style={[s.dayButton, !!count && s.trainedDay, day === date && s.selectedDay]}><Text style={[s.dayText, !!count && { color: c.text, fontFamily: f.bold }, day === date && { color: c.background }]}>{Number(date.slice(-2))}</Text>{!!count && day !== date && <View style={s.workoutDot} />}</Pressable>}</View>;
      })}</View><Text style={s.calendarCaption}>{day ? formatDay(day, { weekday: 'long', month: 'long', day: 'numeric' }) : 'Marked days have a saved workout'}</Text>
    </View>}
    {error && <View style={s.error} accessibilityRole="alert"><Text style={s.errorText}>{error}</Text><Pill onPress={refresh}>RETRY</Pill></View>}
  </>;
  return <View style={s.frame}>
    {library ? <ExerciseLibrary data={data} refreshing={refreshing} refresh={refresh} error={error} onWorkout={setSelected} /> :
    <FlatList onRefresh={refresh} refreshing={refreshing} ref={list} data={filtered} keyExtractor={w => w.id} contentContainerStyle={s.content} ListHeaderComponent={header} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}
      renderItem={({ item, index }) => <View>
        {(index === 0 || dateKey(filtered[index - 1]).slice(0, 7) !== dateKey(item).slice(0, 7)) &&
          <Text style={[s.infoLabel, { marginTop: 8, marginBottom: 12 }]}>{formatDay(dateKey(item), { month: 'long', year: 'numeric' }).toUpperCase()}</Text>}
        <WorkoutCard workout={item} prCount={records.get(item.id)?.count ?? 0} onPress={() => setSelected(item)} />
      </View>}
      ListEmptyComponent={!error && !refreshing ? <View style={s.empty}><MagnifyingGlass size={32} color={c.muted} /><Text style={s.sectionTitle}>{data.sessions.length ? 'No workouts found' : 'Your history starts here'}</Text><Text style={s.emptyCopy}>{data.sessions.length ? 'Try another exercise, date, or month.' : 'Saved workouts from Setwise will appear here.'}</Text>{!!data.sessions.length && <Pill onPress={reset}>CLEAR FILTERS</Pill>}</View> : undefined}
      ListFooterComponent={!!filtered.length ? <View style={s.listFooter}><Check size={15} color={c.muted} /><Text style={s.caption}>{filtered.length === data.sessions.length ? 'All your saved workouts' : `${filtered.length} matching ${filtered.length === 1 ? 'workout' : 'workouts'}`}</Text></View> : undefined} />}
    <View style={s.bottomBar}>
      <Pressable accessibilityRole="button" accessibilityLabel="History, scroll to top" accessibilityState={{ selected: !library }} onPress={() => { if (library) router.setParams({ tab: 'history' }); else list.current?.scrollToOffset({ offset: 0, animated: false }); }} style={s.navItem}><ClockCounterClockwise size={22} color={library ? c.muted : c.green} weight={library ? "regular" : "fill"} /><Text style={[s.navLabel, !library && { color: c.green }]}>History</Text></Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel="Exercises" accessibilityState={{ selected: library }} onPress={() => router.setParams({ tab: 'exercises' })} style={s.navItem}><Barbell size={22} color={library ? c.green : c.muted} weight={library ? "fill" : "regular"} /><Text style={[s.navLabel, library && { color: c.green }]}>Exercises</Text></Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel="Search history" onPress={() => { if (library) router.setParams({ tab: 'search' }); else { list.current?.scrollToOffset({ offset: 0, animated: false }); search.current?.focus(); } }} style={s.navItem}><MagnifyingGlass size={22} color={c.muted} /><Text style={s.navLabel}>Search</Text></Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel="History sync details" onPress={() => setInfo(true)} style={s.navItem}><Info size={22} color={c.muted} /><Text style={s.navLabel}>Saved data</Text></Pressable>
    </View>
    <Modal visible={!!selected} animationType="none" transparent onRequestClose={() => setSelected(null)}>{selected && <View style={s.scrim}><Pressable accessibilityLabel="Dismiss workout" style={StyleSheet.absoluteFill} onPress={() => setSelected(null)} /><WorkoutDetail records={records.get(selected.id)} workout={data.sessions.find(w => w.id === selected.id) ?? selected} onClose={() => setSelected(null)} onSaved={gym => { setSelected({...selected, gym}); refresh(); }} /></View>}</Modal>
    <Modal visible={info} animationType="none" transparent onRequestClose={() => setInfo(false)}><View style={s.scrim}><Pressable style={StyleSheet.absoluteFill} accessibilityLabel="Close saved data details" onPress={() => setInfo(false)} /><SafeAreaView edges={['bottom']} style={s.infoSheet} accessibilityViewIsModal>
      <View style={s.sectionRow}><Text style={s.title}>History sync</Text><Pressable accessibilityRole="button" accessibilityLabel="Close saved data details" style={s.circle} onPress={() => setInfo(false)}><X {...icon} /></Pressable></View>
      <View style={s.infoIcon}><ClockCounterClockwise size={30} color={c.text} /></View><Text style={s.sectionTitle}>From your Setwise journal</Text><Text style={s.infoCopy}>{data.sessions.length} completed workouts saved on this device. You can browse them offline.</Text>
      <Text style={s.infoLabel}>LAST SYNCED</Text><Text style={s.infoDate}>{data.syncedAt ? new Date(data.syncedAt).toLocaleString('en-US', { month: 'long', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'Waiting for the first sync'}</Text>
      <View style={s.infoNote}><Info size={19} color={c.muted} /><Text style={s.noteText}>History checks for finished workouts every 15 seconds while open and when you return to the app.</Text></View><Pill active onPress={refresh} style={{ marginTop: 24, marginBottom: 16 }}>{refreshing ? 'SYNCING' : 'SYNC NOW'}</Pill>
    </SafeAreaView></View></Modal>
  </View>;
}
function WorkoutDetail({ workout, records, onClose, onSaved }: { workout: Workout; records?: WorkoutRecords; onClose: () => void; onSaved: (gym: string) => void }) {
  const groups = exercises(workout); const minutes = duration(workout);
  return <SafeAreaView edges={['bottom']} style={[s.infoSheet,{height:'85%',padding:0}]}><View style={s.detailFrame}>
    <View style={s.detailNav}><Pressable accessibilityRole="button" accessibilityLabel="Back to history" onPress={onClose} style={s.back}><X {...icon} /><Text style={s.backText}>Close</Text></Pressable><Text style={s.caption}>SAVED WORKOUT</Text></View>
    <ScrollView contentContainerStyle={s.detailContent} showsVerticalScrollIndicator={false}>
      <Text style={s.detailTitle}>{title(workout)}</Text><Text style={s.subtitle}>{formatDay(dateKey(workout), { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}</Text>
      <Text style={s.subtitle}>{workoutTimes(workout)}</Text>
      <GymPicker workout={workout} onSaved={onSaved} />
      <View style={s.detailMetrics}><Text style={s.detailMetricText}>{groups.length} exercises</Text><Text style={s.detailMetricText}>{workout.sets.length} sets</Text>{minutes != null && <Text style={s.detailMetricText}>{minutes} min</Text>}</View>
      <Text style={s.exerciseHeading}>Exercises</Text>
      {groups.map((group, i) => <View style={s.exerciseCard} key={group.name}>
        <View style={s.exerciseTitleRow}><View style={s.exerciseNumber}><Text style={s.exerciseNumberText}>{String(i + 1).padStart(2, '0')}</Text></View><Text style={s.exerciseTitle}>{group.name}</Text></View>
        <View style={s.tableHeader}><Text style={[s.tableLabel, s.setColumn]}>SET</Text><Text style={[s.tableLabel, s.loadColumn]}>WEIGHT</Text><Text style={[s.tableLabel, s.repsColumn]}>REPS</Text><Text style={[s.tableLabel, s.rpeColumn]}>RPE</Text><Text style={[s.tableLabel, row.max]}>EST. 1RM</Text></View>
        {group.sets.map((set, index) => <SetResult key={set.id || index} set={set} number={index + 1} badges={records?.badges.get(set) ?? []} />)}
        {group.sets.some(set => set.notes) && <SetNotes sets={group.sets} />}
      </View>)}
      {!!workout.notes && <View style={s.workoutNotes}><Text style={s.sectionTitle}>Workout notes</Text><Text style={s.noteText}>{cleanText(workout.notes)}</Text></View>}
      <Text style={s.detailFootnote}>PRs compare matching exercises across your logged history. Each exercise can earn one badge per category per workout. Your first workout sets the baseline. Only a later workout that beats it earns a badge. VOL. is weight × reps for one set. Reps-only sets compete on reps. Estimated 1RM uses Brzycki through 10 reps and Epley above 10.</Text>
    </ScrollView>
  </View></SafeAreaView>;
}
function SetNotes({ sets }: { sets: Workout['sets'] }) {
  const [open, setOpen] = useState(false);
  return <View><Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} onPress={() => setOpen(!open)} style={s.notesToggle}><Text style={s.notesLabel}>{open ? 'Hide set notes' : 'Show set notes'}</Text><CaretRight size={15} color={c.muted} style={open ? { transform: [{ rotate: '90deg' }] } : undefined} /></Pressable>{open && sets.map((set, i) => set.notes ? <Text key={set.id || i} style={s.setNote}>Set {i + 1}: {cleanText(set.notes)}</Text> : null)}</View>;
}
