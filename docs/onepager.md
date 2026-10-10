# Echoes – generatywny wehikuł czasu
**BEST Hacks 2026 · Code For Culture · kategoria: Historia** · Zespół: _[nazwa zespołu, imiona]_

## Problem
Pamięć miast jest zapisana w otwartych zbiorach: rejestr zabytków NID na dane.gov.pl ma **81 279** obiektów,
a Narodowe Archiwum Cyfrowe, Polona i inne archiwa przechowują setki tysięcy fotografii. Te zbiory żyją jednak w bazach danych, nie na ulicach.
Ktoś stojący dziś na wrocławskim Rynku nie zobaczy, jak to miejsce wyglądało w 1900 czy w 1945 roku.
Istniejące rozwiązania (np. Historypin) przypinają statyczne zdjęcia do mapy, bez kontekstu przestrzennego i bez immersji.

## Rozwiązanie
**Echoes** zamienia archiwalne zdjęcie w miejsce, do którego można wejść:
1. **Mapa ech:** zabytki z rejestru NID i archiwalne zdjęcia przypięte do miejsc, z których je zrobiono.
2. **Nakładka AR:** w punkcie Echo kamera telefonu pokazuje teraźniejszość, a suwak czasu płynnie odsłania przeszłość
   w tym samym kadrze (orientacja z żyroskopu i kompasu, kalibracja jednym gestem).
3. **Echo 360°:** GenAI rozszerza kadr do pełnej panoramy. Obracasz się i stoisz w 1910 roku.
4. **Narracja:** krótka opowieść po polsku generowana wyłącznie z faktów (rejestr + opis archiwalny), czytana na głos.

**Rzetelność historyczna:** piksele oryginału są zawsze nienaruszone, a przełącznik „AI” podświetla wszystko, co zrekonstruował model.
Każde zdjęcie ma sygnaturę i źródło.

## Technologia (działający kod, nie makieta)
- **Aplikacja:** React Native / Expo (Android, Expo Go), three.js na żywo nad obrazem z kamery, sensory urządzenia.
- **Backend:** TypeScript monorepo; bezstanowe API Fastify z kontraktami zod i OpenAPI; PostgreSQL + PostGIS
  (klastrowanie i zapytania przestrzenne dla całego kraju); kolejka BullMQ/Redis dla GenAI (limit zapytań, ponowienia, idempotencja);
  magazyn S3 z niezmiennymi, wersjonowanymi plikami, gotowymi pod CDN.
- **Otwarte dane:** rejestr NID pobierany przez katalog dane.gov.pl (synchronizacja po dacie modyfikacji zasobu);
  współrzędne z geokodera GUGiK. **Wrocław: 1174 z 1186 zabytków zlokalizowanych (99%).**
- **AI:** Gemini rozszerza kadr progresywnie (zdjęcie → kontekst 21:9 → pas 360° → domknięcie szwu) i tłumaczy podpisy archiwalne
  na lokalizacje („Schweidnitzer Straße” → ul. Świdnicka), które następnie geokodujemy.

## Dla kogo
- **Turyści i mieszkańcy:** spacer po mieście „warstwami czasu”.
- **Szkoły:** lekcja historii w terenie (zmiana tkanki miasta, zniszczenia 1945, odbudowa).
- **Miasta, biura promocji, muzea i archiwa:** nowy kanał udostępniania zbiorów i trasy tematyczne.

## Model biznesowy i rozwój
- Licencje dla miast i instytucji kultury (trasy tematyczne, kampanie promocyjne, wydarzenia jubileuszowe).
- Partnerstwa z archiwami: Echoes jako „witryna” zbiorów w przestrzeni miejskiej, z linkiem do źródła.
- Skalowanie: nowe miasto to konfiguracja i kuracja, bo pipeline danych jest ogólnopolski.
- Dalej: crowdsourcing kalibracji kierunku zdjęć przez użytkowników, natywne AR (ARCore/ARKit), pakiety offline,
  audiodeskrypcja dla osób niewidomych.
