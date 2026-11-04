import type { Metadata } from "next";
import { supabase } from "../../lib/supabase";
import type { GenericBallotDay, RaceAverage } from "../../lib/supabase";
import { formatGrade } from "../grades";
import { AutoRefresh, NightClock, WaveStatus } from "./Clock";
import CountMap from "./CountMap";
import { statusFor } from "./mapStatus";
import type { MapStatus } from "./mapStatus";
import { COUNTED_STATES, FEED_META, getOfficialCounts } from "./feeds";
import type { RaceCount, StateCount } from "./feeds";
import type { ClosingEvent } from "./Clock";
import { ELECTION_OFFICE, EXPECT, EXPECT_SOURCE, FIRST_CLOSE, STATE_NAMES, WAVES } from "./schedule";

// Election night page, Nov 3 2026. Hedge's final polling averages laid out
// along the poll-closing timeline, a neutral live map, and — for states whose
// election office publishes an official machine-readable results file — the
// official count so far (feeds.ts). Hedge never calls races: no projections,
// no "leading" labels, candidates in fixed party order.
//
// Rendered per request so the map and counts are current; the state files
// themselves are fetched at most once a minute (cached in feeds.ts).

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Election night tracker",
  description:
    "Live poll closings, official vote counts where states publish them, Hedge's final polling averages, and links to official results. No race calls.",
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
  const [{ data: races }, { data: gb }, counts] = await Promise.all([
    supabase.from("race_averages").select("*").eq("cycle", 2026).order("state"),
    supabase.from("generic_ballot_average").select("*").order("date", { ascending: false }).limit(1),
    getOfficialCounts().catch(() => [] as StateCount[]),
  ]);
  return {
    races: ((races ?? []) as RaceAverage[]).map(clean),
    generic: ((gb ?? []) as GenericBallotDay[])[0] ?? null,
    counts,
  };
}

function fmtTime(iso: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  const dayET = (x: Date) => x.toLocaleDateString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric" });
  const datePart = dayET(d) === dayET(new Date()) ? "" : `${dayET(d)}, `;
  const et = datePart + d.toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit" });
  const pt = d.toLocaleTimeString("en-US", { timeZone: "America/Los_Angeles", hour: "numeric", minute: "2-digit" });
  return `${et} ET / ${pt} PT`;
}

function clockET(ms: number) {
  return new Date(ms).toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit" });
}
function ago(ms: number) {
  const m = Math.max(0, Math.round(ms / 60000));
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  return `${h} hr ${m % 60} min ago`;
}
function untilText(ms: number) {
  const m = Math.max(1, Math.ceil(ms / 60000));
  return m < 60 ? `in ${m} min` : `in ${Math.floor(m / 60)} hr ${m % 60} min`;
}

type Flag = { text: string; tone: "open" | "soon" | "closed" | "new" | "wait" | "warn" };

const LAST_CLOSE_MS: Record<string, number> = {};
for (const w of WAVES) for (const s of w.states) LAST_CLOSE_MS[s] = Date.parse(w.utc);
const firstCloseMs = (s: string) => (FIRST_CLOSE[s] ? Date.parse(FIRST_CLOSE[s].utc) : LAST_CLOSE_MS[s]);

/** Poll-closing flag for one state, from the schedule. */
function pollFlag(s: string, now: number): Flag {
  const first = firstCloseMs(s), last = LAST_CLOSE_MS[s];
  if (now >= last) return { text: `Polls closed ${clockET(last)} ET`, tone: "closed" };
  if (now >= first) return { text: `Partly closed · rest close ${clockET(last)} ET`, tone: "soon" };
  const soon = first - now <= 30 * 60 * 1000;
  return { text: `Polls close ${clockET(first)} ET · ${untilText(first - now)}`, tone: soon ? "soon" : "open" };
}

/** New-numbers flag for a state with an official feed: observed, never predicted. */
function numbersFlag(s: string, now: number, c: StateCount | undefined): Flag | null {
  if (!COUNTED_STATES.includes(s)) return null;
  if (!c || c.error) return { text: "Official file unreachable right now", tone: "warn" };
  const first = firstCloseMs(s);
  const upd = c.fileUpdated ? Date.parse(c.fileUpdated) : NaN;
  const race = c.races[0];
  const pct = race && race.precinctsTotal ? Math.round((race.precinctsReporting / race.precinctsTotal) * 100) : 0;
  if (now < first) return { text: "Official numbers start after polls close", tone: "open" };
  if (Number.isFinite(upd) && upd >= first - 30 * 60 * 1000 && (race?.totalVotes ?? 0) > 0) {
    return {
      text: `New official numbers ${ago(now - upd)} · ${pct}% of precincts`,
      tone: now - upd <= 15 * 60 * 1000 ? "new" : "closed",
    };
  }
  return { text: "Waiting for first official numbers", tone: "wait" };
}

function FlagChip({ f }: { f: Flag }) {
  return <span className={`flag flag-${f.tone}`}>{f.text}</span>;
}

function OfficialRace({ race }: { race: RaceCount }) {
  const pct = race.precinctsTotal ? (race.precinctsReporting / race.precinctsTotal) * 100 : 0;
  return (
    <div className="oc-race">
      <div className="oc-race-head">
        <span className="oc-office">{OFFICE_LABEL[race.office]}</span>
        <span className="oc-prog">
          <span className="oc-bar"><span style={{ width: `${Math.min(100, pct)}%` }} /></span>
          {race.precinctsReporting.toLocaleString()} of {race.precinctsTotal.toLocaleString()} precincts reporting
          {" "}({pct.toFixed(pct > 0 && pct < 1 ? 1 : 0)}%)
        </span>
      </div>
      <div className="oc-total">{race.totalVotes.toLocaleString()} votes counted</div>
      <table className="oc-tbl">
        <tbody>
          {race.candidates.filter((c) => c.party !== "O" || c.votes > 0).map((c) => (
            <tr key={`${c.name}-${c.partyLabel}`}>
              <td className={c.party === "D" ? "rr-d" : c.party === "R" ? "rr-r" : ""}>{c.name}</td>
              <td className="oc-pty">{c.partyLabel}</td>
              <td className="n">{c.votes.toLocaleString()}</td>
              <td className="n oc-share">{race.totalVotes ? `${((c.votes / race.totalVotes) * 100).toFixed(1)}%` : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {(() => {
        const hidden = race.candidates.filter((c) => c.party === "O" && c.votes === 0).length;
        return hidden > 0 ? <div className="oc-more">+{hidden} other candidate{hidden === 1 ? "" : "s"} with no votes reported yet</div> : null;
      })()}
    </div>
  );
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
  const { races, generic, counts } = await getData();
  const now = Date.now();
  const countsByState = new Map(counts.map((c) => [c.state, c]));
  const mapStatuses: Record<string, MapStatus> = {};
  for (const code of Object.keys(STATE_NAMES)) mapStatuses[code] = statusFor(code, now, countsByState);

  // Tonight's flags: every closing moment from the schedule, plus every time a
  // state with an official feed has posted numbers since its polls closed.
  type FeedItem = { t: number; text: string; kind: "close" | "first" | "numbers" };
  const feed: FeedItem[] = [];
  for (const w of WAVES) {
    feed.push({ t: Date.parse(w.utc), kind: "close", text: `Last polls close in ${w.states.map((x) => STATE_NAMES[x] ?? x).join(", ")}` });
  }
  const firstGroups: Record<string, string[]> = {};
  for (const [st, f] of Object.entries(FIRST_CLOSE)) (firstGroups[f.utc] ??= []).push(st);
  for (const [utc, sts] of Object.entries(firstGroups)) {
    feed.push({ t: Date.parse(utc), kind: "first", text: `First polls close in ${sts.map((x) => STATE_NAMES[x] ?? x).join(", ")}` });
  }
  for (const st of COUNTED_STATES) {
    const c = countsByState.get(st);
    const nf = numbersFlag(st, now, c);
    if (c && !c.error && c.fileUpdated && nf && (nf.tone === "new" || nf.tone === "closed") && nf.text.startsWith("New")) {
      const r = c.races[0];
      feed.push({
        t: Date.parse(c.fileUpdated),
        kind: "numbers",
        text: `${STATE_NAMES[st]} posted official numbers: ${r.precinctsReporting.toLocaleString()} of ${r.precinctsTotal.toLocaleString()} precincts, ${r.totalVotes.toLocaleString()} votes counted (${OFFICE_LABEL[r.office]})`,
      });
    }
  }
  feed.sort((a, b) => a.t - b.t);
  const nextIdx = feed.findIndex((f) => f.t > now);

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
          When the polls close, where the count stands, and where every Senate and governor race stood in
          Hedge's final polling averages. Hedge never calls races. Vote counts shown here come straight
          from state election offices that publish official results files; every other state links to its
          office.
        </p>
      </header>

      <AutoRefresh />
      <NightClock events={events} totalStates={totalStates} />

      <section className="card">
        <h2>Tonight's flags</h2>
        <p className="ed-sub">
          Every poll closing, plus each time a state with an official results file posts new numbers. Updates every minute.
        </p>
        <ol className="tf">
          {feed.map((f, i) => {
            const past = f.t <= now;
            return (
              <li key={`${f.t}-${i}`} className={`tf-item ${past ? "tf-past" : "tf-future"} ${i === nextIdx ? "tf-next" : ""} tf-${f.kind}`}>
                <span className="tf-time">{clockET(f.t)} ET</span>
                <span className="tf-dot" aria-hidden="true" />
                <span className="tf-text">
                  {i === nextIdx && <span className="tf-up">Next · {untilText(f.t - now)} · </span>}
                  {f.kind === "numbers" && <span className="tf-tag">New numbers · </span>}
                  {f.text}
                </span>
              </li>
            );
          })}
        </ol>
        <p className="ed-src">
          Expect most states to start posting soon after their polls close, but pace varies a lot: some count mail
          ballots first, others last, and a few take days. State-by-state notes are in the timeline below.
        </p>
      </section>

      <section className="card">
        <h2>Where the count stands</h2>
        <p className="ed-sub">
          Neutral colors only — this map shows counting progress, not who is ahead. Tap a state for its races.
        </p>
        <CountMap statuses={mapStatuses} />

        <h3 className="oc-h" id="official-counts">Official counts so far</h3>
        <p className="ed-sub">
          Read directly from each state's official election-night results file, refreshed every minute.
          Unofficial until certified. "Precincts reporting" is what states publish — it is not the share of
          all votes counted, since mail and early ballots are tallied separately.
        </p>
        <div className="oc-grid">
          {COUNTED_STATES.map((s) => {
            const c = countsByState.get(s);
            const meta = FEED_META[s];
            const st = statusFor(s, now, countsByState);
            return (
              <div key={s} className="oc-card">
                <div className="oc-head">
                  <span className="oc-state">{STATE_NAMES[s]}</span>
                  <span className="oc-status">{st.label}</span>
                </div>
                {!c || c.error ? (
                  <p className="oc-err">
                    The state's results file couldn't be read just now. Check{" "}
                    <a href={meta.sourceUrl} target="_blank" rel="noopener noreferrer">{meta.sourceName}</a>.
                  </p>
                ) : (
                  <>
                    {c.races.map((r) => <OfficialRace key={r.office} race={r} />)}
                    <p className="oc-src">
                      Source: <a href={c.sourceUrl} target="_blank" rel="noopener noreferrer">{c.sourceName}</a>
                      {" · "}file updated {fmtTime(c.fileUpdated)} · checked {fmtTime(c.fetchedAt)}
                    </p>
                  </>
                )}
              </div>
            );
          })}
        </div>
      </section>

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
                <div key={s} className="st" id={`st-${s}`}>
                  <div className="st-head">
                    <span className="st-name">{STATE_NAMES[s] ?? s}</span>
                    {FIRST_CLOSE[s] && <span className="st-note">first polls close {FIRST_CLOSE[s].et} ET</span>}
                    {ELECTION_OFFICE[s] && (
                      <a className="st-link" href={ELECTION_OFFICE[s]} target="_blank" rel="noopener noreferrer">
                        Official results ↗
                      </a>
                    )}
                  </div>
                  <div className="st-flags">
                    <FlagChip f={pollFlag(s, now)} />
                    {(() => {
                      const nf = numbersFlag(s, now, countsByState.get(s));
                      return nf ? <FlagChip f={nf} /> : null;
                    })()}
                    {COUNTED_STATES.includes(s) && <a className="st-jump" href="#official-counts">See official counts</a>}
                  </div>
                  {EXPECT[s] && <p className="st-expect"><b>What to expect:</b> {EXPECT[s]}</p>}
                  <div className="rr-list">
                    {byState[s].map((r) => <RaceRow key={r.office} r={r} />)}
                  </div>
                </div>
              ))}

              {others.length > 0 && (
                <p className="wave-others">
                  {tracked.length > 0 ? "Also closing: " : "Closing: "}
                  {others.map((s, i) => (
                    <span key={s} id={`st-${s}`}>
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
          <li>Precincts reporting is not the same as votes counted: a precinct can report while mail ballots are still being tallied.</li>
        </ul>
        <p className="ed-src">
          Poll-closing times: <a href="https://www.270towin.com/poll-closing-times" target="_blank" rel="noopener noreferrer">270toWin</a>.
          Election office links: the{" "}
          <a href="https://www.fec.gov/introduction-campaign-finance/how-to-research-public-records/state-election-offices" target="_blank" rel="noopener noreferrer">
            FEC directory of state election offices
          </a>. Vote counts: official results files from the NC State Board of Elections, Florida Division of
          Elections and Minnesota Secretary of State. "What to expect" notes: paraphrased from{" "}
          <a href={EXPECT_SOURCE} target="_blank" rel="noopener noreferrer">Al Jazeera's results-timing guide</a>, based on
          2024 patterns. Averages: Hedge, see <a href="/methodology">methodology</a>.
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

        .flag { display:inline-block; font-size:.7rem; font-weight:600; line-height:1.6; padding:1px 9px;
          border-radius:999px; white-space:nowrap; }
        .flag-open { background:#eceae4; color:#3d3c39; }
        .flag-soon { background:#fbecd9; color:#8a4b12; }
        .flag-closed { background:#e1dfd9; color:#2f2e2b; }
        .flag-new { background:#0f5c52; color:#fff; }
        .flag-wait { background:#e4efec; color:#0f5c52; }
        .flag-warn { background:#f7e0dc; color:#8a2c1f; }
        .st-flags { display:flex; flex-wrap:wrap; align-items:center; gap:6px; margin-top:5px; }
        .st-jump { font-size:.74rem; color:var(--text-secondary); }
        .st-expect { font-size:.78rem; color:var(--text-secondary); margin:5px 0 2px; line-height:1.45; }
        .st-expect b { color:var(--text-primary); font-weight:600; }
        .tf { list-style:none; margin:10px 0 0; padding:0; }
        .tf-item { display:grid; grid-template-columns:6.4em 14px 1fr; align-items:baseline; gap:8px; padding:5px 0; font-size:.86rem; }
        .tf-time { font-variant-numeric:tabular-nums; color:var(--text-secondary); font-size:.78rem; white-space:nowrap; }
        .tf-dot { width:9px; height:9px; border-radius:50%; background:#c9c7c0; align-self:center; }
        .tf-past .tf-dot { background:#3d3c39; }
        .tf-numbers .tf-dot { background:#0f5c52; }
        .tf-future { color:var(--text-secondary); }
        .tf-next { color:var(--text-primary); font-weight:600; }
        .tf-next .tf-dot { background:#e0a04a; box-shadow:0 0 0 3px #fbecd9; }
        .tf-up { color:#8a4b12; }
        .tf-tag { color:#0f5c52; font-weight:600; }
        .oc-h { margin:20px 0 0; font-size:1rem; }
        .oc-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(260px,1fr)); gap:12px; margin-top:10px; }
        .oc-card { border:1px solid var(--line); border-radius:10px; padding:12px 14px; background:var(--surface-0); }
        .oc-head { display:flex; align-items:baseline; justify-content:space-between; gap:8px; flex-wrap:wrap; }
        .oc-state { font-weight:700; }
        .oc-status { font-size:.74rem; color:var(--text-secondary); }
        .oc-race { margin-top:10px; padding-top:8px; border-top:1px solid var(--line); }
        .oc-race-head { display:flex; flex-direction:column; gap:3px; }
        .oc-office { font-weight:600; font-size:.88rem; }
        .oc-prog { font-size:.76rem; color:var(--text-secondary); display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
        .oc-bar { display:inline-block; width:70px; height:6px; border-radius:3px; background:#d6e9e4; overflow:hidden; }
        .oc-bar > span { display:block; height:100%; background:#0f5c52; }
        .oc-total { font-size:.8rem; margin-top:4px; }
        .oc-tbl { width:100%; border-collapse:collapse; font-size:.82rem; margin-top:4px; }
        .oc-tbl td { padding:3px 4px; border-bottom:1px solid var(--line); }
        .oc-tbl .n { text-align:right; font-variant-numeric:tabular-nums; }
        .oc-pty { color:var(--text-secondary); font-size:.72rem; width:2.6em; }
        .oc-share { color:var(--text-secondary); width:4em; }
        .oc-more { font-size:.72rem; color:var(--text-secondary); margin-top:4px; }
        .oc-src, .oc-err { font-size:.72rem; color:var(--text-secondary); margin:8px 0 0; line-height:1.5; }
        .oc-src a, .oc-err a { color:var(--text-secondary); }
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
