import { Pressable, StyleSheet, Text, ViewStyle } from 'react-native';
import { ReactNode } from 'react';
import { colors, fonts } from '../theme';

// Native adaptation of the variant/size API demonstrated by shadcn's Button
// on 21st.dev. No DOM/Radix code is used in this native component.
export function Pill({ children, active, onPress, label, icon, style }: {
  children?: ReactNode; active?: boolean; onPress: () => void; label?: string; icon?: ReactNode; style?: ViewStyle;
}) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected: !!active }} onPress={onPress}
    style={({ pressed }) => [styles.pill, active && styles.active, style, pressed && { opacity: 0.75, transform: [{ scale: 0.98 }] }]}>
    {icon}{children != null && <Text style={[styles.text, active && styles.activeText]}>{children}</Text>}
  </Pressable>;
}
const styles = StyleSheet.create({
  pill: { minHeight: 44, borderRadius: 999, backgroundColor: colors.raised, paddingHorizontal: 18, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8 },
  active: { backgroundColor: colors.green }, text: { fontFamily: fonts.bold, fontSize: 12, color: colors.text, letterSpacing: 0.7 }, activeText: { color: colors.background },
});
