"use client";

import { useMemo, useState } from "react";
import type { GenericBallotDay } from "../lib/supabase";

// Party colors come from the site-wide CSS variables declared in app/page.tsx
// (:root { --dem:#2a78d6; --rep:#e34948; }) so this chart stays in sync with
// the state map and any future theming.
const DEM = "var(--dem)";
const REP = "var(--rep)";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Parse YYYY-MM-DD as a UTC timestamp (avoids local-timezone day shifts). */
function ts(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return Date.UTC(y, (m ?? 1) - 1, d ?? 1);
}
function fmtDateLong(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return `${MONTHS[(m ?? 1) - 1]} ${d}, ${y}`;
}

/**
 * "D+2.3" / "R+0.8" / "Even". Round to one decimal *before* branching so a
 * hairline 0.04 margin reads "Even" rather than "D+0.0".
 */
function fmtMargin(m: number): string {
  const a = Math.round(Math.abs(m) * 10) / 10;
  if (a === 0) return "Even";
  return `${m > 0 ? "D" : "R"}+${a.toFixed(1)}`;
}
function marginColor(m: number): string {
  const a = Math.round(Math.abs(m) * 10) / 10;
  if (a === 0) return "var(--text-primary)";
  return m > 0 ? DEM : REP;
}

// ---- chart geometry (viewBox units) — same frame as ApprovalTracker ----
const VBW = 760;
const VBH = 280;
const PAD = { top: 12, right: 14, bottom: 26, left: 40 };
const PLOT_W = VBW - PAD.left - PAD.right;
const PLOT_H = VBH - PAD.top - PAD.bottom;

type XTick = { x: number; label: string };

export default function GenericBallotChart({ series }: { series: GenericBallotDay[] }) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  // Scales, ticks and per-point pixel positions. Everything — including the
  // "as of" date in the note — derives from the series itself; we never
  // assume the data reaches today.
  const chart = useMemo(() => {
    if (series.length < 2) return null;
    const times = series.map((d) => ts(d.date));
    const t0 = times[0];
    const t1 = times[times.length - 1];
    const tSpan = Math.max(1, t1 - t0);

    let lo = Infinity;
    let hi = -Infinity;
    for (const d of series) {
      lo = Math.min(lo, d.dem, d.rep);
      hi = Math.max(hi, d.dem, d.rep);
    }
    // Snap the y-domain outward to clean multiples of 5.
    lo = Math.max(0, Math.floor((lo - 2) / 5) * 5);
    hi = Math.min(100, Math.ceil((hi + 2) / 5) * 5);
    const yStep = hi - lo > 40 ? 10 : 5;

    const x = (t: number) => PAD.left + ((t - t0) / tSpan) * PLOT_W;
    const y = (v: number) => PAD.top + (1 - (v - lo) / (hi - lo)) * PLOT_H;
    const xs = times.map(x);

    const yTicks: number[] = [];
    for (let v = lo; v <= hi; v += yStep) yTicks.push(v);

    // X ticks: month boundaries, thinned so we never exceed ~8 labels — the
    // interval adapts to the span (monthly for short series, quarterly for
    // ~1.5-year ones, yearly beyond).
    const monthsSpanned = tSpan / (30.44 * 86400e3);
    const every = [1, 2, 3, 6, 12, 24].find((m) => monthsSpanned / m <= 8) ?? 24;
    const xTicks: XTick[] = [];
    const d0 = new Date(t0);
    let ty = d0.getUTCFullYear();
    let tm = d0.getUTCMonth() + 1; // first month boundary at/after t0
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

    const path = (get: (d: GenericBallotDay) => number) =>
      series.map((d, i) => `${i === 0 ? "M" : "L"}${xs[i].toFixed(1)},${y(get(d)).toFixed(1)}`).join("");

    // Dot markers: thin them so neighbors stay ~5+ viewBox units apart; the
    // line remains the primary mark.
    const pxPerPoint = PLOT_W / series.length;
    const dotStride = Math.max(1, Math.ceil(5 / pxPerPoint));
    const dotR = pxPerPoint >= 6 ? 2 : 1.4;

    return { xs, y, yTicks, xTicks, path, dotStride, dotR };
  }, [series]);

  if (!series.length) return null;
  const last = series[series.length - 1];
  const hover = hoverIdx != null && chart ? series[hoverIdx] : null;

  // Nearest data point (by time) to the mouse position.
  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!chart) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const vx = ((e.clientX - rect.left) / rect.width) * VBW;
    const { xs } = chart;
    let lo = 0;
    let hi = xs.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (xs[mid] < vx) lo = mid;
      else hi = mid;
    }
    setHoverIdx(vx - xs[lo] <= xs[hi] - vx ? lo : hi);
  };

  // Tooltip flips to the left half of the chart when hovering the right half.
  const tipLeftPct = hover && chart ? (chart.xs[hoverIdx!] / VBW) * 100 : 0;
  const tipFlip = tipLeftPct > 55;

  return (
    <div className="card gbcard">
      <h2>Generic congressional ballot</h2>

      <div className="hero" style={{ color: marginColor(last.margin) }}>
        {fmtMargin(last.margin)}
      </div>
      <p className="note">
        <span style={{ color: DEM, fontWeight: 600 }}>{last.dem.toFixed(1)}% Dem</span>
        {" · "}
        <span style={{ color: REP, fontWeight: 600 }}>{last.rep.toFixed(1)}% Rep</span>
        {" · as of "}
        {fmtDateLong(last.date)} · {last.polls_in_window} polls in window
      </p>

      {chart && (
        <div className="gbchartwrap">
          <svg
            viewBox={`0 0 ${VBW} ${VBH}`}
            className="gbchart"
            role="img"
            aria-label="Generic congressional ballot polling average over time"
            onMouseMove={onMove}
            onMouseLeave={() => setHoverIdx(null)}
          >
            {/* gridlines + y labels */}
            {chart.yTicks.map((v) => (
              <g key={v}>
                <line
                  x1={PAD.left}
                  x2={VBW - PAD.right}
                  y1={chart.y(v)}
                  y2={chart.y(v)}
                  stroke="var(--line)"
                  strokeWidth={1}
                />
                <text x={PAD.left - 8} y={chart.y(v) + 3.5} textAnchor="end" className="gbtick">
                  {v}%
                </text>
              </g>
            ))}
            {/* x labels */}
            {chart.xTicks.map((t) => (
              <text key={t.label + t.x} x={t.x} y={VBH - 8} textAnchor="middle" className="gbtick">
                {t.label}
              </text>
            ))}

            {/* series lines (Dem drawn last so it sits on top) */}
            <path d={chart.path((d) => d.rep)} fill="none" stroke={REP} strokeWidth={1.8} strokeLinejoin="round" />
            <path d={chart.path((d) => d.dem)} fill="none" stroke={DEM} strokeWidth={1.8} strokeLinejoin="round" />

            {/* sparse dot markers (thinned by stride so long series stay clean) */}
            {series.map((d, i) =>
              i % chart.dotStride === 0 ? (
                <g key={d.date}>
                  <circle cx={chart.xs[i]} cy={chart.y(d.dem)} r={chart.dotR} fill={DEM} fillOpacity={0.45} />
                  <circle cx={chart.xs[i]} cy={chart.y(d.rep)} r={chart.dotR} fill={REP} fillOpacity={0.45} />
                </g>
              ) : null
            )}

            {/* crosshair + highlighted points */}
            {hover && hoverIdx != null && (
              <g pointerEvents="none">
                <line
                  x1={chart.xs[hoverIdx]}
                  x2={chart.xs[hoverIdx]}
                  y1={PAD.top}
                  y2={VBH - PAD.bottom}
                  stroke="var(--text-secondary)"
                  strokeWidth={1}
                  strokeDasharray="3 3"
                />
                <circle cx={chart.xs[hoverIdx]} cy={chart.y(hover.dem)} r={3.5} fill={DEM} stroke="var(--surface-1)" strokeWidth={1.5} />
                <circle cx={chart.xs[hoverIdx]} cy={chart.y(hover.rep)} r={3.5} fill={REP} stroke="var(--surface-1)" strokeWidth={1.5} />
              </g>
            )}
          </svg>

          {hover && (
            <div
              className="gbtip"
              style={{
                left: `${tipLeftPct}%`,
                transform: tipFlip ? "translateX(calc(-100% - 10px))" : "translateX(10px)",
              }}
            >
              <div className="t1">{fmtDateLong(hover.date)}</div>
              <div className="t2">
                <span style={{ color: DEM, fontWeight: 600 }}>{hover.dem.toFixed(1)}%</span> Dem
                {" · "}
                <span style={{ color: REP, fontWeight: 600 }}>{hover.rep.toFixed(1)}%</span> Rep
              </div>
              <div className="t3">
                {fmtMargin(hover.margin)} · {hover.polls_in_window} poll{hover.polls_in_window === 1 ? "" : "s"} in window
              </div>
            </div>
          )}
        </div>
      )}

      <div className="gblegend" aria-hidden="true">
        <span><i style={{ background: DEM }} /> Democrats</span>
        <span><i style={{ background: REP }} /> Republicans</span>
      </div>

      <style>{`
        .gbchartwrap { position:relative; margin-top:8px; }
        .gbchart { width:100%; height:auto; display:block; }
        .gbtick { font-size:11px; fill:var(--text-secondary); font-family:inherit; }
        .gbtip { position:absolute; top:10px; z-index:10; background:var(--surface-1); border:1px solid var(--line);
          border-radius:8px; padding:8px 10px; font-size:.82rem; line-height:1.45;
          box-shadow:0 4px 14px rgba(0,0,0,.10); pointer-events:none; white-space:nowrap; }
        .gbtip .t1 { font-weight:600; }
        .gbtip .t3 { color:var(--text-secondary); }
        .gblegend { display:flex; flex-wrap:wrap; gap:6px 14px; margin-top:10px;
          font-size:.76rem; color:var(--text-secondary); }
        .gblegend i { display:inline-block; width:12px; height:12px; border-radius:3px;
          vertical-align:-1px; margin-right:5px; }
      `}</style>
    </div>
  );
}
