# OpenPolls

A free, open, non-profit database of US political polls — the public-good
layer FiveThirtyEight left behind when ABC/Disney shut it down in March 2025.

Stack: **Supabase (Postgres) + Vercel (Next.js)** + **GitHub Actions** for
the scheduled ETL. Chosen to match tooling already in use on DealDesk, so
there's nothing new to learn to start shipping.

## Repo layout

```
supabase/
  schema.sql     # tables, RLS policies, the pollster-resolution function
  load.py        # ETL: raw JSON/CSV -> Postgres. Idempotent, safe to re-run.
web/             # Next.js app (App Router), deploys to Vercel
data/raw/        # git-scraped snapshots of every source pull (audit trail)
.github/workflows/ingest.yml   # runs load.py on a schedule, free on GH Actions
```

## Sources (both CC BY 4.0, no scraping, no ToS acceptance)

- **VoteHub API** — `https://api.votehub.com/polls` — free, no key, current-cycle polls
- **fivethirtyeight/data** — `github.com/fivethirtyeight/data` — archived pollster ratings

## Local setup

**1. Database.** Either run Postgres locally to develop against, or point
straight at your real Supabase project:

```bash
# Option A — local Postgres for development
createdb openpolls
psql -d openpolls -f supabase/schema.sql

# Option B — your real Supabase project
# Get the connection string: Supabase dashboard -> Settings -> Database -> Connection string (URI)
psql "$SUPABASE_DB_URL" -f supabase/schema.sql
```

**2. Load data.**

```bash
pip install -r requirements.txt
mkdir -p data/raw
curl -sL "https://api.votehub.com/polls" -o data/raw/votehub_polls.json
curl -sL "https://raw.githubusercontent.com/fivethirtyeight/data/master/pollster-ratings/pollster-ratings-combined.csv" \
  -o data/raw/538_pollster_ratings.csv

DATABASE_URL="postgresql://postgres:postgres@localhost:5432/openpolls" python3 supabase/load.py
# or DATABASE_URL="$SUPABASE_DB_URL" for the real project
```

Verified output on a fresh load (Aug 1, 2026 snapshot): 5,413 polls, 185
pollster registry entries (92 matched to 538's archived ratings), 88 data-
quality findings flagged, generic ballot average computed for 567 days.

**3. Frontend.**

```bash
cd web
cp .env.example .env.local   # fill in your Supabase URL + anon key
npm install
npm run dev                  # http://localhost:3000
```

Deploy: connect the repo in Vercel, set the two `NEXT_PUBLIC_SUPABASE_*` env
vars in the project settings, done. The anon key is safe to expose — every
table is RLS-protected to public **read-only**; writes require the
`service_role` key, which only `load.py` (run via GitHub Actions) ever sees.

**4. Scheduled ingestion.** `.github/workflows/ingest.yml` runs `load.py`
against your Supabase project every 6 hours, free, on GitHub Actions. Add
one repo secret: `SUPABASE_DB_URL` (the same connection string from step 1,
Settings → Database → Connection string → URI — use the pooler/port-6543
variant if direct connections are restricted on your plan).

If you'd rather keep everything inside Vercel/Supabase instead of GitHub
Actions: Vercel Cron Jobs (`vercel.json` → `crons`) hitting an API route
that runs the same fetch-and-upsert logic works too — trade-off is Vercel's
serverless execution time limit vs. GitHub Actions' free unlimited minutes
on public repos. Start with GitHub Actions; it's simpler and free either way.

## Why this schema

`pollsters` is the actual moat. Every raw pollster string ever seen is kept
in `aliases`; `id` is a stable slug a human curates over time. The loader's
automatic grouping (`stem()` in `load.py`) is a **starting point, not an
answer** — on the first real load it merged `HarrisX/Harris Poll` with
`HarrisX/Harris` but left `HarrisX` alone and `Pantheon Insight/HarrisX`
alone, because the coarse stem match isn't perfect. That's expected. Fix it
by hand in Supabase's Table Editor — merge aliases, keep one canonical row —
which is exactly the kind of fix someone not deep in code can safely make
without touching Python.

`data_quality_findings` is not a debugging artifact — it's a public table.
A commons that hides its own defect list isn't a commons. The first real
load flagged 4 polls with reversed field dates, 80 with no sample size, and
4 duplicate answer choices within a single poll's topline. None of those are
VoteHub's fault — every poll database has them. Publishing them is the point.

## Status

- [x] Schema designed and tested against real Postgres
- [x] ETL pulls real 2026-cycle data and loads cleanly (5,413 polls verified)
- [x] Generic ballot average computed and matches the static prototype exactly
- [x] Next.js frontend builds clean against the schema
- [ ] Wire up a real Supabase project + Vercel deployment (needs your accounts connected)
- [ ] Human review pass on the pollster registry (fix the alias-grouping gaps)
- [ ] Wayback mirror of 538's historical `*_historical.csv` files
- [ ] Pollster ratings v1 (see the strategy report, Part 5)

See `OpenPolls-Strategy-Report.md` for the full landscape research, legal
position, and governance/credibility plan.
