import type { StateCount } from "./feeds";
import { FIRST_CLOSE, WAVES } from "./schedule";

// Map fill logic for election night, computed on the server per request.
// Deliberately NEUTRAL colors — nothing is red or blue, so nothing on the map
// can be read as a projection. Fill = where the count stands:
//   · polls still open / closing soon / closed (every state, from the schedule)
//   · for states whose election office publishes an official results file,
//     a teal ramp by share of precincts reporting.

export const OPEN = "#f4f3ef";
export const SOON = "#f6dfbd";
export const CLOSED = "#c9c7c0";
const RAMP_LO = [214, 233, 228]; // 0% precincts reporting
const RAMP_HI = [15, 92, 82]; // 100%

export function ramp(t: number) {
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

