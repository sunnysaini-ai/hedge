import { MAP_VIEWBOX, STATE_PATHS } from "../../lib/usmap.gen";
import type { StateCount } from "./feeds";
import { FIRST_CLOSE, WAVES } from "./schedule";

// Server-rendered US map for election night. Deliberately NEUTRAL colors —
// nothing on this map is red or blue, so nothing on it can be read as a
// projection. Fill = where the count stands:
//   · polls still open / closing soon / closed (all states, from the schedule)
//   · for states whose election office publishes an official results file,
//     a teal ramp by share of precincts reporting.
// The page re-renders every minute (AutoRefresh), so fills stay current.

const OPEN = "#f4f3ef";
const SOON = "#f6dfbd";
const CLOSED = "#c9c7c0";
const RAMP_LO = [214, 233, 228]; // 0% precincts reporting
const RAMP_HI = [15, 92, 82]; // 100%

function ramp(t: number) {
  const k = Math.max(0, Math.min(1, t));
  const c = RAMP_LO.map((lo, i) => Math.round(lo + (RAMP_HI[i] - lo) * k));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

const LAST_CLOSE: Record<string, number> = {};
for (const w of WAVES) for (const s of w.states) LAST_CLOSE[s] = Date.parse(w.utc);

export type MapStatus = { fill: string; label: string };

export function statusFor(state: string, now: number, counts: Map<string, StateCount>): MapStatus {
  const last = LAST_CLOSE[state];
  if (last == null) return { fill: OPEN, label: "no statewide race schedule" };
  const first = FIRST_CLOSE[state] ? Date.parse(FIRST_CLOSE[state].utc) : last;
  if (now < first) {
    return first - now <= 30 * 60 * 1000
      ? { fill: SOON, label: "polls closing soon" }
      : { fill: OPEN, label: "polls open" };
  }
  const c = counts.get(state);
  const race = c && !c.error ? c.races[0] : undefined;
  if (race && race.precinctsTotal > 0) {
    const pct = race.precinctsReporting / race.precinctsTotal;
    const lbl = `${Math.round(pct * 100)}% of precincts reporting (official)`;
    return { fill: ramp(pct), label: now < last ? `some polls still open · ${lbl}` : lbl };
  }
  if (now < last) return { fill: SOON, label: "some polls closed, some still open" };
  return { fill: CLOSED, label: "polls closed · results on the state's site" };
}

export default function CountMap({ counts, now }: { counts: StateCount[]; now: number }) {
  const byState = new Map(counts.map((c) => [c.state, c]));
  const codes = Object.keys(STATE_PATHS);
  return (
    <div className="cm">
      <svg viewBox={MAP_VIEWBOX} className="cm-svg" role="img"
        aria-label="US map showing which states' polls have closed and, where official files exist, the share of precincts reporting">
        {codes.map((code) => {
          const s = statusFor(code, now, byState);
          return (
            <a key={code} href={`#st-${code}`} aria-label={`${STATE_PATHS[code].name}: ${s.label}`}>
              <path d={STATE_PATHS[code].d} fill={s.fill} stroke="#fff" strokeWidth={0.8} className="cm-st">
                <title>{`${STATE_PATHS[code].name}: ${s.label}`}</title>
              </path>
            </a>
          );
        })}
      </svg>
      <div className="cm-legend" aria-hidden="true">
        <span><i style={{ background: OPEN }} /> Polls open</span>
        <span><i style={{ background: SOON }} /> Closing soon / partly closed</span>
        <span><i style={{ background: CLOSED }} /> Closed — count on state site</span>
        <span className="cm-ramp">
          <i style={{ background: `linear-gradient(90deg, ${ramp(0)}, ${ramp(1)})`, width: 56 }} />
          Precincts reporting, official file (0–100%)
        </span>
      </div>
      <style>{`
        .cm-svg { width:100%; height:auto; display:block; margin-top:8px; }
        .cm-st { transition: fill .4s; }
        .cm a:hover .cm-st, .cm a:focus .cm-st { stroke:#0b0b0b; stroke-width:1.4; }
        .cm-legend { display:flex; flex-wrap:wrap; gap:6px 16px; margin-top:8px;
          font-size:.76rem; color:var(--text-secondary); }
        .cm-legend span { display:inline-flex; align-items:center; gap:6px; }
        .cm-legend i { display:inline-block; width:14px; height:10px; border-radius:2px; border:1px solid var(--line); }
      `}</style>
    </div>
  );
}
