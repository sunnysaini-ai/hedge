import type { Metadata } from "next";
import { supabase } from "../../lib/supabase";
import type { GenericBallotDay, RaceAverage } from "../../lib/supabase";
import { formatGrade } from "../grades";
import { NightClock, WaveStatus } from "./Clock";
import type { ClosingEvent } from "./Clock";
import { ELECTION_OFFICE, FIRST_CLOSE, STATE_NAMES, WAVES } from "./schedule";

// Election night page, Nov 3 2026. Reads the same race_averages rows as the
// homepage — no new queries, no new tables — and lays them out along the
// poll-closing timeline. Deliberately contains NO vote counts and NO calls:
// Hedge is a polling database, so results are linked out to each state's
// official election office.

export const revalidate = 3600;

export const metadata: Metadata = {
  title: "Election night tracker",
  description:
    "Poll-closing times for Nov 3, 2026, Hedge's final polling averages for every Senate and governor race, and links to official results.",
};

const DEM = "#2a78d6";
const REP = "#e34948";
const DEM_TEXT = "#215ea7";
const REP_TEXT = "#a33534";

const OFFICE_LABEL: Record<RaceAverage["office"], string> = { senate: "Senate", governor: "Governor" };
const OFFICE_ORDER: Record<RaceAverage["office"], number> = { senate: 0, governor: 1 };

function towardWhite(hex: string, t: number) {
  const n = parseInt(hex.slice(1), 16);
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => Math.round(v + (255 - v) * t));
  return "#" + c.map((v) => v.toString(16).padStart(2, "0")).join("");
}

/** Same competitiveness bands as the homepage map and Key races card. */
function band(m: number) {
  const a = Math.abs(m);
  const base = m >= 0 ? DEM : REP;
  const text = m >= 0 ? DEM_TEXT : REP_TEXT;
  const side = m > 0 ? "D" : "R";
  if (a >= 10) return { label: `Strong ${side}`, bg: base, fg: "#fff" };
  if (a >= 3) return { label: `Lean ${side}`, bg: towardWhite(base, 0.55), fg: text };
  return { label: "Toss-up", bg: towardWhite(base, 0.78), fg: text };
}

function fmtMargin(m: number) {
  if (Math.abs(m) < 0.05) return "Even";
  return `${m > 0 ? "D" : "R"}+${Math.abs(m).toFixed(1)}`;
}

function surname(full: string | null) {
  if (!full) return "—";
  const parts = full.trim().split(/\s+/);
  return parts[parts.length - 1];
}

function fmtDate(d: string | null) {
  if (!d) return "—";
  return new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

/** PostgREST returns numeric columns as numbers, but coerce defensively. */
function clean(r: RaceAverage): RaceAverage {
  return {
    ...r,
    dem_pct: Number(r.dem_pct),
    rep_pct: Number(r.rep_pct),
    margin: Number(r.margin),
    avg_grade: r.avg_grade == null ? null : Number(r.avg_grade),
  };
}

async function getData() {
  const [{ data: races }, { data: gb }] = await Promise.all([
    supabase.from("race_averages").select("*").eq("cycle", 2026).order("state"),
    supabase.from("generic_ballot_average").select("*").order("date", { ascending: false }).limit(1),
  ]);
  return {
    races: ((races ?? []) as RaceAverage[]).map(clean),
    generic: ((gb ?? []) as GenericBallotDay[])[0] ?? null,
  };
}

const WAVE_OF: Record<string, (typeof WAVES)[number]> = {};
for (const w of WAVES) for (const s of w.states) WAVE_OF[s] = w;

function RaceRow({ r, showState }: { r: RaceAverage; showState?: boolean }) {
  const name = `${showState ? `${STATE_NAMES[r.state] ?? r.state} ` : ""}${OFFICE_LABEL[r.office]}`;
  const href = `/race/${r.state.toLowerCase()}/${r.office}`;
  if (r.low_data) {
    return (
      <a className="rr" href={href}>
        <span className="rr-name">{name}</span>
        <span className="rr-match rr-quiet">Lightly polled — no reliable average</span>
        <span className="rr-meta">
          <span className="rr-small">{r.polls_used} poll{r.polls_used === 1 ? "" : "s"}</span>
        </span>
      </a>
    );
  }
  const b = band(r.margin);
  return (
    <a className="rr" href={href}>
      <span className="rr-name">{name}</span>
      <span className="rr-match">
        <span className="rr-d">{surname(r.dem_candidate)}</span> (D) {r.dem_pct.toFixed(1)} vs{" "}
        <span className="rr-r">{surname(r.rep_candidate)}</span> (R) {r.rep_pct.toFixed(1)}
      </span>
      <span className="rr-meta">
        <span className="rr-badge" style={{ background: b.bg, color: b.fg }}>
          {fmtMargin(r.margin)} · {b.label}
        </span>
        <span className="rr-small">
          {r.polls_used} polls · last {fmtDate(r.latest_poll)}
          {r.avg_grade != null && ` · grade ${formatGrade(r.avg_grade)}`}
        </span>
        {r.matchup_source === "nominees" ? (
          <span className="rr-small" title="Both parties' nominees verified from primary results">✓ nominees</span>
        ) : (
          <span className="rr-small rr-warn" title="Matchup inferred from which candidates were polled together">
            nominees not verified
          </span>
        )}
      </span>
    </a>
  );
}

export default async function ElectionDayPage() {
  const { races, generic } = await getData();

  const byState: Record<string, RaceAverage[]> = {};
  for (const r of races) (byState[r.state] ??= []).push(r);
  for (const list of Object.values(byState)) list.sort((a, b) => OFFICE_ORDER[a.office] - OFFICE_ORDER[b.office]);

  const watch = races
    .filter((r) => !r.low_data)
    .sort((a, b) => Math.abs(a.margin) - Math.abs(b.margin))
    .slice(0, 8);

  // Every distinct closing moment (first closings in split states included)
  // feeds the countdown.
  const events: ClosingEvent[] = WAVES.map((w) => ({
    utc: w.utc,
    et: w.et,
    pt: w.pt,
    label: `Last polls close in ${w.states.map((s) => STATE_NAMES[s] ?? s).join(", ")}`,
  }));
  const firstOnly: Record<string, string[]> = {};
  for (const [s, f] of Object.entries(FIRST_CLOSE)) (firstOnly[f.utc] ??= []).push(s);
  for (const [utc, states] of Object.entries(firstOnly)) {
    const existing = events.find((e) => e.utc === utc);
    const text = `first polls close in ${states.map((s) => STATE_NAMES[s] ?? s).join(", ")}`;
    if (existing) existing.label += `; ${text}`;
    else {
      const et = FIRST_CLOSE[states[0]].et;
      const [h, rest] = et.split(":");
      const ptHour = ((Number(h) % 12) + 12 - 3) % 12 || 12;
      events.push({ utc, et, pt: `${ptHour}:${rest}`, label: text.charAt(0).toUpperCase() + text.slice(1) });
    }
  }
  const totalStates = WAVES.reduce((n, w) => n + w.states.length, 0);

  return (
    <main className="wrap">
      <header>
        <div className="ed-kicker">Election Day · Tuesday, November 3, 2026</div>
        <h1 className="ed-h1">Election night tracker</h1>
        <p className="ed-lede">
          When the polls close in each state, and where every Senate and governor race stood in Hedge's
          final polling averages. Hedge is a polling database: we don't count votes or call races. For
          results, each state below links to its official election office.
        </p>
      </header>

      <NightClock events={events} totalStates={totalStates} />

      {watch.length > 0 && (
        <section className="card">
          <h2>Watch list</h2>
          <p className="ed-sub">The closest final polling averages. Margins this small are within normal polling error.</p>
          <div className="rr-list">
            {watch.map((r) => (
              <div key={`${r.state}-${r.office}`} className="wl-item">
                <span className="wl-time">{WAVE_OF[r.state]?.et ?? ""} ET</span>
                <RaceRow r={r} showState />
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="card">
        <h2>Poll closings</h2>
        <p className="ed-sub">
          Grouped by when the <em>last</em> polls in a state close. Times are statewide; local hours can differ.
        </p>

        {WAVES.map((w) => {
          const tracked = w.states.filter((s) => byState[s]?.length);
          const others = w.states.filter((s) => !byState[s]?.length);
          return (
            <div key={w.utc} className="wave">
              <div className="wave-head">
                <div>
                  <span className="wave-et">{w.et} ET</span>
                  <span className="wave-pt">{w.pt} PT</span>
                </div>
                <WaveStatus utc={w.utc} />
              </div>

              {tracked.map((s) => (
                <div key={s} className="st">
                  <div className="st-head">
                    <span className="st-name">{STATE_NAMES[s] ?? s}</span>
                    {FIRST_CLOSE[s] && <span className="st-note">first polls close {FIRST_CLOSE[s].et} ET</span>}
                    {ELECTION_OFFICE[s] && (
                      <a className="st-link" href={ELECTION_OFFICE[s]} target="_blank" rel="noopener noreferrer">
                        Official results ↗
                      </a>
                    )}
                  </div>
                  <div className="rr-list">
                    {byState[s].map((r) => <RaceRow key={r.office} r={r} />)}
                  </div>
                </div>
              ))}

              {others.length > 0 && (
                <p className="wave-others">
                  {tracked.length > 0 ? "Also closing: " : "Closing: "}
                  {others.map((s, i) => (
                    <span key={s}>
                      {i > 0 && ", "}
                      {ELECTION_OFFICE[s] ? (
                        <a href={ELECTION_OFFICE[s]} target="_blank" rel="noopener noreferrer">{STATE_NAMES[s] ?? s}</a>
                      ) : (
                        STATE_NAMES[s] ?? s
                      )}
                      {FIRST_CLOSE[s] && ` (first polls ${FIRST_CLOSE[s].et})`}
                    </span>
                  ))}
                  <span className="wave-nr"> — no Senate or governor average tracked</span>
                </p>
              )}
            </div>
          );
        })}
      </section>

      {generic && (
        <section className="card">
          <h2>Final generic ballot average</h2>
          <div className="gb">
            <span><span className="rr-d">Democrats</span> {Number(generic.dem).toFixed(1)}</span>
            <span><span className="rr-r">Republicans</span> {Number(generic.rep).toFixed(1)}</span>
            <span className="rr-badge" style={{ background: band(Number(generic.margin)).bg, color: band(Number(generic.margin)).fg }}>
              {fmtMargin(Number(generic.margin))}
            </span>
          </div>
          <p className="ed-sub">As of {fmtDate(generic.date)}, {generic.polls_in_window} polls in the averaging window.</p>
        </section>
      )}

      <section className="card">
        <h2>Reading tonight</h2>
        <ul className="ed-notes">
          <li>A polling average is a snapshot, not a forecast. These final averages are frozen and published as they stood.</li>
          <li>Early returns can swing. States count mail, early and Election Day votes in different orders.</li>
          <li>Some races may go to a runoff or a ranked-choice count, so a winner may not be known tonight.</li>
          <li>All counts are unofficial until each state certifies its results.</li>
        </ul>
        <p className="ed-src">
          Poll-closing times: <a href="https://www.270towin.com/poll-closing-times" target="_blank" rel="noopener noreferrer">270toWin</a>.
          Election office links: the{" "}
          <a href="https://www.fec.gov/introduction-campaign-finance/how-to-research-public-records/state-election-offices" target="_blank" rel="noopener noreferrer">
            FEC directory of state election offices
          </a>. Averages: Hedge, see <a href="/methodology">methodology</a>.
        </p>
      </section>

      <style>{`
        .wrap { max-width:900px; margin:0 auto; padding:32px 20px 48px; }
        .card { background:var(--surface-1); border:1px solid var(--line); border-radius:12px; padding:20px; margin-top:20px; }
        .card h2 { margin:0; font-size:1.15rem; }
        .ed-kicker { font-size:.78rem; text-transform:uppercase; letter-spacing:.05em; color:var(--text-secondary); font-weight:600; }
        .ed-h1 { font-size:2rem; margin:6px 0 8px; }
        .ed-lede { color:var(--text-secondary); line-height:1.5; margin:0; max-width:46em; }
        .ed-sub { color:var(--text-secondary); font-size:.86rem; margin:6px 0 4px; }

        .rr-list { margin-top:4px; }
        .rr { display:flex; align-items:center; gap:4px 12px; flex-wrap:wrap; padding:7px 4px;
          text-decoration:none; color:var(--text-primary); font-size:.88rem; border-radius:6px; }
        .rr:hover { background:var(--surface-0); }
        .rr-list > * + * { border-top:1px solid var(--line); }
        .rr-name { font-weight:600; flex:0 0 9em; }
        .rr-match { flex:1 1 auto; min-width:14em; }
        .rr-quiet { color:var(--text-secondary); }
        .rr-d { color:var(--dem); font-weight:600; }
        .rr-r { color:var(--rep); font-weight:600; }
        .rr-meta { display:inline-flex; align-items:center; gap:4px 10px; flex-wrap:wrap; margin-left:auto; }
        .rr-badge { font-size:.7rem; font-weight:600; line-height:1.6; padding:1px 9px; border-radius:999px; white-space:nowrap; }
        .rr-small { color:var(--text-secondary); font-size:.76rem; white-space:nowrap; cursor:help; }
        .rr-warn { color:#8a4b12; }

        .wl-item { display:flex; align-items:center; gap:10px; }
        .wl-item .rr { flex:1 1 auto; }
        .wl-time { flex:0 0 6.6em; white-space:nowrap; font-size:.76rem; color:var(--text-secondary); font-variant-numeric:tabular-nums; }
        .wl-item .rr-name { flex-basis:12em; }

        .wave { margin-top:18px; padding-top:14px; border-top:2px solid var(--line); }
        .wave-head { display:flex; align-items:center; justify-content:space-between; gap:12px; }
        .wave-et { font-size:1.05rem; font-weight:700; font-variant-numeric:tabular-nums; }
        .wave-pt { font-size:.84rem; color:var(--text-secondary); margin-left:8px; }
        .st { margin-top:10px; }
        .st-head { display:flex; align-items:baseline; gap:4px 12px; flex-wrap:wrap; }
        .st-name { font-weight:650; }
        .st-note { font-size:.76rem; color:var(--text-secondary); }
        .st-link { margin-left:auto; font-size:.8rem; color:var(--text-secondary); }
        .st-link:hover { color:var(--text-primary); }
        .st .rr-list { margin-left:2px; }
        .wave-others { font-size:.82rem; color:var(--text-secondary); margin:10px 0 0; line-height:1.6; }
        .wave-others a { color:var(--text-secondary); }
        .wave-nr { font-style:italic; }

        .gb { display:flex; align-items:center; gap:16px; flex-wrap:wrap; margin-top:10px; font-size:1.05rem; }
        .ed-notes { margin:10px 0 0; padding-left:18px; line-height:1.6; font-size:.9rem; }
        .ed-src { color:var(--text-secondary); font-size:.78rem; margin:12px 0 0; line-height:1.6; }
        .ed-src a { color:var(--text-secondary); }

        @media (max-width:560px) {
          .ed-h1 { font-size:1.6rem; }
          .rr-name { flex-basis:100%; }
          .rr-meta { margin-left:0; }
          .wl-item { flex-direction:column; align-items:flex-start; gap:0; }
          .wl-time { flex-basis:auto; padding-left:4px; }
          .st-link { margin-left:0; }
        }
      `}</style>
    </main>
  );
}
