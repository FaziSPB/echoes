create extension if not exists postgis;
create extension if not exists pg_trgm;
create extension if not exists pgcrypto;

-- Immovable monuments register (NID, published on dane.gov.pl, dataset 1130).
create table monuments (
  inspire_id         text primary key,
  name               text not null,
  protection_form    text,
  location_precision text,
  chronology         text,
  function           text,
  registry_docs      text,
  entry_date         text,
  voivodeship        text,
  county             text,
  commune            text,
  city               text,
  street             text,
  house_number       text,
  zabytek_url        text,
  location           geometry(Point, 4326),
  geocode_source     text check (geocode_source in ('gugik', 'gugik_street', 'zabytek_pl', 'manual')),
  geocode_accuracy   real,
  geocode_attempted_at timestamptz,
  source_synced_at   timestamptz not null default now()
);
create index monuments_location_gix on monuments using gist (location);
create index monuments_city_idx on monuments (city);
create index monuments_name_trgm on monuments using gin (name gin_trgm_ops);

create table archival_photos (
  id                  uuid primary key default gen_random_uuid(),
  source              text not null check (source in ('nac_curated', 'commons_nac', 'commons')),
  source_ref          text not null,
  title               text not null,
  description         text,
  date_text           text,
  year_from           int,
  year_to             int,
  author              text,
  license             text,
  attribution         text,
  original_url        text,
  remote_image_url    text,
  image_key           text,
  thumb_key           text,
  width               int,
  height              int,
  city                text,
  location            geometry(Point, 4326),
  heading_deg         real,
  hfov_deg            real not null default 55,
  pitch_deg           real not null default 0,
  geo_confidence      real,
  geoparse            jsonb,
  status              text not null default 'candidate' check (status in ('candidate', 'verified', 'rejected')),
  monument_inspire_id text references monuments (inspire_id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (source, source_ref)
);
create index archival_photos_location_gix on archival_photos using gist (location);
create index archival_photos_status_idx on archival_photos (status);
create index archival_photos_monument_idx on archival_photos (monument_inspire_id);

-- One generated panorama per photo per pipeline version (idempotency key).
create table echoes (
  id               uuid primary key default gen_random_uuid(),
  photo_id         uuid not null references archival_photos (id) on delete cascade,
  pipeline_version int not null,
  status           text not null default 'queued' check (status in ('queued', 'running', 'done', 'failed')),
  step             text,
  pano_key         text,
  preview_key      text,
  pano_width       int,
  pano_height      int,
  photo_rect       jsonb,
  sky_color        text,
  ground_color     text,
  narration        text,
  model            text,
  duration_ms      int,
  error            text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (photo_id, pipeline_version)
);

create table geocode_cache (
  query      text primary key,
  response   jsonb not null,
  created_at timestamptz not null default now()
);

create table sync_state (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);
