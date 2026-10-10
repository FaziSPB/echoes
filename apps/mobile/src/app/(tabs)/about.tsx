import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Palette, Radius, Spacing } from '@/constants/theme';
import { API_URL } from '@/lib/config';

const SOURCES = [
  ['Rejestr zabytków nieruchomych', 'Narodowy Instytut Dziedzictwa, udostępniony na dane.gov.pl (API, synchronizacja po dacie modyfikacji zasobu).'],
  ['Geokodowanie', 'Usługa UUG Głównego Urzędu Geodezji i Kartografii; uzupełniająco punkty NID z zabytek.pl.'],
  ['Zdjęcia archiwalne', 'Narodowe Archiwum Cyfrowe (kuracja ręczna), Polona / Biblioteka Narodowa oraz Library of Congress – domena publiczna.'],
  ['Rekonstrukcja 360°', 'Google Gemini rozszerza kadr; oryginalne piksele archiwum są zawsze nienaruszone i można podświetlić część wygenerowaną przez AI.'],
];

export default function AboutScreen() {
  return (
    <SafeAreaView edges={['top']} style={styles.container}>
      <ScrollView contentContainerStyle={{ padding: Spacing.lg, gap: Spacing.lg, paddingBottom: 120 }}>
        <Text style={styles.title}>Echoes</Text>
        <Text style={styles.lead}>
          Generatywny wehikuł czasu. Stań w miejscu, w którym zrobiono archiwalne zdjęcie, i zobacz przeszłość nałożoną na teraźniejszość – a potem rozejrzyj
          się dookoła w rekonstrukcji 360°.
        </Text>
        {SOURCES.map(([title, body]) => (
          <View key={title} style={styles.card}>
            <Text style={styles.cardTitle}>{title}</Text>
            <Text style={styles.cardBody}>{body}</Text>
          </View>
        ))}
        <Text style={styles.footer}>API: {API_URL}</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Palette.paper },
  title: { fontFamily: 'serif', fontSize: 34, fontWeight: '700', color: Palette.ink },
  lead: { fontFamily: 'serif', fontSize: 17, lineHeight: 25, color: Palette.ink },
  card: { backgroundColor: Palette.white, borderRadius: Radius.md, padding: Spacing.lg, gap: Spacing.xs, borderWidth: 1, borderColor: Palette.paperDark },
  cardTitle: { fontSize: 13, fontWeight: '700', color: Palette.sepia, letterSpacing: 1, textTransform: 'uppercase' },
  cardBody: { fontSize: 14, lineHeight: 20, color: Palette.ink },
  footer: { fontSize: 11, color: Palette.inkSoft, fontFamily: 'monospace' },
});
