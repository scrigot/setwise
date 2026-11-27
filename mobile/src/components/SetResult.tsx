import { StyleSheet, Text, View } from 'react-native';
import { Trophy } from 'phosphor-react-native';
import { WorkoutSet } from '../history';
import { Badge, estimatedMax } from '../records';
import { styles as s } from '../styles';
import { colors as c, fonts as f } from '../theme';

export function SetResult({ set, number, badges }: { set: WorkoutSet; number: number; badges: Badge[] }) {
  const estimate = estimatedMax(set);
  return <View>
    <View style={s.setRow}>
      <Text style={[s.setText, s.setColumn]}>{number}</Text>
      <Text style={[s.setText, s.loadColumn]}>{estimate === null ? '-' : `${set.load} ${set.unit}`}</Text>
      <Text style={[s.setText, s.repsColumn]}>{set.reps}</Text>
      <Text style={[s.setText, s.rpeColumn]}>{set.rpe ?? '-'}</Text>
      <Text style={[s.setText, row.max]}>{estimate === null ? '-' : `${Math.round(estimate)} ${set.unit}`}</Text>
    </View>
    {badges.length > 0 && <View style={row.badges}>{badges.map(badge =>
      <View key={badge} style={row.badge}><Trophy color={c.green} size={12} weight="fill"/><Text style={row.label}>{badge}</Text></View>
    )}</View>}
  </View>;
}
export const row = StyleSheet.create({
  max: { flex: 1.35, textAlign: 'right' },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: 5, paddingBottom: 8 },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#193524', paddingVertical: 3, paddingHorizontal: 7, borderRadius: 16 },
  label: { fontFamily: f.bold, fontSize: 10, color: c.green },
});
