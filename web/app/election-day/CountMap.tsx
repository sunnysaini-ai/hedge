"use client";

import { MAP_VIEWBOX, STATE_PATHS } from "../../lib/usmap.gen";
import { CLOSED, OPEN, SOON, ramp } from "./mapStatus";
import type { MapStatus } from "./mapStatus";

// Election night map. A client component only so the 110 KB of state shapes
// ship once in the (cached) JS bundle instead of in every one-minute refresh;
// the fills themselves are computed on the server (mapStatus.ts) and passed in.

export default function CountMap({ statuses }: { statuses: Record<string, MapStatus> }) {
  const codes = Object.keys(STATE_PATHS);
  return (
    <div className="cm">
      <svg viewBox={MAP_VIEWBOX} className="cm-svg" role="img"
        aria-label="US map showing which states' polls have closed and, where official files exist, the share of precincts reporting">
        {codes.map((code) => {
          const s = statuses[code] ?? { fill: OPEN, label: "" };
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
