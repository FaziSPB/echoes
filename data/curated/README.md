# Curated echoes

`<city>/echoes.json` lists hand-verified archival photos with the camera position (`lat`, `lon`),
direction (`headingDeg`, compass, 0 = north), horizontal field of view (`hfovDeg`) and `pitchDeg`.

- **NAC photos** (preferred): download manually from <https://audiovis.nac.gov.pl> (the site blocks bots),
  save into `<city>/photos/` and reference with `"file": "photos/…jpg"`. Use the NAC signature (sygnatura)
  as `sourceRef`, `"source": "nac_curated"` and attribution `Narodowe Archiwum Cyfrowe, sygn. …`.
- **Bootstrap set**: public-domain postcards (Polona) and LoC photochroms via Wikimedia Commons
  (`"source": "commons"`, `remoteUrl`). Headings are estimated from landmark bearings – fix them on site
  with the in-app calibration mode (saves through `PATCH /v1/admin/photos/:id`).
- `crop` (fractions) removes postcard margins and printed captions before the photo enters the pipeline.

Seed: `pnpm cli seed:curated --city Wrocław`
