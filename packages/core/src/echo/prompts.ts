import type { MonumentBrief } from '@echoes/shared';
import type { PhotoRow } from '../repos/photos';

const decade = (y: number | null) => (y ? `${Math.floor(y / 10) * 10}s` : 'the era of the photograph');

function sceneFacts(photo: PhotoRow, monument: MonumentBrief | null): string {
  const lines = [
    `Title: ${photo.title}`,
    photo.description && `Caption: ${photo.description}`,
    photo.dateText && `Date: ${photo.dateText}`,
    photo.city && `City: ${photo.city}`,
    monument && `Heritage site: ${monument.name}${monument.chronology ? ` (${monument.chronology})` : ''}${monument.function ? `, ${monument.function}` : ''}`,
    monument?.street && `Address: ${monument.street} ${monument.houseNumber ?? ''}`.trim(),
  ];
  return lines.filter(Boolean).join('\n');
}

export function outpaintPrompt(photo: PhotoRow, monument: MonumentBrief | null): string {
  return `You are a photo restorer reconstructing a historical street scene as a full 360-degree cylindrical panorama.

The input is a very wide canvas. An authentic archival photograph sits in the middle. Every flat neutral-gray (#808080) area is missing and must be painted.

${sceneFacts(photo, monument)}

Requirements:
- Extend the scene outward from the photograph as if the same camera, at the same spot and eye level, rotated a full 360 degrees. Keep its perspective, horizon line, lighting direction, focus and film grain.
- Do not alter, move, recolour or re-frame the photograph in the middle.
- Match the photograph's tonality exactly: if it is black-and-white or sepia keep the whole panorama so; if it is hand-coloured, use the same palette.
- Show only what plausibly existed there in ${decade(photo.yearFrom)}: period architecture consistent with the visible buildings, street surface, lamps, vehicles and clothing. No modern objects.
- No text, captions, watermarks, frames, borders or split panels. One continuous photograph.
- The left and right edges must connect seamlessly, because the image wraps around 360 degrees.`;
}

export function seamPrompt(): string {
  return `This is a 360-degree historical panorama. The flat neutral-gray (#808080) vertical band in the middle is missing.
Paint only that band so the scene on its left and right joins into one continuous photograph (same buildings line, street, horizon, lighting, grain and tonality).
Keep everything outside the band exactly as it is. No text, borders or modern objects.`;
}

export function narrationPrompt(photo: PhotoRow, monument: MonumentBrief | null): string {
  return `Jesteś przewodnikiem po historii miasta w aplikacji, która pokazuje archiwalne zdjęcie w miejscu, gdzie je zrobiono.
Napisz po polsku 80–110 słów w drugiej osobie (np. „Stoisz…”, „Spójrz…”), w tonie opowieści, bez wstępu, bez list i bez markdown.
Opieraj się WYŁĄCZNIE na faktach poniżej. Nie wymyślaj dat, nazwisk ani wydarzeń; jeżeli czegoś nie wiadomo, pomiń to.
Na końcu jednym zdaniem zaznacz, że to, co widać poza kadrem oryginalnego zdjęcia, jest rekonstrukcją AI.

Fakty:
${sceneFacts(photo, monument)}
${monument?.entryDate ? `Wpis do rejestru zabytków: ${monument.entryDate}` : ''}
${photo.author ? `Autor zdjęcia: ${photo.author}` : ''}
Źródło: ${photo.attribution ?? 'Narodowe Archiwum Cyfrowe'}`;
}
