"use client";

import { useMemo, useState } from "react";
import type { ApprovalDay } from "../lib/supabase";

// Approval is not a partisan metric, so these deliberately avoid --dem/--rep.
// APPROVE matches the "good" severity green already used in this project's
// dataviz (see build_site.py SEV colors); NET_BAD matches its "serious" red.
const APPROVE = "#1baf7a";
const DISAPPROVE = "#e0793c";
const NET_GOOD = "#1baf7a";
const NET_BAD = "#e34948";

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

// Preferred picker order; any unexpected subject in the data is appended after.
const SUBJECT_ORDER = ["Donald Trump", "Congress", "Supreme Court", "JD Vance"];

// ---- chart geometry (viewBox units) ----
const VBW = 760;
const VBH = 280;
const PAD = { top: 12, right: 14, bottom: 26, left: 40 };
const PLOT_W = VBW - PAD.left - PAD.right;
const PLOT_H = VBH - PAD.top - PAD.bottom;

type XTick = { x: number; label: string };

export default function ApprovalTracker({
  series,
}: {
  series: Record<string, ApprovalDay[]>;
}) {
  const subjects = useMemo(() => {
    const present = Object.keys(series).filter((s) => (series[s] ?? []).length > 0);
    const ordered = SUBJECT_ORDER.filter((s) => present.includes(s));
    for (const s of present) if (!ordered.includes(s)) ordered.push(s);
    return ordered;
  }, [series]);

  const [subject, setSubject] = useState<string>(
    subjects.includes("Donald Trump") ? "Donald Trump" : subjects[0] ?? ""
  );
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const active = subjects.includes(subject) ? subject : subjects[0];
  const days = active ? series[active] ?? [] : [];

  // Scales, ticks and per-point pixel positions for the selected subject.
  const chart = useMemo(() => {
    if (days.length < 2) return null;
    const times = days.map((d) => ts(d.date));
    const t0 = times[0];
    const t1 = times[times.length - 1];
    const tSpan = Math.max(1, t1 - t0);

    let lo = Infinity;
    let hi = -Infinity;
    for (const d of days) {
      lo = Math.min(lo, d.approve_pct, d.disapprove_pct);
      hi = Math.max(hi, d.approve_pct, d.disapprove_pct);
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

    // X ticks: month boundaries, thinned so we never exceed ~8 labels.
    // The interval adapts to the span, so a 500-day series gets quarterly
    // labels while the 2,787-day Congress series gets yearly ones.
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

    const path = (get: (d: ApprovalDay) => number) =>
      days.map((d, i) => `${i === 0 ? "M" : "L"}${xs[i].toFixed(1)},${y(get(d)).toFixed(1)}`).join("");

    // Dot markers: thin them so neighbors stay ~5+ viewBox units apart.
    // A 526-day series draws roughly every 4th day; the 2,787-day Congress
    // series roughly every 20th — the line stays the primary mark either way.
    const pxPerPoint = PLOT_W / days.length;
    const dotStride = Math.max(1, Math.ceil(5 / pxPerPoint));
    const dotR = pxPerPoint >= 6 ? 2 : 1.4;

    return { times, xs, y, yTicks, xTicks, path, dotStride, dotR };
  }, [days]);

  if (!subjects.length) return null;
  const last = days[days.length - 1];
  const hover = hoverIdx != null && chart ? days[hoverIdx] : null;

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

  const netColor = (n: number) => (n >= 0 ? NET_GOOD : NET_BAD);
  const fmtNet = (n: number) => `${n >= 0 ? "+" : "−"}${Math.abs(n).toFixed(1)}`;

  // Tooltip flips to the left half of the chart when hovering the right half.
  const tipLeftPct = hover && chart ? (chart.xs[hoverIdx!] / VBW) * 100 : 0;
  const tipFlip = tipLeftPct > 55;

  return (
    <div className="card atcard">
      <div className="athead">
        <h2>Approval tracker</h2>
        <div className="atseg" role="group" aria-label="Approval subject">
          {subjects.map((s) => (
            <button
              key={s}
              type="button"
              aria-pressed={active === s}
              className={active === s ? "on" : ""}
              onClick={() => {
                setSubject(s);
                setHoverIdx(null);
              }}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      {last && (
        <>
          <div className="hero" style={{ color: netColor(last.net) }}>
            Net {fmtNet(last.net)}
          </div>
          <p className="note">
            <span style={{ color: APPROVE, fontWeight: 600 }}>{last.approve_pct.toFixed(1)}% approve</span>
            {" · "}
            <span style={{ color: DISAPPROVE, fontWeight: 600 }}>{last.disapprove_pct.toFixed(1)}% disapprove</span>
            {" · as of "}
            {fmtDateLong(last.date)} · {last.polls_in_window} polls in window
          </p>
        </>
      )}

      {chart && (
        <div className="atchartwrap">
          <svg
            viewBox={`0 0 ${VBW} ${VBH}`}
            className="atchart"
            role="img"
            aria-label={`${active} approval and disapproval over time`}
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
                <text x={PAD.left - 8} y={chart.y(v) + 3.5} textAnchor="end" className="attick">
                  {v}%
                </text>
              </g>
            ))}
            {/* x labels */}
            {chart.xTicks.map((t) => (
              <text key={t.label + t.x} x={t.x} y={VBH - 8} textAnchor="middle" className="attick">
                {t.label}
              </text>
            ))}

            {/* series lines */}
            <path d={chart.path((d) => d.disapprove_pct)} fill="none" stroke={DISAPPROVE} strokeWidth={1.8} strokeLinejoin="round" />
            <path d={chart.path((d) => d.approve_pct)} fill="none" stroke={APPROVE} strokeWidth={1.8} strokeLinejoin="round" />

            {/* sparse dot markers (thinned by stride so long series stay clean) */}
            {days.map((d, i) =>
              i % chart.dotStride === 0 ? (
                <g key={d.date}>
                  <circle cx={chart.xs[i]} cy={chart.y(d.approve_pct)} r={chart.dotR} fill={APPROVE} fillOpacity={0.45} />
                  <circle cx={chart.xs[i]} cy={chart.y(d.disapprove_pct)} r={chart.dotR} fill={DISAPPROVE} fillOpacity={0.45} />
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
                <circle cx={chart.xs[hoverIdx]} cy={chart.y(hover.approve_pct)} r={3.5} fill={APPROVE} stroke="var(--surface-1)" strokeWidth={1.5} />
                <circle cx={chart.xs[hoverIdx]} cy={chart.y(hover.disapprove_pct)} r={3.5} fill={DISAPPROVE} stroke="var(--surface-1)" strokeWidth={1.5} />
              </g>
            )}
          </svg>

          {hover && (
            <div
              className="attip"
              style={{
                left: `${tipLeftPct}%`,
                transform: tipFlip ? "translateX(calc(-100% - 10px))" : "translateX(10px)",
              }}
            >
              <div className="t1">{fmtDateLong(hover.date)}</div>
              <div className="t2">
                <span style={{ color: APPROVE, fontWeight: 600 }}>{hover.approve_pct.toFixed(1)}%</span> approve
                {" · "}
                <span style={{ color: DISAPPROVE, fontWeight: 600 }}>{hover.disapprove_pct.toFixed(1)}%</span> disapprove
              </div>
              <div className="t3">
                Net {fmtNet(hover.net)} · {hover.polls_in_window} poll{hover.polls_in_window === 1 ? "" : "s"} in window
              </div>
            </div>
          )}
        </div>
      )}

      <div className="atlegend" aria-hidden="true">
        <span><i style={{ background: APPROVE }} /> Approve</span>
        <span><i style={{ background: DISAPPROVE }} /> Disapprove</span>
      </div>

      <style>{`
        .athead { display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap; }
        .athead h2 { margin:0; }
        .atseg { display:inline-flex; border:1px solid var(--line); border-radius:8px; overflow:hidden; background:var(--surface-0); }
        .atseg button { appearance:none; border:0; background:transparent; padding:6px 12px; font:inherit;
          font-size:.82rem; color:var(--text-secondary); cursor:pointer; white-space:nowrap; }
        .atseg button + button { border-left:1px solid var(--line); }
        .atseg button.on { background:var(--surface-1); color:var(--text-primary); font-weight:600; }
        .atcard .hero { margin-top:10px; }
        .atchartwrap { position:relative; margin-top:8px; }
        .atchart { width:100%; height:auto; display:block; }
        .attick { font-size:11px; fill:var(--text-secondary); font-family:inherit; }
        .attip { position:absolute; top:10px; z-index:10; background:var(--surface-1); border:1px solid var(--line);
          border-radius:8px; padding:8px 10px; font-size:.82rem; line-height:1.45;
          box-shadow:0 4px 14px rgba(0,0,0,.10); pointer-events:none; white-space:nowrap; }
        .attip .t1 { font-weight:600; }
        .attip .t3 { color:var(--text-secondary); }
        .atlegend { display:flex; flex-wrap:wrap; gap:6px 14px; margin-top:10px;
          font-size:.76rem; color:var(--text-secondary); }
        .atlegend i { display:inline-block; width:12px; height:12px; border-radius:3px;
          vertical-align:-1px; margin-right:5px; }
      `}</style>
    </div>
  );
}
