-- OpenPolls schema — designed for Supabase (plain Postgres + RLS).
-- Public data commons: everything is readable by anon; only the service
-- role (used by the server-side ETL) can write. No user accounts, no PII.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------- pollsters
-- The registry is the actual moat. Stable id + alias array solves the
-- "HarrisX" / "HarrisX/Harris" / "HarrisX/Harris Poll" problem: every raw
-- pollster string seen in the wild is recorded as an alias, and this table
-- is the thing a human curates over time.
create table if not exists pollsters (
  id                    text primary key,             -- stable slug, e.g. 'harrisx'
  display_name          text not null,
  aliases               text[] not null default '{}',
  fte_pollster_id       text,                          -- join key into 538's archive
  fte_numeric_grade     numeric,
  fte_pollscore         numeric,
  fte_transparency      numeric,
  fte_aapor_roper       boolean,
  fte_pct_partisan_work numeric,
  fte_polls_analyzed    integer,
  rating_source         text,                          -- e.g. 'FiveThirtyEight/ABC News (archived 2024, CC BY 4.0)'
  notes                 text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create index if not exists pollsters_aliases_gin on pollsters using gin (aliases);

-- ---------------------------------------------------------------------polls
create table if not exists polls (
  id             text primary key,          -- source poll id (VoteHub id, etc.)
  poll_type      text not null,
  subject        text,
  seat_name      text,
  pollster_id    text references pollsters(id),
  pollster_raw   text not null,             -- exact string from the source, always kept
  start_date     date,
  end_date       date not null,
  sample_size    integer,
  population     text,                       -- lv / rv / a
  partisan       text,                       -- D / R / I / null
  internal       boolean not null default false,
  sponsors       text[] not null default '{}',
  source_url     text,
  source_org     text not null,              -- 'VoteHub', 'FiveThirtyEight/ABC News', ...
  source_license text not null,              -- 'CC BY 4.0'
  retrieved_at   date not null,
  created_at     timestamptz not null default now()
);
create index if not exists polls_type_date on polls (poll_type, end_date);
create index if not exists polls_pollster on polls (pollster_id);
create index if not exists polls_subject on polls (subject);

create table if not exists poll_answers (
  poll_id text not null references polls(id) on delete cascade,
  choice  text not null,
  pct     numeric not null,
  primary key (poll_id, choice)
);

-- -------------------------------------------------------- derived: averages
-- Transparent, boring, fully specified — recomputed on every ETL run.
-- weight = recency_decay(30-day half-life) * sqrt(min(n,3000)/1000) * quality_weight(538 grade)
create table if not exists generic_ballot_average (
  date             date primary key,
  dem              numeric not null,
  rep              numeric not null,
  margin           numeric not null,
  polls_in_window  integer not null,
  computed_at      timestamptz not null default now()
);

-- ------------------------------------------------------- data quality audit
-- Findings are published, never silently dropped. This table IS the trust
-- mechanism for an open commons: anyone can query what's wrong right now.
create table if not exists data_quality_findings (
  id          bigserial primary key,
  run_id      bigint,
  check_name  text not null,
  severity    text not null check (severity in ('good','warning','serious')),
  poll_id     text references polls(id),
  detail      text,
  flagged_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------- ingest log
create table if not exists ingest_runs (
  id           bigserial primary key,
  source       text not null,               -- 'votehub', '538-archive', ...
  started_at   timestamptz not null default now(),
  finished_at  timestamptz,
  rows_fetched integer,
  rows_new     integer,
  rows_updated integer,
  status       text not null default 'running' check (status in ('running','ok','error')),
  error        text
);

-- ---------------------------------------------------------------------- RLS
alter table pollsters               enable row level security;
alter table polls                   enable row level security;
alter table poll_answers            enable row level security;
alter table generic_ballot_average  enable row level security;
alter table data_quality_findings   enable row level security;
alter table ingest_runs             enable row level security;

-- Public commons: anyone (anon key) can read everything. Only the
-- service_role key (used server-side by the ETL, never shipped to the
-- browser) can write — service_role bypasses RLS by default in Supabase.
create policy "public read pollsters"  on pollsters  for select using (true);
create policy "public read polls"      on polls      for select using (true);
create policy "public read answers"    on poll_answers for select using (true);
create policy "public read averages"   on generic_ballot_average for select using (true);
create policy "public read findings"   on data_quality_findings for select using (true);
create policy "public read ingest_log" on ingest_runs for select using (true);

-- ------------------------------------------------------- pollster resolution
-- Given a raw pollster string, find its registry id via exact alias match.
-- Returns null if unseen — the ETL then queues it for human triage instead
-- of guessing.
create or replace function resolve_pollster(raw text)
returns text
language sql stable
as $$
  select id from pollsters where raw = any(aliases) or raw = display_name limit 1;
$$;

comment on table pollsters is 'Hand-curated pollster registry with stable IDs. The durable asset in this whole project.';
comment on table polls is 'One row per rated question. source_url/source_org/source_license/retrieved_at make every row auditable.';
comment on table data_quality_findings is 'Published defect list. A commons that hides its own errors is not a commons.';
