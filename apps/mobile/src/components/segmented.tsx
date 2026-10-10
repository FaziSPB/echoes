import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Palette, Radius } from '@/constants/theme';

export function Segmented<T extends string>({ value, options, onChange }: { value: T; options: Array<{ value: T; label: string; disabled?: boolean }>; onChange: (v: T) => void }) {
  return (
    <View style={styles.wrap}>
      {options.map((o) => (
        <Pressable
          key={o.value}
          disabled={o.disabled}
          onPress={() => onChange(o.value)}
          style={[styles.item, value === o.value && styles.active, o.disabled && { opacity: 0.35 }]}>
          <Text style={[styles.label, value === o.value && styles.activeLabel]}>{o.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', backgroundColor: 'rgba(255,255,255,0.12)', borderRadius: Radius.pill, padding: 3 },
  item: { flex: 1, paddingVertical: 8, borderRadius: Radius.pill, alignItems: 'center' },
  active: { backgroundColor: Palette.paper },
  label: { color: Palette.paper, fontSize: 13, fontWeight: '600' },
  activeLabel: { color: Palette.ink },
});
