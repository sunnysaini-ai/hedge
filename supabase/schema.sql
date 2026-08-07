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
  created_at     timestamptz not null default now(),
  -- ---------------------------------------------------- structured geography
  -- Backfilled from `subject` by the ETL's post-processing pass (supabase/load.py);
  -- free-text `subject` remains authoritative/kept, these are derived and cached.
  cycle          integer,                    -- e.g. 2026, parsed from subject's leading year
  state          char(2),                    -- USPS code, e.g. 'TX' (references us_states.code)
  office         text,                       -- 'senate' | 'governor' | 'house' | 'attorney-general' | 'mayor'
  race_class     text,                       -- 'primary' | 'general'
  district       text                        -- e.g. 'AK-01', house races only
);
create index if not exists polls_type_date on polls (poll_type, end_date);
create index if not exists polls_pollster on polls (pollster_id);
create index if not exists polls_subject on polls (subject);
create index if not exists polls_race_idx on polls (state, office, race_class, end_date desc);

-- Idempotent for re-runs against a DB that already has `polls` without these
-- columns (schema.sql is also applied to the live project, not just fresh installs).
alter table polls add column if not exists cycle      integer;
alter table polls add column if not exists state      char(2);
alter table polls add column if not exists office     text;
alter table polls add column if not exists race_class text;
alter table polls add column if not exists district   text;

create table if not exists poll_answers (
  poll_id text not null references polls(id) on delete cascade,
  choice  text not null,
  pct     numeric not null,
  primary key (poll_id, choice)
);

-- ------------------------------------------------------------------ geography
-- Static reference: 50 states + DC. Seeded once below; never touched by the ETL.
create table if not exists us_states (
  code char(2) primary key,        -- USPS code
  name text not null unique
);

insert into us_states (code, name) values
  ('AK','Alaska'), ('AL','Alabama'), ('AR','Arkansas'), ('AZ','Arizona'),
  ('CA','California'), ('CO','Colorado'), ('CT','Connecticut'),
  ('DC','District of Columbia'), ('DE','Delaware'), ('FL','Florida'),
  ('GA','Georgia'), ('HI','Hawaii'), ('IA','Iowa'), ('ID','Idaho'),
  ('IL','Illinois'), ('IN','Indiana'), ('KS','Kansas'), ('KY','Kentucky'),
  ('LA','Louisiana'), ('MA','Massachusetts'), ('MD','Maryland'), ('ME','Maine'),
  ('MI','Michigan'), ('MN','Minnesota'), ('MO','Missouri'), ('MS','Mississippi'),
  ('MT','Montana'), ('NC','North Carolina'), ('ND','North Dakota'),
  ('NE','Nebraska'), ('NH','New Hampshire'), ('NJ','New Jersey'),
  ('NM','New Mexico'), ('NV','Nevada'), ('NY','New York'), ('OH','Ohio'),
  ('OK','Oklahoma'), ('OR','Oregon'), ('PA','Pennsylvania'), ('RI','Rhode Island'),
  ('SC','South Carolina'), ('SD','South Dakota'), ('TN','Tennessee'),
  ('TX','Texas'), ('UT','Utah'), ('VA','Virginia'), ('VT','Vermont'),
  ('WA','Washington'), ('WI','Wisconsin'), ('WV','West Virginia'), ('WY','Wyoming')
on conflict (code) do nothing;

-- ------------------------------------------------------------------ candidates
-- Human/agent-curated party registry. `party` starts null on insert (the ETL only
-- seeds identity rows) and is filled in by curation (Haiku fan-out + Opus review,
-- or the ETL's narrow auto-classify pass) — never overwritten once non-null.
create table if not exists candidates (
  state        char(2) not null,
  office       text not null,
  cycle        integer not null,
  name         text not null,             -- matches poll_answers.choice exactly
  party        text check (party in ('D','R','I','L','G','X')),
  party_source text,                      -- e.g. 'literal-label', 'non-candidate', 'haiku:<domain>'
  updated_at   timestamptz default now(),
  primary key (state, office, cycle, name)
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

-- One row per (state, office, cycle) competitive race. Fully recomputed by
-- refresh_race_averages() every ETL run — never hand-edited, never partially
-- updated. The front end reads only this table; it never aggregates raw
-- polls at request time (see hedge-build-plan-and-model-routing.md).
create table if not exists race_averages (
  state         char(2) not null,
  office        text not null,
  cycle         integer not null,
  dem_candidate text,
  rep_candidate text,
  dem_pct       numeric,
  rep_pct       numeric,
  margin        numeric,
  leader_party  char(1),
  polls_used    integer not null default 0,
  latest_poll   date,
  low_data      boolean not null default true,   -- true when polls_used < 3
  computed_at   timestamptz default now(),
  primary key (state, office, cycle)
);

-- One row per (subject, date). Fully recomputed by refresh_approval_averages()
-- every ETL run — never hand-edited, never partially updated. Same pattern as
-- race_averages above.
create table if not exists approval_averages (
  subject         text not null,
  date            date not null,
  approve_pct     numeric,
  disapprove_pct  numeric,
  net             numeric,
  polls_in_window integer not null default 0,
  computed_at     timestamptz default now(),
  primary key (subject, date)
);
create index if not exists approval_averages_subject_idx on approval_averages (subject, date);

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
alter table us_states               enable row level security;
alter table candidates              enable row level security;
alter table race_averages           enable row level security;
alter table approval_averages       enable row level security;

-- Public commons: anyone (anon key) can read everything. Only the
-- service_role key (used server-side by the ETL, never shipped to the
-- browser) can write — service_role bypasses RLS by default in Supabase.
create policy "public read pollsters"  on pollsters  for select using (true);
create policy "public read polls"      on polls      for select using (true);
create policy "public read answers"    on poll_answers for select using (true);
create policy "public read averages"   on generic_ballot_average for select using (true);
create policy "public read findings"   on data_quality_findings for select using (true);
create policy "public read ingest_log" on ingest_runs for select using (true);
create policy "public read us_states"  on us_states  for select using (true);
create policy "public read candidates" on candidates for select using (true);
create policy "public read race_averages" on race_averages for select using (true);
create policy "public read approval_averages" on approval_averages for select using (true);

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

-- ---------------------------------------------------------- race averages
-- Fully recomputes `race_averages` for one cycle. Picks, per (state, office),
-- the highest-polled D-vs-R matchup among candidates already resolved in
-- `candidates` (party curation gates this — an unresolved candidate can't
-- anchor a race average), then weights each matchup poll by 45-day recency
-- half-life * sample-size damping (sqrt(min(n,3000)/1000)), same spirit as
-- generic_ballot_average's weighting. `low_data` = true (and leader_party
-- null) below 3 polls, so the front end can grey those out instead of
-- implying false precision. The ETL just calls this; all the logic lives
-- here so it stays reproducible outside the ETL too (`select
-- refresh_race_averages(2026);`).
create or replace function refresh_race_averages(p_cycle int default 2026)
returns integer
language sql
security definer
set search_path = public
as $$
with pair_counts as (
  select p.state, p.office, ad.choice as dem_name, ar.choice as rep_name,
         count(distinct p.id) as n
  from polls p
  join poll_answers ad on ad.poll_id = p.id
  join candidates cd on cd.cycle=p.cycle and cd.state=p.state and cd.office=p.office
       and cd.name=ad.choice and cd.party='D'
  join poll_answers ar on ar.poll_id = p.id
  join candidates cr on cr.cycle=p.cycle and cr.state=p.state and cr.office=p.office
       and cr.name=ar.choice and cr.party='R'
  where p.cycle = p_cycle and p.race_class='general'
    and p.office in ('senate','governor') and p.state is not null
  group by 1,2,3,4
),
best_pair as (
  select distinct on (state, office) state, office, dem_name, rep_name, n
  from pair_counts order by state, office, n desc, dem_name, rep_name
),
matchup_polls as (
  select b.state, b.office, b.dem_name, b.rep_name, p.id, p.end_date,
         ad.pct as dem_pct, ar.pct as rep_pct,
         power(0.5, greatest(current_date - p.end_date, 0) / 45.0)
           * sqrt(least(coalesce(p.sample_size, 600), 3000) / 1000.0) as w
  from best_pair b
  join polls p on p.cycle = p_cycle and p.race_class='general'
       and p.state=b.state and p.office=b.office
  join poll_answers ad on ad.poll_id=p.id and ad.choice=b.dem_name
  join poll_answers ar on ar.poll_id=p.id and ar.choice=b.rep_name
),
agg as (
  select state, office, dem_name, rep_name,
         round((sum(dem_pct*w)/nullif(sum(w),0))::numeric, 2) as dem_pct,
         round((sum(rep_pct*w)/nullif(sum(w),0))::numeric, 2) as rep_pct,
         count(*) as polls_used, max(end_date) as latest_poll
  from matchup_polls group by 1,2,3,4
),
upserted as (
  insert into race_averages (state, office, cycle, dem_candidate, rep_candidate,
    dem_pct, rep_pct, margin, leader_party, polls_used, latest_poll, low_data, computed_at)
  select state, office, p_cycle, dem_name, rep_name, dem_pct, rep_pct,
         round(dem_pct - rep_pct, 2),
         case when polls_used < 3 then null
              when dem_pct > rep_pct then 'D'
              when rep_pct > dem_pct then 'R' else null end,
         polls_used, latest_poll, polls_used < 3, now()
  from agg
  on conflict (state, office, cycle) do update set
    dem_candidate=excluded.dem_candidate, rep_candidate=excluded.rep_candidate,
    dem_pct=excluded.dem_pct, rep_pct=excluded.rep_pct, margin=excluded.margin,
    leader_party=excluded.leader_party, polls_used=excluded.polls_used,
    latest_poll=excluded.latest_poll, low_data=excluded.low_data, computed_at=now()
  returning 1
)
select count(*)::int from upserted;
$$;

-- ------------------------------------------------------- approval averages
-- Fully recomputes `approval_averages` for every (subject, date) with an
-- approval poll in range. For each day in a subject's polled span, averages
-- all 'approval'-type polls whose end_date falls in the trailing 270 days
-- with the same 45-day recency half-life * sample-size damping weighting as
-- refresh_race_averages(). disapprove_pct is left null when a poll lacks a
-- 'Disapprove' answer choice; net is approve_pct minus disapprove_pct (0 if
-- null). The ETL just calls this every run (`select
-- refresh_approval_averages();`); idempotent full recompute.
create or replace function refresh_approval_averages()
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  n int;
begin
  with subjects as (
    select distinct subject, min(end_date) as first_date, max(end_date) as last_date
    from polls where poll_type = 'approval' and subject is not null
    group by subject
  ),
  days as (
    select s.subject, d::date as date
    from subjects s, generate_series(s.first_date, s.last_date, interval '1 day') d
  ),
  scored as (
    select dd.subject, dd.date, p.id, ad.pct as approve_pct, an.pct as disapprove_pct,
           power(0.5, greatest(dd.date - p.end_date, 0) / 45.0)
             * sqrt(least(coalesce(p.sample_size, 600), 3000) / 1000.0) as w
    from days dd
    join polls p on p.poll_type = 'approval' and p.subject = dd.subject
      and p.end_date <= dd.date and p.end_date > dd.date - 270
    join poll_answers ad on ad.poll_id = p.id and lower(ad.choice) = 'approve'
    left join poll_answers an on an.poll_id = p.id and lower(an.choice) = 'disapprove'
  ),
  agg as (
    select subject, date,
           round((sum(approve_pct*w)/nullif(sum(w),0))::numeric, 2) as approve_pct,
           round((sum(disapprove_pct*w)/nullif(sum(w),0))::numeric, 2) as disapprove_pct,
           count(*) as polls_in_window
    from scored group by 1,2
  ),
  upserted as (
    insert into approval_averages (subject, date, approve_pct, disapprove_pct, net, polls_in_window, computed_at)
    select subject, date, approve_pct, disapprove_pct,
           round(approve_pct - coalesce(disapprove_pct,0), 2), polls_in_window, now()
    from agg
    on conflict (subject, date) do update set
      approve_pct=excluded.approve_pct, disapprove_pct=excluded.disapprove_pct,
      net=excluded.net, polls_in_window=excluded.polls_in_window, computed_at=now()
    returning 1
  )
  select count(*) into n from upserted;
  return n;
end;
$function$;

comment on table pollsters is 'Hand-curated pollster registry with stable IDs. The durable asset in this whole project.';
comment on table polls is 'One row per rated question. source_url/source_org/source_license/retrieved_at make every row auditable.';
comment on table data_quality_findings is 'Published defect list. A commons that hides its own errors is not a commons.';
comment on table us_states is 'Static reference: USPS state codes + names, used to resolve poll subjects to a state.';
comment on table candidates is 'Human/agent-curated party registry keyed on (state, office, cycle, name). The ETL never overwrites a non-null party.';
comment on table race_averages is 'One row per competitive (state, office, cycle) race. Fully recomputed by refresh_race_averages() every ETL run; the front end reads only this table.';
comment on table approval_averages is 'One row per (subject, date) approval average. Fully recomputed by refresh_approval_averages() every ETL run.';
