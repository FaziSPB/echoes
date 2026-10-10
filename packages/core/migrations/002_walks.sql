-- "Walk in time": a short path from an archival photo's viewpoint with AI frames along it.
create table walks (
  id                 uuid primary key default gen_random_uuid(),
  photo_id           uuid not null unique references archival_photos (id) on delete cascade,
  status             text not null default 'running' check (status in ('running', 'done', 'failed')),
  length_m           real not null,
  subject_distance_m real not null,
  frames             jsonb not null default '[]', -- [{ distanceM, imageKey, generated }]
  model              text,
  error              text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
