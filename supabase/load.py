"""
OpenPolls loader — raw JSON/CSV (VoteHub + 538 archive) -> Postgres (Supabase schema).

Run against a local Postgres to develop/test (as done here), then point
DATABASE_URL at your real Supabase project's connection string and re-run.
Idempotent: safe to re-run, uses upserts throughout.
"""
import json, csv, re, os, sys, collections, math, datetime as dt
import psycopg2
import psycopg2.extras as pgx

DB = os.environ.get("DATABASE_URL", "postgresql://postgres:postgres@localhost:5432/openpolls")
RAW = "data/raw"
RETRIEVED = "2026-08-01"

conn = psycopg2.connect(DB)
conn.autocommit = False
cur = conn.cursor()


def slugify(name: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", (name or "").lower()).strip("-")
    return s or "unknown"


def stem(name: str) -> str:
    """Coarse grouping key for entity resolution — same idea as validate.py."""
    return re.sub(r"[^a-z]", "", (name or "").lower())[:8]


def fnum(v):
    if v is None or v in ("", "NA", "N/A", "NaN"):
        return None
    try:
        return float(v)
    except ValueError:
        return None


def inum(v):
    f = fnum(v)
    return int(f) if f is not None else None


# ---------------------------------------------------------- ingest run record
cur.execute(
    "insert into ingest_runs (source, status) values ('votehub+538-archive','running') returning id")
run_id = cur.fetchone()[0]

# ------------------------------------------------------------------ load raw
polls = json.load(open(f"{RAW}/votehub_polls.json"))

ratings = {}
with open(f"{RAW}/538_pollster_ratings.csv") as f:
    for row in csv.DictReader(f):
        ratings[row["pollster"]] = row

# ---------------------------------------------------- build the pollster registry
# Group raw pollster strings by a coarse stem so obvious variants
# (HarrisX / HarrisX/Harris / HarrisX/Harris Poll) land on one registry row.
# This is a STARTING POINT for human curation, not a final answer — every
# group is visible in `pollsters.aliases` for review, nothing is hidden.
raw_names = collections.Counter(p["pollster"] for p in polls)
groups = collections.defaultdict(list)
for name, n in raw_names.items():
    groups[stem(name)].append((name, n))

registry_rows = []
raw_to_registry_id = {}
for grp_stem, members in groups.items():
    members.sort(key=lambda t: -t[1])
    canonical = members[0][0]                     # most frequent raw string wins
    rid = slugify(canonical)
    aliases = sorted({m[0] for m in members})
    r = ratings.get(canonical) or next((ratings[m] for m, _ in members if m in ratings), None)
    registry_rows.append({
        "id": rid, "display_name": canonical, "aliases": aliases,
        "fte_pollster_id": r["pollster_rating_id"] if r else None,
        "fte_numeric_grade": fnum(r["numeric_grade"]) if r else None,
        "fte_pollscore": fnum(r["POLLSCORE"]) if r else None,
        "fte_transparency": fnum(r["wtd_avg_transparency"]) if r else None,
        "fte_aapor_roper": (r["aapor_roper"] == "TRUE") if r else None,
        "fte_pct_partisan_work": fnum(r["percent_partisan_work"]) if r else None,
        "fte_polls_analyzed": inum(r["number_polls_pollster_total"]) if r else None,
        "rating_source": "FiveThirtyEight/ABC News (archived 2024, CC BY 4.0)" if r else None,
    })
    for m, _ in members:
        raw_to_registry_id[m] = rid

pgx.execute_values(cur, """
    insert into pollsters (id, display_name, aliases, fte_pollster_id, fte_numeric_grade,
        fte_pollscore, fte_transparency, fte_aapor_roper, fte_pct_partisan_work,
        fte_polls_analyzed, rating_source)
    values %s
    on conflict (id) do update set
        display_name = excluded.display_name,
        aliases = (select array(select distinct unnest(pollsters.aliases || excluded.aliases))),
        fte_pollster_id = excluded.fte_pollster_id,
        fte_numeric_grade = excluded.fte_numeric_grade,
        fte_pollscore = excluded.fte_pollscore,
        fte_transparency = excluded.fte_transparency,
        fte_aapor_roper = excluded.fte_aapor_roper,
        fte_pct_partisan_work = excluded.fte_pct_partisan_work,
        fte_polls_analyzed = excluded.fte_polls_analyzed,
        rating_source = excluded.rating_source,
        updated_at = now()
""", [(r["id"], r["display_name"], r["aliases"], r["fte_pollster_id"], r["fte_numeric_grade"],
       r["fte_pollscore"], r["fte_transparency"], r["fte_aapor_roper"], r["fte_pct_partisan_work"],
       r["fte_polls_analyzed"], r["rating_source"]) for r in registry_rows])

# --------------------------------------------------------------------- polls
poll_rows, answer_rows, findings = [], [], []
seen_answer_keys = set()
for p in polls:
    # skip/flag polls with reversed field dates rather than silently
    # computing garbage recency weights downstream
    if p.get("start_date") and p["start_date"] > p["end_date"]:
        findings.append((run_id, "reversed_field_dates", "serious", p["id"],
                          f"{p['pollster']}: start {p['start_date']} > end {p['end_date']}"))

    poll_rows.append((
        p["id"], p["poll_type"], p.get("subject"), p.get("seat_name"),
        raw_to_registry_id.get(p["pollster"]), p["pollster"],
        p.get("start_date"), p["end_date"], p.get("sample_size"), p.get("population"),
        p.get("partisan"), bool(p.get("internal")), p.get("sponsors") or [],
        p.get("url"), "VoteHub", "CC BY 4.0", RETRIEVED,
    ))
    if not p.get("sample_size"):
        findings.append((run_id, "missing_sample_size", "warning", p["id"], p["pollster"]))

    for a in p.get("answers") or []:
        key = (p["id"], a["choice"])
        if key in seen_answer_keys:
            findings.append((run_id, "duplicate_answer_choice", "warning", p["id"],
                              f"{p['pollster']}: choice '{a['choice']}' repeated in one poll's answers"))
            continue
        seen_answer_keys.add(key)
        answer_rows.append((p["id"], a["choice"], a["pct"]))

pgx.execute_values(cur, """
    insert into polls (id, poll_type, subject, seat_name, pollster_id, pollster_raw,
        start_date, end_date, sample_size, population, partisan, internal, sponsors,
        source_url, source_org, source_license, retrieved_at)
    values %s
    on conflict (id) do update set
        pollster_id = excluded.pollster_id, sample_size = excluded.sample_size,
        retrieved_at = excluded.retrieved_at
""", poll_rows)

pgx.execute_values(cur, """
    insert into poll_answers (poll_id, choice, pct) values %s
    on conflict (poll_id, choice) do update set pct = excluded.pct
""", answer_rows)

# ------------------------------------------------- derived: generic ballot avg
# Same transparent, documented weighting as the static prototype:
#   weight = recency_decay(30-day half-life) * sqrt(min(n,3000)/1000) * quality_weight
#   quality_weight = 0.6 + 0.4*(numeric_grade/3) if rated, else 0.8
# Partisan-sponsored and internal polls are excluded (and were never inserted
# as gb candidates below if incomplete).
HALF_LIFE, ASOF = 30.0, dt.date(2026, 8, 1)
grade_by_pollster = {r["id"]: r["fte_numeric_grade"] for r in registry_rows}

gb = []
answers_by_poll = collections.defaultdict(dict)
for pid, choice, pct in answer_rows:
    answers_by_poll[pid][choice] = pct

for p in polls:
    if p["poll_type"] != "generic-ballot" or p.get("partisan") or p.get("internal"):
        continue
    ans = answers_by_poll.get(p["id"], {})
    dem, rep = ans.get("Dem"), ans.get("Rep")
    if dem is None or rep is None:
        continue
    end = dt.date.fromisoformat(p["end_date"])
    if p.get("start_date") and p["start_date"] > p["end_date"]:
        continue  # already flagged above; don't feed a bad-date poll into the average
    n = p.get("sample_size") or 600
    g = grade_by_pollster.get(raw_to_registry_id.get(p["pollster"]))
    qw = 0.6 + 0.4 * (g / 3.0) if g else 0.8
    gb.append({"end_date": end, "n": n, "dem": dem, "rep": rep, "qw": qw})

gb.sort(key=lambda r: r["end_date"])
gb_series = []
if gb:
    day = gb[0]["end_date"] + dt.timedelta(days=20)
    while day <= ASOF:
        num_d = num_r = den = 0.0
        used = 0
        for r in gb:
            age = (day - r["end_date"]).days
            if 0 <= age <= 120:
                w = (0.5 ** (age / HALF_LIFE)) * math.sqrt(min(r["n"], 3000) / 1000) * r["qw"]
                num_d += w * r["dem"]; num_r += w * r["rep"]; den += w; used += 1
        if den > 0 and used >= 3:
            gb_series.append((day, round(num_d / den, 2), round(num_r / den, 2),
                              round(num_d / den - num_r / den, 2), used))
        day += dt.timedelta(days=1)

if gb_series:
    pgx.execute_values(cur, """
        insert into generic_ballot_average (date, dem, rep, margin, polls_in_window)
        values %s
        on conflict (date) do update set dem=excluded.dem, rep=excluded.rep,
            margin=excluded.margin, polls_in_window=excluded.polls_in_window,
            computed_at=now()
    """, gb_series)

if findings:
    pgx.execute_values(cur, """
        insert into data_quality_findings (run_id, check_name, severity, poll_id, detail)
        values %s
    """, findings)

conn.commit()

# -------------------------------------------------------------------- verify
cur.execute("select count(*) from polls"); n_polls = cur.fetchone()[0]
cur.execute("select count(*) from pollsters"); n_pollsters = cur.fetchone()[0]
cur.execute("select count(*) from pollsters where fte_numeric_grade is not null"); n_matched = cur.fetchone()[0]
cur.execute("select count(*) from poll_answers"); n_answers = cur.fetchone()[0]
cur.execute("""select p.display_name, count(*) from polls pl join pollsters p on p.id=pl.pollster_id
               group by 1 order by 2 desc limit 8""")
top = cur.fetchall()

cur.execute("update ingest_runs set status='ok', finished_at=now(), rows_fetched=%s, rows_new=%s where id=%s",
            (len(poll_rows), len(poll_rows), run_id))
conn.commit()

print(f"polls            {n_polls}")
print(f"poll_answers     {n_answers}")
print(f"pollsters        {n_pollsters}  ({n_matched} matched to 538 ratings)")
print(f"findings flagged {len(findings)}")
print(f"generic ballot avg: {len(gb_series)} days" + (f", latest {gb_series[-1]}" if gb_series else ""))
print("top pollsters:")
for name, n in top:
    print(f"  {name:30s} {n}")
