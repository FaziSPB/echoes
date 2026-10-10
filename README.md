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
| Aplikacja | Expo SDK 57, Expo Router, Leaflet + OpenStreetMap (WebView), expo-camera, expo-sensors, three.js + @react-three/fiber/native | Działa w Expo Go bez natywnego builda i bez kluczy API; „magic window” AR: kamera + przezroczysta scena GL, orientacja z fuzji żyroskopu i czujnika absolutnego |
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
pnpm cli echo:pregen              # PŁATNE: echa dla zweryfikowanych zdjęć bez gotowej panoramy
cd apps/mobile && npx expo start  # Expo Go na Androidzie (ta sama sieć Wi-Fi)
```

### Koszty GenAI
Jedno echo to 2 płatne obrazy (kontekst 2K + pas 360°), a z domykaniem szwu 3. Zabezpieczenia:
- `ECHO_DAILY_IMAGE_LIMIT` (domyślnie 10): twardy dzienny limit dla wszystkich workerów i CLI, liczony atomowo w Redis.
  Echo, które się nie zmieści, w ogóle nie startuje (`pnpm cli budget` pokazuje zużycie). `0` wyłącza generację.
- `ECHO_IMAGE_SIZE=2K` (zamiast 4K) i `ECHO_SEAM_PASS=false`, gdy liczy się każdy grosz (szew zostaje za plecami widza).
- Aplikacja generuje echo wyłącznie po kliknięciu „Wygeneruj Echo 360°”. Zwykłe otwarcie zdjęcia nic nie kosztuje.
- `pnpm cli echo:recompose --photo <id>` przelicza kompozycję z zapisanych klatek, bez nowych generacji.

Telefon poza siecią lokalną: wystaw API tunelem i ustaw `EXPO_PUBLIC_API_URL` na adres tunelu.
Media idą przez `/media/*` z API (ścieżki względne), więc wystarczy jeden tunel. Pod CDN ustaw `PUBLIC_MEDIA_URL`.

### Spacer w czasie (Most Tumski)
Przejdź ok. 10 m, a przeszłość idzie razem z Tobą:
- **Klatka 0** to oryginał archiwalny.
- **Klatki 3,3 / 6,7 / 10 m** wygenerowało AI łańcuchowo. Poprzednia klatka jest przybliżana o czynnik `D/(D−krok)` (model kamery otworkowej, `D` = odległość do zabytku z rejestru), a Gemini renderuje widok z nowego punktu, z oryginałem jako wzorcem stylu.
- **Pozycja:** GPS (±5–10 m) jest za mało dokładny, więc aplikacja liczy kroki z akcelerometru, tylko gdy patrzysz wzdłuż trasy (PDR). Działa tak samo na moście i na sali.
- **Wyświetlanie:** klatka za Tobą jest przybliżana, klatka przed Tobą płynnie się przenika. Plakietka pokazuje „oryginał” albo „rekonstrukcja AI”.
- **Awaryjnie:** suwak dystansu.

Trasa jest generowana tylko z CLI (API nie ma takiego endpointu):
`pnpm cli walk:generate --photo <id> --frames 3 --length 10`, czyli 3 płatne obrazy 2K.

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
