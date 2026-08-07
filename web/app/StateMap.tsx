"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { MAP_VIEWBOX, STATE_PATHS } from "../lib/usmap.gen";
import type { RaceAverage } from "../lib/supabase";
import { formatGrade } from "./grades";

// ---- color math (precomputed hex — no runtime CSS color-mix dependency) ----

const DEM = "#2a78d6";
const REP = "#e34948";
const LOW_DATA = "#d8d6d0";
const NO_RACE = "#efeeea";

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function rgbToHex(r: number, g: number, b: number) {
  return "#" + [r, g, b].map((c) => Math.round(c).toString(16).padStart(2, "0")).join("");
}
/** Mix `hex` toward white by fraction t (0..1). */
function towardWhite(hex: string, t: number) {
  const [r, g, b] = hexToRgb(hex);
  return rgbToHex(r + (255 - r) * t, g + (255 - g) * t, b + (255 - b) * t);
}
/** Darken `hex` by fraction t (0..1) for hover outlines. */
function towardBlack(hex: string, t: number) {
  const [r, g, b] = hexToRgb(hex);
  return rgbToHex(r * (1 - t), g * (1 - t), b * (1 - t));
}

const STRONG_D = DEM;
const LEAN_D = towardWhite(DEM, 0.55);
const TILT_D = towardWhite(DEM, 0.78);
const STRONG_R = REP;
const LEAN_R = towardWhite(REP, 0.55);
const TILT_R = towardWhite(REP, 0.78);

function fillFor(row: RaceAverage | undefined): string {
  if (!row) return NO_RACE;
  if (row.low_data) return LOW_DATA;
  const m = row.margin;
  const base = m >= 0 ? DEM : REP;
  const a = Math.abs(m);
  if (a >= 10) return base;
  if (a >= 3) return towardWhite(base, 0.55);
  return towardWhite(base, 0.78);
}

// ---- formatting helpers ----

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const [, m, d] = iso.split("-").map(Number);
  return `${MONTHS[(m ?? 1) - 1]} ${d}`;
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

type Office = "senate" | "governor";
const OFFICE_LABEL: Record<Office, string> = { senate: "Senate", governor: "Governor" };

type Hover = { code: string; x: number; y: number };

export default function StateMap({
  senate,
  governor,
}: {
  senate: RaceAverage[];
  governor: RaceAverage[];
}) {
  const [office, setOffice] = useState<Office>("senate");
  const [hover, setHover] = useState<Hover | null>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const [tipSize, setTipSize] = useState<[number, number]>([260, 80]);

  useLayoutEffect(() => {
    if (hover && tipRef.current) {
      const r = tipRef.current.getBoundingClientRect();
      if (Math.abs(r.width - tipSize[0]) > 1 || Math.abs(r.height - tipSize[1]) > 1) {
        setTipSize([r.width, r.height]);
      }
    }
  }, [hover, tipSize]);

  const rows = office === "senate" ? senate : governor;
  const byState = new Map<string, RaceAverage>(rows.map((r) => [r.state, r]));
  const dLeads = rows.filter((r) => r.leader_party === "D").length;
  const rLeads = rows.filter((r) => r.leader_party === "R").length;

  const codes = Object.keys(STATE_PATHS);
  const hoverRow = hover ? byState.get(hover.code) : undefined;
  const hoverName = hover ? STATE_PATHS[hover.code].name : "";

  // Keep the tooltip inside the viewport.
  let tipStyle: React.CSSProperties = { display: "none" };
  if (hover && typeof window !== "undefined") {
    const [w, h] = tipSize;
    const pad = 8;
    let left = hover.x + 14;
    let top = hover.y + 16;
    if (left + w + pad > window.innerWidth) left = hover.x - w - 14;
    if (top + h + pad > window.innerHeight) top = hover.y - h - 16;
    left = Math.max(pad, left);
    top = Math.max(pad, top);
    tipStyle = { position: "fixed", left, top, display: "block" };
  }

  const move = (code: string) => (e: React.MouseEvent) =>
    setHover({ code, x: e.clientX, y: e.clientY });

  return (
    <div className="card mapcard">
      <div className="maphead">
        <h2>2026 election polling averages</h2>
        <div className="seg" role="group" aria-label="Race type">
          {(["senate", "governor"] as Office[]).map((o) => (
            <button
              key={o}
              type="button"
              aria-pressed={office === o}
              className={office === o ? "on" : ""}
              onClick={() => setOffice(o)}
            >
              {OFFICE_LABEL[o]}
            </button>
          ))}
        </div>
      </div>

      <p className="mapsummary">
        {rows.length} races polled · D leads {dLeads} · R leads {rLeads}
      </p>
      <p className="maphint">Click a state for the full race page.</p>

      <svg viewBox={MAP_VIEWBOX} className="usmap" role="img"
           aria-label={`Map of 2026 ${OFFICE_LABEL[office]} polling averages by state`}
           onMouseLeave={() => setHover(null)}>
        {codes.map((code) => {
          const row = byState.get(code);
          const shape = (
            <path
              key={code}
              d={STATE_PATHS[code].d}
              fill={fillFor(row)}
              stroke="#fff"
              strokeWidth={0.75}
              onMouseMove={move(code)}
              onMouseEnter={move(code)}
            >
              <title>
                {row
                  ? `${STATE_PATHS[code].name} — ${OFFICE_LABEL[office]}: ${fmtMargin(row.margin)}${row.low_data ? " (limited polling)" : ""}`
                  : `${STATE_PATHS[code].name} — no ${OFFICE_LABEL[office]} race`}
              </title>
            </path>
          );
          // States with a race link to their detail page via an SVG <a>, which
          // keeps native <title> tooltips, the custom hover card, and keyboard
          // activation (focusable + Enter) without extra handlers. States
          // without a race stay plain, non-clickable paths.
          return row ? (
            <a
              key={code}
              href={`/race/${code.toLowerCase()}/${office}`}
              aria-label={`${STATE_PATHS[code].name} ${OFFICE_LABEL[office]} race page`}
            >
              {shape}
            </a>
          ) : (
            shape
          );
        })}
        {/* Re-draw hovered state on top so its outline isn't hidden by neighbors */}
        {hover && (
          <path
            d={STATE_PATHS[hover.code].d}
            fill={fillFor(hoverRow)}
            stroke={towardBlack(fillFor(hoverRow), 0.4)}
            strokeWidth={1.5}
            pointerEvents="none"
          />
        )}
      </svg>

      <div className="legend" aria-hidden="true">
        <span><i style={{ background: STRONG_D }} /> Strong D</span>
        <span><i style={{ background: LEAN_D }} /> Lean D</span>
        <span><i style={{ background: `linear-gradient(90deg, ${TILT_D} 50%, ${TILT_R} 50%)` }} /> Tossup</span>
        <span><i style={{ background: LEAN_R }} /> Lean R</span>
        <span><i style={{ background: STRONG_R }} /> Strong R</span>
        <span><i style={{ background: LOW_DATA }} /> Limited polling</span>
        <span><i style={{ background: NO_RACE, boxShadow: "inset 0 0 0 1px var(--line)" }} /> No race</span>
      </div>

      {hover && (
        <div className="maptip" ref={tipRef} style={tipStyle}>
          <div className="t1">{hoverName} — {OFFICE_LABEL[office]}</div>
          {hoverRow ? (
            <>
              <div className="t2">
                {hoverRow.margin >= 0 ? (
                  <>{surname(hoverRow.dem_candidate)} (D) {hoverRow.dem_pct.toFixed(1)} vs {surname(hoverRow.rep_candidate)} (R) {hoverRow.rep_pct.toFixed(1)}</>
                ) : (
                  <>{surname(hoverRow.rep_candidate)} (R) {hoverRow.rep_pct.toFixed(1)} vs {surname(hoverRow.dem_candidate)} (D) {hoverRow.dem_pct.toFixed(1)}</>
                )}
              </div>
              {hoverRow.low_data ? (
                <div className="t3 lim">
                  Limited polling ({hoverRow.polls_used} poll{hoverRow.polls_used === 1 ? "" : "s"}) · latest {fmtDate(hoverRow.latest_poll)}
                  {hoverRow.matchup_source === "nominees" && <> · nominees ✓</>}
                </div>
              ) : (
                <div className="t3">
                  {fmtMargin(hoverRow.margin)} · {hoverRow.polls_used} polls · latest {fmtDate(hoverRow.latest_poll)}
                  {hoverRow.matchup_source === "nominees" && <> · nominees ✓</>}
                </div>
              )}
              {hoverRow.avg_grade != null && (
                <div className="t3">Avg pollster grade: {formatGrade(hoverRow.avg_grade)}</div>
              )}
            </>
          ) : (
            <div className="t3">No 2026 {OFFICE_LABEL[office]} race polled</div>
          )}
        </div>
      )}

      <style>{`
        .mapcard { overflow: visible; }
        .maphead { display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap; }
        .maphead h2 { margin:0; }
        .seg { display:inline-flex; border:1px solid var(--line); border-radius:8px; overflow:hidden; background:var(--surface-0); }
        .seg button { appearance:none; border:0; background:transparent; padding:6px 14px; font:inherit;
          font-size:.84rem; color:var(--text-secondary); cursor:pointer; }
        .seg button + button { border-left:1px solid var(--line); }
        .seg button.on { background:var(--surface-1); color:var(--text-primary); font-weight:600; }
        .mapsummary { color:var(--text-secondary); font-size:.86rem; margin:8px 0 0; }
        .maphint { color:var(--text-secondary); font-size:.78rem; margin:2px 0 4px; }
        .usmap { width:100%; height:auto; display:block; }
        .usmap path { transition: fill .15s ease; cursor:default; }
        .usmap a { cursor:pointer; }
        .usmap a path { cursor:pointer; }
        .usmap a:focus-visible path { stroke:var(--text-primary); stroke-width:1.5; }
        .usmap a:focus:not(:focus-visible) { outline:none; }
        .legend { display:flex; flex-wrap:wrap; gap:6px 14px; margin-top:10px;
          font-size:.76rem; color:var(--text-secondary); }
        .legend i { display:inline-block; width:12px; height:12px; border-radius:3px;
          vertical-align:-1px; margin-right:5px; }
        .maptip { z-index:10; background:var(--surface-1); border:1px solid var(--line);
          border-radius:8px; padding:8px 10px; font-size:.82rem; line-height:1.45;
          box-shadow:0 4px 14px rgba(0,0,0,.10); pointer-events:none; max-width:280px; }
        .maptip .t1 { font-weight:600; }
        .maptip .t3 { color:var(--text-secondary); }
        .maptip .t3.lim { color:var(--text-secondary); font-style:italic; }
      `}</style>
    </div>
  );
}
