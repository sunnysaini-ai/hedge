import { notFound } from "next/navigation";
import { supabase } from "../../../../lib/supabase";
import type { RaceAverage } from "../../../../lib/supabase";
import { formatGrade } from "../../../grades";

// Static-ish, like the homepage: every (state, office) with a race_averages
// row gets a prebuilt page; anything else 404s. Rebuilds hourly.
export const dynamicParams = false;
export const revalidate = 3600;

const CYCLE = 2026;

// Local copy (50 states + DC) — deliberately NOT imported from lib/usmap.gen.ts,
// which is a huge generated file we don't want in this route's module graph.
const STATE_NAMES: Record<string, string> = {
  AK: "Alaska", AL: "Alabama", AR: "Arkansas", AZ: "Arizona", CA: "California",
  CO: "Colorado", CT: "Connecticut", DC: "District of Columbia", DE: "Delaware",
  FL: "Florida", GA: "Georgia", HI: "Hawaii", IA: "Iowa", ID: "Idaho",
  IL: "Illinois", IN: "Indiana", KS: "Kansas", KY: "Kentucky", LA: "Louisiana",
  MA: "Massachusetts", MD: "Maryland", ME: "Maine", MI: "Michigan",
  MN: "Minnesota", MO: "Missouri", MS: "Mississippi", MT: "Montana",
  NC: "North Carolina", ND: "North Dakota", NE: "Nebraska", NH: "New Hampshire",
  NJ: "New Jersey", NM: "New Mexico", NV: "Nevada", NY: "New York", OH: "Ohio",
  OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania", RI: "Rhode Island",
  SC: "South Carolina", SD: "South Dakota", TN: "Tennessee", TX: "Texas",
  UT: "Utah", VA: "Virginia", VT: "Vermont", WA: "Washington", WI: "Wisconsin",
  WV: "West Virginia", WY: "Wyoming",
};

const OFFICE_LABEL: Record<string, string> = { senate: "Senate", governor: "Governor" };

// Series colors (same as :root --dem/--rep) plus darkened variants for small
// text labels, so 11px type keeps ~5:1 contrast on the card surface.
const DEM = "#2a78d6";
const REP = "#e34948";
const DEM_TEXT = "#215ea7";
const REP_TEXT = "#a33534";

// ---- local query-result types (do not edit lib/supabase.ts) ----

type PollAnswer = { choice: string; pct: number };

type RacePoll = {
  id: string;
  pollster_raw: string;
  start_date: string | null;
  end_date: string;
  sample_size: number | null;
  population: string | null;
  partisan: string | null; // 'DEM' | 'REP' | null in current data
  internal: boolean;
  source_url: string | null;
  poll_answers: PollAnswer[];
  pollsters: { display_name: string; fte_numeric_grade: number | null } | null;
};

type Candidate = {
  name: string;
  party: "D" | "R" | "I" | "L" | "G";
  party_source: string | null;
};

type Params = { state: string; office: string };

// ---- static params ----

export async function generateStaticParams(): Promise<Params[]> {
  const { data } = await supabase
    .from("race_averages")
    .select("state,office")
    .eq("cycle", CYCLE);
  return (data ?? []).map((r: { state: string; office: string }) => ({
    state: r.state.toLowerCase(),
    office: r.office,
  }));
}

export function generateMetadata({ params }: { params: Params }) {
  const name = STATE_NAMES[params.state.toUpperCase()] ?? params.state.toUpperCase();
  const office = OFFICE_LABEL[params.office] ?? params.office;
  return {
    title: `${name} ${office} 2026`,
    description: `Polling average and every underlying poll for the 2026 ${name} ${office} race.`,
  };
}

// ---- formatting helpers ----

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Parse YYYY-MM-DD as a UTC timestamp (avoids local-timezone day shifts). */
function ts(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return Date.UTC(y, (m ?? 1) - 1, d ?? 1);
}

function fmtDateLong(iso: string | null): string {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-").map(Number);
  return `${MONTHS[(m ?? 1) - 1]} ${d}, ${y}`;
}

/** Compact field-period range, always ending with a year. */
function fmtRange(start: string | null, end: string): string {
  const [ey, em, ed] = end.split("-").map(Number);
  const endTxt = `${MONTHS[em - 1]} ${ed}, ${ey}`;
  if (!start || start === end) return endTxt;
  const [sy, sm, sd] = start.split("-").map(Number);
  if (sy === ey && sm === em) return `${MONTHS[sm - 1]} ${sd}–${ed}, ${ey}`;
  if (sy === ey) return `${MONTHS[sm - 1]} ${sd} – ${MONTHS[em - 1]} ${ed}, ${ey}`;
  return `${MONTHS[sm - 1]} ${sd}, ${sy} – ${MONTHS[em - 1]} ${ed}, ${ey}`;
}

function surname(full: string | null): string {
  if (!full) return "—";
  const parts = full.trim().split(/\s+/);
  return parts[parts.length - 1];
}

function fmtMargin(m: number): string {
  if (m === 0) return "Even";
  return `${m > 0 ? "D" : "R"}+${Math.abs(m).toFixed(1)}`;
}

function fmtPct(v: number): string {
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}

function fmtSample(p: RacePoll): string {
  if (p.sample_size == null) return "—";
  const pop = p.population ? ` ${p.population.toUpperCase()}` : "";
  return `${p.sample_size.toLocaleString()}${pop}`;
}

/** 'DEM' → 'D', 'REP' → 'R', anything else passed through. */
function partisanLetter(v: string): string {
  return v === "DEM" ? "D" : v === "REP" ? "R" : v;
}

function PollBadges({ p }: { p: RacePoll }) {
  if (!p.partisan && !p.internal) return null;
  return (
    <>
      {p.partisan && (
        <span className={`badge ${partisanLetter(p.partisan) === "D" ? "bD" : partisanLetter(p.partisan) === "R" ? "bR" : "bN"}`}>
          {partisanLetter(p.partisan)} partisan
        </span>
      )}
      {p.internal && <span className="badge bN">internal</span>}
    </>
  );
}

// ---- scatter chart (server-rendered inline SVG; no client JS) ----
// One dot per poll per candidate at x = end_date. Dashed horizontal lines mark
// the published race_averages values. Deliberately NO trend/smoothing line —
// the published number is the weighted average, and drawing any other curve
// would imply a second methodology.

const VBW = 760;
const VBH = 260;
const PAD = { top: 16, right: 14, bottom: 28, left: 40 };
const PLOT_W = VBW - PAD.left - PAD.right;
const PLOT_H = VBH - PAD.top - PAD.bottom;

function PollScatter({
  polls,
  race,
}: {
  polls: { poll: RacePoll; dem: number; rep: number }[];
  race: RaceAverage;
}) {
  if (!polls.length) return null;

  const times = polls.map((d) => ts(d.poll.end_date));
  let t0 = Math.min(...times);
  let t1 = Math.max(...times);
  // Pad the x-domain so edge dots don't sit on the frame; guarantee a sane
  // window even when a race has a single poll (17 races are low_data).
  const DAY = 86400e3;
  const padT = Math.max(14 * DAY, (t1 - t0) * 0.04);
  t0 -= padT;
  t1 += padT;
  const tSpan = t1 - t0;

  let lo = Math.min(race.dem_pct, race.rep_pct);
  let hi = Math.max(race.dem_pct, race.rep_pct);
  for (const d of polls) {
    lo = Math.min(lo, d.dem, d.rep);
    hi = Math.max(hi, d.dem, d.rep);
  }
  // Snap the y-domain outward to clean multiples of 5 (same as ApprovalTracker).
  lo = Math.max(0, Math.floor((lo - 2) / 5) * 5);
  hi = Math.min(100, Math.ceil((hi + 2) / 5) * 5);
  const yStep = hi - lo > 40 ? 10 : 5;

  const x = (t: number) => PAD.left + ((t - t0) / tSpan) * PLOT_W;
  const y = (v: number) => PAD.top + (1 - (v - lo) / (hi - lo)) * PLOT_H;

  const yTicks: number[] = [];
  for (let v = lo; v <= hi; v += yStep) yTicks.push(v);

  // X ticks on month boundaries, thinned to ≤ ~8 labels (house algorithm).
  const monthsSpanned = tSpan / (30.44 * DAY);
  const every = [1, 2, 3, 6, 12, 24].find((m) => monthsSpanned / m <= 8) ?? 24;
  const xTicks: { x: number; label: string }[] = [];
  const d0 = new Date(t0);
  let ty = d0.getUTCFullYear();
  let tm = d0.getUTCMonth() + 1;
  if (every >= 12) {
    ty += 1;
    tm = 0;
  } else {
    tm = Math.ceil(tm / every) * every;
    ty += Math.floor(tm / 12);
    tm %= 12;
  }
  while (Date.UTC(ty, tm, 1) <= t1) {
    const t = Date.UTC(ty, tm, 1);
    xTicks.push({
      x: x(t),
      label: every >= 12 ? String(ty) : `${MONTHS[tm]} ’${String(ty).slice(2)}`,
    });
    tm += every;
    ty += Math.floor(tm / 12);
    tm %= 12;
  }
  if (xTicks.length === 0) {
    // Tiny domain with no month boundary inside it: label the endpoints.
    for (const t of [t0, t1]) {
      const d = new Date(t);
      xTicks.push({ x: x(t), label: `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}` });
    }
  }

  // Average reference lines: label the upper line above it and the lower line
  // below it, so the two labels can never collide in a close race.
  const yD = y(race.dem_pct);
  const yR = y(race.rep_pct);
  const avgLabel = (v: number) => `${v.toFixed(1)} — current average`;

  return (
    <svg
      viewBox={`0 0 ${VBW} ${VBH}`}
      className="rchart"
      role="img"
      aria-label={`Every poll used in the ${STATE_NAMES[race.state] ?? race.state} ${OFFICE_LABEL[race.office]} average, plotted over time`}
    >
      {/* gridlines + y labels */}
      {yTicks.map((v) => (
        <g key={v}>
          <line x1={PAD.left} x2={VBW - PAD.right} y1={y(v)} y2={y(v)} stroke="var(--line)" strokeWidth={1} />
          <text x={PAD.left - 8} y={y(v) + 3.5} textAnchor="end" className="rtick">
            {v}%
          </text>
        </g>
      ))}
      {/* x labels */}
      {xTicks.map((t) => (
        <text key={t.label + t.x} x={t.x} y={VBH - 8} textAnchor="middle" className="rtick">
          {t.label}
        </text>
      ))}

      {/* current-average reference lines */}
      <line x1={PAD.left} x2={VBW - PAD.right} y1={yD} y2={yD} stroke={DEM} strokeWidth={1.4} strokeDasharray="6 4" />
      <line x1={PAD.left} x2={VBW - PAD.right} y1={yR} y2={yR} stroke={REP} strokeWidth={1.4} strokeDasharray="6 4" />

      {/* one dot per poll per candidate; native <title> gives hover detail */}
      {polls.map(({ poll, dem, rep }) => {
        const cx = x(ts(poll.end_date));
        const name = poll.pollsters?.display_name ?? poll.pollster_raw;
        return (
          <g key={poll.id}>
            <circle cx={cx} cy={y(dem)} r={4} fill={DEM} fillOpacity={0.85} stroke="var(--surface-1)" strokeWidth={1.2}>
              <title>{`${name} · ${fmtRange(poll.start_date, poll.end_date)}: ${surname(race.dem_candidate)} ${fmtPct(dem)}%`}</title>
            </circle>
            <circle cx={cx} cy={y(rep)} r={4} fill={REP} fillOpacity={0.85} stroke="var(--surface-1)" strokeWidth={1.2}>
              <title>{`${name} · ${fmtRange(poll.start_date, poll.end_date)}: ${surname(race.rep_candidate)} ${fmtPct(rep)}%`}</title>
            </circle>
          </g>
        );
      })}

      {/* average labels last (upper above its line, lower below its line, so a
          close race can't collide them), with a surface halo so they stay
          legible over recent-poll dots at the right edge */}
      <text
        x={VBW - PAD.right - 4}
        y={(yD <= yR ? yD : yR) - 5}
        textAnchor="end"
        className="rlabel"
        fill={yD <= yR ? DEM_TEXT : REP_TEXT}
      >
        {avgLabel(yD <= yR ? race.dem_pct : race.rep_pct)}
      </text>
      <text
        x={VBW - PAD.right - 4}
        y={(yD <= yR ? yR : yD) + 13}
        textAnchor="end"
        className="rlabel"
        fill={yD <= yR ? REP_TEXT : DEM_TEXT}
      >
        {avgLabel(yD <= yR ? race.rep_pct : race.dem_pct)}
      </text>
    </svg>
  );
}

// ---- data ----

async function getRaceData(st: string, office: string) {
  const [raceRes, pollsRes, candsRes] = await Promise.all([
    supabase
      .from("race_averages")
      .select("*")
      .eq("cycle", CYCLE)
      .eq("state", st)
      .eq("office", office)
      .maybeSingle(),
    // Every general-election poll for this race, answers + pollster embedded.
    // Small, fully server-side filtered set (largest race today: 47 rows).
    supabase
      .from("polls")
      .select(
        "id,pollster_raw,start_date,end_date,sample_size,population,partisan,internal,source_url," +
          "poll_answers(choice,pct),pollsters(display_name,fte_numeric_grade)"
      )
      .eq("cycle", CYCLE)
      .eq("state", st)
      .eq("office", office)
      .eq("race_class", "general")
      .order("end_date", { ascending: false })
      .order("id")
      .limit(500),
    supabase
      .from("candidates")
      .select("name,party,party_source")
      .eq("cycle", CYCLE)
      .eq("state", st)
      .eq("office", office)
      .not("party", "is", null)
      .neq("party", "X")
      .order("name"),
  ]);

  return {
    race: (raceRes.data as RaceAverage | null) ?? null,
    polls: (pollsRes.data ?? []) as unknown as RacePoll[],
    candidates: (candsRes.data ?? []) as Candidate[],
  };
}

// ---- page ----

export default async function RacePage({ params }: { params: Params }) {
  const st = params.state.toUpperCase();
  const office = params.office;
  const { race, polls, candidates } = await getRaceData(st, office);
  if (!race) notFound();

  const stateName = STATE_NAMES[st] ?? st;
  const officeLabel = OFFICE_LABEL[office] ?? office;

  // Replicates refresh_race_averages()'s matchup_polls CTE exactly: a poll is
  // "in the average" iff it is a cycle-2026, race_class='general' poll for this
  // state+office (already guaranteed by the query filters) AND its answers
  // include BOTH published canonical candidates by exact name
  // (ad.choice = b.dem_name AND ar.choice = b.rep_name). The SQL applies no
  // partisan/internal/date exclusions, so neither do we — partisan and
  // internal polls are flagged with badges instead.
  const inAverage: { poll: RacePoll; dem: number; rep: number }[] = [];
  const others: RacePoll[] = [];
  for (const p of polls) {
    const dem = race.dem_candidate != null ? p.poll_answers.find((a) => a.choice === race.dem_candidate) : undefined;
    const rep = race.rep_candidate != null ? p.poll_answers.find((a) => a.choice === race.rep_candidate) : undefined;
    if (dem && rep) inAverage.push({ poll: p, dem: dem.pct, rep: rep.pct });
    else others.push(p);
  }

  const demName = surname(race.dem_candidate);
  const repName = surname(race.rep_candidate);
  const heroColor = race.low_data
    ? "var(--text-secondary)"
    : race.margin > 0
      ? "var(--dem)"
      : race.margin < 0
        ? "var(--rep)"
        : "var(--text-secondary)";

  const partyOf = new Map(candidates.map((c) => [c.name, c.party]));
  const dems = candidates.filter((c) => c.party === "D");
  const reps = candidates.filter((c) => c.party === "R");
  const otherCands = candidates.filter((c) => c.party !== "D" && c.party !== "R");

  const answerColor = (choice: string): string | undefined => {
    const p = partyOf.get(choice);
    if (p === "D") return DEM_TEXT;
    if (p === "R") return REP_TEXT;
    return undefined;
  };

  return (
    <main className="wrap">
      <header>
        <p className="backrow">
          <a className="back" href="/">← All races</a>
        </p>
        <h1>
          {stateName} {officeLabel} 2026
        </h1>
        <p className="note">
          Polling average and every underlying poll — published numbers come only from the
          precomputed <code>race_averages</code> table.
        </p>
      </header>

      {/* -------- hero: the canonical race_averages numbers -------- */}
      <div className="card">
        <div className="hero" style={{ color: heroColor }}>
          {fmtMargin(race.margin)}
        </div>
        <p className="matchup">
          {race.margin >= 0 ? (
            <>
              <span style={{ color: DEM_TEXT, fontWeight: 600 }}>
                {race.dem_candidate} (D) {race.dem_pct.toFixed(1)}%
              </span>
              {" vs "}
              <span style={{ color: REP_TEXT, fontWeight: 600 }}>
                {race.rep_candidate} (R) {race.rep_pct.toFixed(1)}%
              </span>
            </>
          ) : (
            <>
              <span style={{ color: REP_TEXT, fontWeight: 600 }}>
                {race.rep_candidate} (R) {race.rep_pct.toFixed(1)}%
              </span>
              {" vs "}
              <span style={{ color: DEM_TEXT, fontWeight: 600 }}>
                {race.dem_candidate} (D) {race.dem_pct.toFixed(1)}%
              </span>
            </>
          )}
        </p>
        <p className="note">
          {race.polls_used} poll{race.polls_used === 1 ? "" : "s"} in the average · latest{" "}
          {fmtDateLong(race.latest_poll)} · weighted by recency (45-day half-life) and sample size
        </p>
        {(race.matchup_source != null || race.avg_grade != null) && (
          <p className="note">
            {race.matchup_source === "nominees" && <>Matchup: verified nominees ✓</>}
            {race.matchup_source === "co-polling" && (
              <>Matchup: most-polled pairing (primary not yet decided)</>
            )}
            {race.matchup_source != null && race.avg_grade != null && <> · </>}
            {race.avg_grade != null && <>Avg pollster grade {formatGrade(race.avg_grade)}</>}
          </p>
        )}
        {race.low_data && (
          <div className="warnnote" role="note">
            <strong>Limited polling.</strong> This average is based on only {race.polls_used} poll
            {race.polls_used === 1 ? "" : "s"}, so it can swing sharply with each new poll. Treat it
            as a rough indication, not a precise estimate.
          </div>
        )}
      </div>

      {/* -------- scatter of every poll in the average -------- */}
      {inAverage.length > 0 && (
        <div className="card">
          <h2>Every poll in the average</h2>
          <p className="note">
            Each poll appears as two dots at its end date. Dashed lines mark the current published
            average — no trend line is drawn, by design.
          </p>
          <PollScatter polls={inAverage} race={race} />
          <div className="rlegend" aria-hidden="true">
            <span><i style={{ background: DEM }} /> {demName} (D)</span>
            <span><i style={{ background: REP }} /> {repName} (R)</span>
            <span><i className="dash" /> current average</span>
          </div>
        </div>
      )}

      {/* -------- audit table: exactly the polls behind the number -------- */}
      <div className="card">
        <h2>Polls in this average</h2>
        <p className="note">
          Selection matches <code>refresh_race_averages()</code>: general-election polls of this
          race that tested both {race.dem_candidate} and {race.rep_candidate}. Partisan and internal
          polls are included in the average (flagged below), matching the published methodology.
        </p>
        {inAverage.length === 0 ? (
          <p className="note">No polls matched — the underlying data may have changed since the average was computed.</p>
        ) : (
          <div className="tscroll">
            <table>
              <thead>
                <tr>
                  <th>Pollster</th>
                  <th className="n">Grade</th>
                  <th>Dates</th>
                  <th className="n">Sample</th>
                  <th className="n">{demName} %</th>
                  <th className="n">{repName} %</th>
                  <th className="n">Margin</th>
                  <th className="n" aria-label="Source link" />
                </tr>
              </thead>
              <tbody>
                {inAverage.map(({ poll, dem, rep }) => (
                  <tr key={poll.id}>
                    <td>
                      {poll.pollsters?.display_name ?? poll.pollster_raw}
                      <PollBadges p={poll} />
                    </td>
                    <td className="n">
                      {poll.pollsters?.fte_numeric_grade != null
                        ? poll.pollsters.fte_numeric_grade.toFixed(1)
                        : "—"}
                    </td>
                    <td className="dates">{fmtRange(poll.start_date, poll.end_date)}</td>
                    <td className="n">{fmtSample(poll)}</td>
                    <td className="n" style={{ color: DEM_TEXT, fontWeight: 600 }}>{fmtPct(dem)}</td>
                    <td className="n" style={{ color: REP_TEXT, fontWeight: 600 }}>{fmtPct(rep)}</td>
                    <td className="n">{fmtMargin(Math.round((dem - rep) * 10) / 10)}</td>
                    <td className="n">
                      {poll.source_url && (
                        <a className="srclink" href={poll.source_url} target="_blank" rel="noopener noreferrer"
                           aria-label="Poll source" title="Poll source">↗</a>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* -------- transparency: in-scope polls NOT in the average -------- */}
      {others.length > 0 && (
        <div className="card">
          <h2>Other 2026 {officeLabel} polls in {stateName}</h2>
          <p className="note">
            General-election polls for this race that are <em>not</em> in the average — they tested
            a different matchup than {demName} vs {repName}. Shown for transparency; primaries are
            excluded entirely.
          </p>
          <div className="tscroll">
            <table>
              <thead>
                <tr>
                  <th>Pollster</th>
                  <th>Dates</th>
                  <th>Top results</th>
                </tr>
              </thead>
              <tbody>
                {others.map((poll) => {
                  const top = [...poll.poll_answers].sort((a, b) => b.pct - a.pct).slice(0, 2);
                  const more = poll.poll_answers.length - top.length;
                  return (
                    <tr key={poll.id}>
                      <td>
                        {poll.pollsters?.display_name ?? poll.pollster_raw}
                        <PollBadges p={poll} />
                      </td>
                      <td className="dates">{fmtRange(poll.start_date, poll.end_date)}</td>
                      <td>
                        {top.map((a, i) => (
                          <span key={a.choice}>
                            {i > 0 && " · "}
                            <span style={{ color: answerColor(a.choice), fontWeight: 600 }}>
                              {a.choice} {fmtPct(a.pct)}
                            </span>
                          </span>
                        ))}
                        {more > 0 && <span className="note"> (+{more} more)</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* -------- candidates card -------- */}
      {candidates.length > 0 && (
        <div className="card">
          <h2>Candidates</h2>
          <div className="cands">
            {dems.length > 0 && (
              <div>
                <div className="k" style={{ color: DEM_TEXT }}>Democrats</div>
                <ul>{dems.map((c) => <li key={c.name}>{c.name}</li>)}</ul>
              </div>
            )}
            {reps.length > 0 && (
              <div>
                <div className="k" style={{ color: REP_TEXT }}>Republicans</div>
                <ul>{reps.map((c) => <li key={c.name}>{c.name}</li>)}</ul>
              </div>
            )}
            {otherCands.length > 0 && (
              <div>
                <div className="k">Other</div>
                <ul>{otherCands.map((c) => <li key={c.name}>{c.name} ({c.party})</li>)}</ul>
              </div>
            )}
          </div>
          <p className="note">Party labels curated from public sources.</p>
        </div>
      )}

      <style>{`
        :root { --surface-0:#f6f5f2; --surface-1:#fcfcfb; --line:#e3e1db;
          --text-primary:#0b0b0b; --text-secondary:#52514e;
          --dem:#2a78d6; --rep:#e34948;
          --approve:#1baf7a; --disapprove:#e0793c; }
        body { background:var(--surface-0); color:var(--text-primary);
          font-family:ui-sans-serif,-apple-system,"Segoe UI",Roboto,sans-serif; }
        .wrap { max-width:900px; margin:0 auto; padding:40px 20px; }
        .card { background:var(--surface-1); border:1px solid var(--line); border-radius:12px; padding:20px; margin-top:20px; }
        .hero { font-size:2.4rem; font-weight:650; }
        table { width:100%; border-collapse:collapse; font-size:.86rem; }
        th, td { text-align:left; padding:6px 8px; border-bottom:1px solid var(--line); }
        .n { text-align:right; }
        .note { color:var(--text-secondary); }
        code { background:var(--surface-0); border:1px solid var(--line); border-radius:4px;
          padding:0 4px; font-size:.85em; }
        .backrow { margin:0 0 6px; }
        .back { color:var(--text-secondary); text-decoration:none; font-size:.9rem; }
        .back:hover { color:var(--text-primary); text-decoration:underline; }
        h1 { margin:0 0 6px; }
        .matchup { margin:6px 0 4px; font-size:1.02rem; }
        .warnnote { margin-top:12px; padding:10px 12px; border:1px solid #edcbb2;
          border-left:3px solid var(--disapprove); border-radius:8px;
          background:#fbf1ea; font-size:.88rem; }
        .rchart { width:100%; height:auto; display:block; margin-top:8px; }
        .rtick { font-size:11px; fill:var(--text-secondary); font-family:inherit; }
        .rlabel { font-size:11px; font-weight:600; font-family:inherit;
          paint-order:stroke; stroke:var(--surface-1); stroke-width:3px; stroke-linejoin:round; }
        .rlegend { display:flex; flex-wrap:wrap; gap:6px 14px; margin-top:10px;
          font-size:.76rem; color:var(--text-secondary); }
        .rlegend i { display:inline-block; width:12px; height:12px; border-radius:3px;
          vertical-align:-1px; margin-right:5px; }
        .rlegend i.dash { height:0; width:16px; border-top:2px dashed var(--text-secondary);
          border-radius:0; vertical-align:2px; }
        .tscroll { overflow-x:auto; }
        .dates { white-space:nowrap; }
        .badge { display:inline-block; font-size:.66rem; font-weight:600; line-height:1.5;
          padding:0 6px; border-radius:999px; border:1px solid var(--line);
          margin-left:6px; vertical-align:1px; color:var(--text-secondary);
          background:var(--surface-0); white-space:nowrap; }
        .badge.bD { color:#215ea7; border-color:#c4d8f2; background:#eef4fc; }
        .badge.bR { color:#a33534; border-color:#f2cbca; background:#fdf0f0; }
        .srclink { color:var(--text-secondary); text-decoration:none; font-size:.95rem; }
        .srclink:hover { color:var(--text-primary); }
        .cands { display:grid; grid-template-columns:repeat(auto-fit,minmax(180px,1fr));
          gap:12px; margin-top:10px; }
        .cands .k { font-size:.72rem; text-transform:uppercase; color:var(--text-secondary);
          font-weight:600; letter-spacing:.03em; }
        .cands ul { list-style:none; margin:6px 0 0; padding:0; font-size:.9rem; }
        .cands li { padding:2px 0; }
      `}</style>
    </main>
  );
}
