import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Barbell, CaretRight, Clock, MapPin, StackSimple, Trophy } from 'phosphor-react-native';
import { bestSet, dateKey, duration, exercises, formatDay, gymLabel, setLabel, title, workoutTimes, volumeLabel, Workout } from '../history';
import { colors as c, fonts as f } from '../theme';

export function WorkoutCard({ workout, prCount, onPress }: { workout: Workout; prCount: number; onPress: () => void }) {
  const groups = exercises(workout);
  const day = dateKey(workout);
  const minutes = duration(workout);
  const volume = volumeLabel(workout);
  return <Pressable accessibilityRole="button" accessibilityLabel={`Open ${title(workout)}, ${formatDay(day, { month: 'long', day: 'numeric', year: 'numeric' })}, ${workout.sets.length} sets`}
    onPress={onPress} style={({pressed}) => [styles.card, pressed && { opacity: 0.8 }]}>
    <View style={styles.heading}><Text style={styles.title}>{title(workout)}</Text><CaretRight size={20} color={c.muted}/></View>
    <Text style={styles.secondary}>{formatDay(day, { weekday: 'long', month: 'short', day: 'numeric' })}</Text>
    <View style={styles.line}><Clock size={15} color={c.muted}/><Text style={styles.secondary}>{workoutTimes(workout)}</Text></View>
    <View style={styles.line}><MapPin size={15} color={c.muted}/><Text style={styles.location}>{gymLabel(workout) || 'Gym not recorded'}</Text></View>
    <View style={styles.stats}>
      {minutes !== null && <View style={styles.line}><Clock size={15} color={c.muted}/><Text style={styles.secondary}>{minutes}m</Text></View>}
      {volume && <View style={styles.line}><Barbell size={16} color={c.muted}/><Text style={styles.secondary}>{volume}</Text></View>}
      <View style={styles.line}><StackSimple size={15} color={c.muted}/><Text style={styles.secondary}>{workout.sets.length} sets</Text></View>
      <View style={styles.line}><Trophy size={15} color={prCount ? c.green : c.muted}/><Text style={styles.secondary}>{prCount} {prCount === 1 ? 'PR' : 'PRs'}</Text></View>
    </View>
    <View style={styles.table}>
      <View style={styles.cols}><Text style={[styles.label, styles.name]}>Exercise</Text><Text style={[styles.label, styles.best]}>Best Set</Text></View>
      {groups.map(group => <View key={group.name} style={styles.cols}>
        <Text numberOfLines={2} style={[styles.secondary, styles.name]}>{group.sets.length} × {group.name}</Text>
        <Text style={[styles.secondary, styles.best]}>{setLabel(bestSet(group.sets))}</Text>
      </View>)}
    </View>
  </Pressable>;
}
const styles = StyleSheet.create({
  card: { backgroundColor: c.surface, borderWidth: 1, borderColor: '#363636', borderRadius: 14, padding: 16, gap: 6, marginBottom: 12 },
  heading: { flexDirection: 'row', alignItems: 'center', gap: 8 }, title: { flex: 1, fontFamily: f.bold, fontSize: 18, color: c.text },
  secondary: { color: c.muted, fontFamily: f.regular, fontSize: 13, lineHeight: 19 }, location: { flexShrink: 1, color: c.subtle, fontFamily: f.medium, fontSize: 13 },
  stats: { flexDirection: 'row', flexWrap: 'wrap', gap: 18, marginTop: 3 }, line: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  table: { gap: 7, marginTop: 10 }, cols: { flexDirection: 'row', alignItems: 'baseline', gap: 10 }, name: { flex: 1.5 }, best: { flex: 1, fontVariant: ['tabular-nums'] },
  label: { color: c.text, fontSize: 13, fontFamily: f.bold },
});
