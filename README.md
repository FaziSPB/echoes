# Echoes – generatywny wehikuł czasu

BEST Hacks 2026 · Code For Culture · kategoria **Historia**

Stań tam, gdzie sto lat temu ktoś zrobił zdjęcie. Echoes nakłada archiwalną fotografię na obraz z kamery
telefonu, a GenAI rozszerza kadr do panoramy 360°, którą oglądasz, obracając się dookoła. Oryginalne
piksele archiwum zostają **zawsze nienaruszone**, a część zrekonstruowaną przez AI można w każdej chwili podświetlić.

## Jak to działa

```
 Expo app (Android, Expo Go)              ┌──────────── worker (BullMQ) ─────────────┐
  Mapa · W pobliżu · Echo AR              │ echo: sharp + Gemini (4:1 outpaint,      │
  (kamera + three.js + żyroskop)          │       szew 360°, wklejenie oryginału)    │
        │ REST/JSON, kontrakty zod        │ ingest: rejestr NID / geokodowanie /     │
        ▼                                 │   Commons / AI-geoparsing / seed         │
 api (Fastify, bezstanowe) ──────────────►│ limiter RPM, retry, idempotencja         │
   /v1/* · /docs (OpenAPI) · /media/*     └────────┬───────────────┬─────────────────┘
        │             │             │              │               │
  Postgres+PostGIS   Redis (kolejka)    S3 (SeaweedFS): zdjęcia, panoramy
        ▲
 dane.gov.pl → api.zabytek.gov.pl (rejestr NID) · GUGiK UUG (geokoder) · Wikimedia Commons · kuracja NAC
```

| Warstwa | Technologia | Dlaczego |
|---|---|---|
| Aplikacja | Expo SDK 57, Expo Router, react-native-maps, expo-camera, expo-sensors, three.js + @react-three/fiber/native | Działa w Expo Go bez natywnego builda; „magic window” AR: kamera + przezroczysta scena GL sterowana żyroskopem i kompasem |
| Kontrakty | `packages/shared` (zod) | Te same schematy walidują requesty w API i odpowiedzi w aplikacji (end-to-end type safety) |
| API | Fastify 5 + fastify-type-provider-zod + Swagger | Bezstanowe, skaluje się poziomo; OpenAPI generowane ze schematów |
| Dane | PostgreSQL 17 + PostGIS 3.5 | Indeksy GiST, `ST_DWithin`, klastrowanie `ST_SnapToGrid`: cały kraj (81 tys. zabytków) w jednym zapytaniu |
| Kolejka | BullMQ + Redis | GenAI trwa dziesiątki sekund: poza ścieżką requestu, z limiterem RPM, retry i skalowaniem workerów |
| Pliki | S3 (SeaweedFS lokalnie) | Klucze niezmienne i wersjonowane (`echoes/{photo}/v{pipeline}/pano.jpg`), więc CDN może je cache'ować na zawsze |
| GenAI | Gemini (Nano Banana 2.1 obraz, Flash tekst) | Outpainting 4:1 = cylinder 360°×90°; structured output do geolokalizacji podpisów; narracja |

### Dane i ich pochodzenie
- **Rejestr zabytków nieruchomych (NID)**: znajdowany przez katalog **dane.gov.pl** (dataset 1130). API zasobu
  zwraca 81 279 rekordów bez współrzędnych. Synchronizujemy go tylko wtedy, gdy zmieni się `modified` zasobu.
- **Współrzędne**: geokoder **GUGiK UUG** (adresy), dalej punkt NID z zabytek.pl, a na końcu centroid ulicy.
  Wrocław: 1174/1186 obiektów zlokalizowanych (99%).
- **Zdjęcia**: kuracja ręczna z **NAC** (serwis blokuje boty, więc pobieramy przez przeglądarkę i zapisujemy sygnaturę)
  oraz harvester mirroru NAC i kategorii miasta na Wikimedia Commons. Lokalizację z podpisów (np. „Schweidnitzer Straße” → ul. Świdnicka) wyciąga
  **AI-geoparsing**: Gemini ze structured output, potem GUGiK albo dopasowanie trigramowe do nazw z rejestru.
- Startowy zestaw 7 zdjęć Wrocławia: pocztówki z Polony (BN) i fotochromy LoC w domenie publicznej (`data/curated/wroclaw`).

### Pipeline Echa (`packages/core/src/echo`)
1. Zdjęcie trafia na płótno 4:1 (4096×1024 = 360°×90°) w miejsce wynikające z jego `hfov` i `pitch`. Reszta płótna to szare pole do wypełnienia.
2. Gemini rozszerza scenę w duchu epoki (prompt z metadanymi rejestru: chronologia, funkcja, adres).
3. Szew 360°: obraz przesuwamy o pół szerokości, szew wyszarzamy, model go „leczy”, po czym wklejamy z miękką krawędzią.
4. Ton: monochromatyczne źródło oznacza monochromatyczną panoramę. **Oryginał wklejamy z powrotem** i zapisujemy jego `photoRect`.
5. Narracja po polsku tylko z faktów (rejestr + opis). Zawiera zdanie o rekonstrukcji AI.

## Uruchomienie

```bash
cp .env.example .env              # wpisz GEMINI_API_KEY (generowanie obrazów wymaga płatnego planu Gemini API)
docker compose -f infra/docker-compose.yml up -d db redis minio
pnpm install
pnpm cli migrate
pnpm cli registry:sync            # dane.gov.pl → rejestr NID (81 tys. rekordów)
pnpm cli registry:geocode --city Wrocław
pnpm cli seed:curated --city Wrocław
pnpm dev:api                      # http://localhost:3000/docs
pnpm dev:worker
pnpm cli echo:pregen              # wygeneruj echa dla wszystkich zweryfikowanych zdjęć
cd apps/mobile && npx expo start  # Expo Go na Androidzie (ta sama sieć Wi-Fi)
```

Telefon poza siecią lokalną: wystaw API tunelem i ustaw `EXPO_PUBLIC_API_URL` oraz `PUBLIC_BASE_URL` na adres tunelu.
Media idą przez `/media/*` z API, więc wystarczy jeden tunel.

Pozostałe polecenia CLI: `photos:harvest-commons`, `photos:geoparse`, `photos:link`, `echo:generate --photo <id> [--sync]`, `smoke:gemini`.

## Testy
```bash
pnpm test        # geometria panoramy, azymuty/dystanse
pnpm typecheck
```

## Struktura
```
apps/mobile      Expo (mapa, lista, ekran Echo AR)
apps/api         Fastify REST + OpenAPI + proxy mediów
apps/worker      BullMQ worker + CLI operacyjne
packages/shared  kontrakty zod + geo utils (wspólne z aplikacją)
packages/core    baza, klienci źródeł, ingest, pipeline Echa
infra/           docker compose + Dockerfile
data/curated/    ręcznie zweryfikowane zdjęcia z pozycją i kierunkiem aparatu
```
