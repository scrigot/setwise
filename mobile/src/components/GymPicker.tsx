import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { MapPin, PencilSimple } from 'phosphor-react-native';
import { gyms, gymLabel, Workout } from '../history';
import { colors as c } from '../theme';
import { styles as s } from '../styles';
import { endpoint } from '../useHistory';

export function GymPicker({ workout, onSaved }: { workout: Workout; onSaved: (gym: string) => void }) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  async function save(gym: string) {
    setSaving(true);
    setError('');
    try {
      const response = await fetch(endpoint + '/gym', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: workout.id, gym }) });
      if (!response.ok) throw new Error();
      onSaved(gym);
      setOpen(false);
    } catch { setError('Could not save the gym. Check your connection and try again.'); }
    finally { setSaving(false); }
  }
  return <View>
    <Pressable accessibilityRole="button" accessibilityLabel="Change gym" accessibilityState={{expanded:open}} disabled={saving} onPress={() => setOpen(!open)} style={s.notesToggle}>
      <MapPin size={18} color={c.muted}/><Text style={[s.backText,{flex:1,marginHorizontal:8}]}>{gymLabel(workout) || 'Add gym location'}</Text><PencilSimple size={16} color={c.muted}/>
    </Pressable>
    {open && gyms.map(gym => <Pressable accessibilityRole="button" key={gym} disabled={saving} onPress={() => save(gym)} style={s.back}><Text style={[s.backText, gymLabel(workout) === gym && {color:c.green}]}>{gym}</Text></Pressable>)}
    {saving && <Text style={s.caption}>Saving gym…</Text>}{!!error && <Text style={s.errorText}>{error}</Text>}
  </View>;
}
