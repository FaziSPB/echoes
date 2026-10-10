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

const sharedRules = (photo: PhotoRow) => `- Keep the existing picture in the middle exactly as it is: same position, same size, same content. Do not zoom, re-frame or redraw it larger.
- Continue it outward at the SAME scale, perspective, horizon line, lighting direction, focus and film grain, as if the same camera at the same spot turned its head.
- Match the photograph's tonality exactly: if it is black-and-white or sepia keep everything so; if it is hand-coloured, use the same palette.
- Show only what plausibly existed there in ${decade(photo.yearFrom)}: period architecture consistent with the visible buildings, street surface, lamps, vehicles and clothing. No modern objects.
- No text, captions, watermarks, frames, borders or split panels. One continuous photograph.`;

export function contextPrompt(photo: PhotoRow, monument: MonumentBrief | null): string {
  return `You are a photo restorer widening a historical photograph.
The input is a wide canvas; the authentic archival photograph fills its middle half. Every flat neutral-gray (#808080) area is missing and must be painted.

${sceneFacts(photo, monument)}

Requirements:
${sharedRules(photo)}`;
}

export function outpaintPrompt(photo: PhotoRow, monument: MonumentBrief | null): string {
  return `You are a photo restorer reconstructing a historical street scene as a full 360-degree cylindrical panorama.

The input is a very wide canvas. An archival view (already widened) sits in the middle third. Every flat neutral-gray (#808080) area is missing and must be painted.

${sceneFacts(photo, monument)}

Requirements:
${sharedRules(photo)}
- Complete the full circle around the viewer: what is behind the camera belongs to the same square or street.
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

export function walkStepPrompt(photo: PhotoRow, monument: MonumentBrief | null, atM: number, stepM: number): string {
  return `You are reconstructing a short walk through a historical scene, one photograph at a time.

Image 1 is the view from the previous point, digitally enlarged to simulate the camera moving ${stepM.toFixed(1)} m forward, so it looks soft.
Image 2 is the authentic archival photograph taken at the start of the walk – use it as the reference for era, architecture, colours, tonality and grain.

${sceneFacts(photo, monument)}

Produce the sharp photograph taken from the new position, ${atM.toFixed(1)} m forward from where the archival photograph was taken, walking straight ahead in the same direction.
Requirements:
- Keep the framing and horizon of image 1. Nearby things (statues, lamp posts, railings, pavement, people, carriages) appear larger and drift slightly towards the edges as we pass them; distant buildings and towers stay almost unchanged.
- Restore fine detail in a way consistent with image 2; do not invent new landmarks.
- People and vehicles of the period may have moved naturally since the previous view.
- Same era (${decade(photo.yearFrom)}), same tonality as image 2. No modern objects, no text, no borders, one continuous photograph.`;
}
