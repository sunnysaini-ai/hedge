import { STATE_PATHS } from "../lib/usmap.gen";
import type { RaceAverage } from "../lib/supabase";
import { formatGrade } from "./grades";

// Server component — pure presentation over the race rows the homepage already
// fetches for <StateMap>. No query of its own, no interactivity.

// Same party colors and mixing math as StateMap's fillFor(), so the badge
// bands here match the map fill exactly. (StateMap is a client module, so its
// helpers can't be imported into this server component — keep in sync.)
const DEM = "#2a78d6";
const REP = "#e34948";
const DEM_TEXT = "#215ea7";
const REP_TEXT = "#a33534";

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function rgbToHex(r: number, g: number, b: number) {
  return "#" + [r, g, b].map((c) => Math.round(c).toString(16).padStart(2, "0")).join("");
}
function towardWhite(hex: string, t: number) {
  const [r, g, b] = hexToRgb(hex);
  return rgbToHex(r + (255 - r) * t, g + (255 - g) * t, b + (255 - b) * t);
}

/** Same competitiveness bands as the map fill: <3 toss-up, 3–10 lean, ≥10 strong. */
function band(r: RaceAverage): { label: string; bg: string; fg: string } {
  const m = r.margin;
  const a = Math.abs(m);
  const base = m >= 0 ? DEM : REP;
  const text = m >= 0 ? DEM_TEXT : REP_TEXT;
  const side = m > 0 ? "D" : "R";
  if (a >= 10) return { label: `Strong ${side}`, bg: base, fg: "#fff" };
  if (a >= 3) return { label: `Lean ${side}`, bg: towardWhite(base, 0.55), fg: text };
  return { label: "Toss-up", bg: towardWhite(base, 0.78), fg: text };
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

const OFFICE_LABEL: Record<RaceAverage["office"], string> = {
  senate: "Senate",
  governor: "Governor",
};

const SHOW = 8;

export default function KeyRaces({
  senate,
  governor,
}: {
  senate: RaceAverage[];
  governor: RaceAverage[];
}) {
  const all = [...senate, ...governor];
  const shown = all
    .filter((r) => !r.low_data)
    .sort((a, b) => Math.abs(a.margin) - Math.abs(b.margin))
    .slice(0, SHOW);
  if (shown.length === 0) return null;

  // Low-data races that would have made the list on margin alone — excluded
  // from the ranking, but counted honestly below.
  const cutoff = Math.abs(shown[shown.length - 1].margin);
  const excluded = all.filter((r) => r.low_data && Math.abs(r.margin) <= cutoff).length;

  return (
    <div className="card">
      <h2>Key races</h2>
      <p className="krsub">The closest polling averages of the 2026 cycle.</p>

      <div className="krlist">
        {shown.map((r) => {
          const b = band(r);
          return (
            <a
              key={`${r.state}-${r.office}`}
              className="krrow"
              href={`/race/${r.state.toLowerCase()}/${r.office}`}
            >
              <span className="krrace">
                {STATE_PATHS[r.state]?.name ?? r.state} {OFFICE_LABEL[r.office]}
              </span>
              <span className="krmatch">
                <span className="krd">{surname(r.dem_candidate)}</span> (D) {r.dem_pct.toFixed(1)}{" "}
                vs <span className="krr">{surname(r.rep_candidate)}</span> (R) {r.rep_pct.toFixed(1)}
              </span>
              <span className="krmeta">
                <span className="krbadge" style={{ background: b.bg, color: b.fg }}>
                  {fmtMargin(r.margin)} · {b.label}
                </span>
                {r.avg_grade != null && (
                  <span className="krgrade">avg grade {formatGrade(r.avg_grade)}</span>
                )}
                {r.matchup_source === "nominees" && (
                  <span
                    className="krnom"
                    title="Both parties' nominees verified from primary results"
                  >
                    ✓ nominees set
                  </span>
                )}
              </span>
            </a>
          );
        })}
      </div>

      {excluded > 0 && (
        <p className="krmore">
          {excluded} more race{excluded === 1 ? " is" : "s are"} close but lightly polled.
        </p>
      )}

      <style>{`
        .krsub { color:var(--text-secondary); font-size:.86rem; margin:6px 0 4px; }
        .krlist { margin-top:6px; }
        .krrow { display:flex; align-items:center; gap:4px 12px; flex-wrap:wrap;
          padding:8px 4px; text-decoration:none; color:var(--text-primary);
          font-size:.88rem; border-radius:6px; }
        .krrow + .krrow { border-top:1px solid var(--line); }
        .krrow:hover { background:var(--surface-0); }
        .krrace { font-weight:600; flex:0 0 11.5em; }
        .krmatch { flex:1 1 auto; min-width:15em; }
        .krd { color:var(--dem); font-weight:600; }
        .krr { color:var(--rep); font-weight:600; }
        .krmeta { display:inline-flex; align-items:center; gap:10px; margin-left:auto; }
        .krbadge { font-size:.7rem; font-weight:600; line-height:1.6; padding:1px 9px;
          border-radius:999px; white-space:nowrap; }
        .krgrade { color:var(--text-secondary); font-size:.76rem; white-space:nowrap; }
        .krnom { color:var(--text-secondary); font-size:.76rem; white-space:nowrap; cursor:help; }
        .krmore { color:var(--text-secondary); font-size:.8rem; margin:10px 0 0; }
        @media (max-width:560px) {
          .krrace { flex-basis:100%; }
          .krmeta { margin-left:0; }
        }
      `}</style>
    </div>
  );
}
