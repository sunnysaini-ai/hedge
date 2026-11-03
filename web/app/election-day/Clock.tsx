"use client";

import { useEffect, useState } from "react";

// The only client-side code on the election night page: a ticking clock, a
// countdown to the next poll closing, and per-wave open/closed badges. All of
// it renders a neutral placeholder until mounted, so the server HTML never
// disagrees with the browser about what time it is.

function useNow(intervalMs = 1000): number | null {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

function fmtClock(ms: number, timeZone: string) {
  return new Date(ms).toLocaleTimeString("en-US", { timeZone, hour: "numeric", minute: "2-digit" });
}

function fmtCountdown(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(sec).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${m}:${ss}`;
}

export type ClosingEvent = { utc: string; et: string; pt: string; label: string };

export function NightClock({ events, totalStates }: { events: ClosingEvent[]; totalStates: number; }) {
  const now = useNow();
  const sorted = [...events].sort((a, b) => Date.parse(a.utc) - Date.parse(b.utc));
  const next = now == null ? null : sorted.find((e) => Date.parse(e.utc) > now) ?? null;
  const allDone = now != null && next == null;

  return (
    <div className="nc">
      <div className="nc-row">
        <div className="nc-cell">
          <div className="nc-k">Now</div>
          <div className="nc-v">
            {now == null ? "—" : `${fmtClock(now, "America/New_York")} ET`}
            <span className="nc-sub">{now == null ? "" : ` · ${fmtClock(now, "America/Los_Angeles")} PT`}</span>
          </div>
        </div>
        <div className="nc-cell">
          <div className="nc-k">{allDone ? "Polls" : "Next closing"}</div>
          <div className="nc-v">
            {now == null ? "—" : allDone ? "All closed" : next ? `${next.et} ET` : "—"}
            {next && <span className="nc-sub"> · {next.pt} PT</span>}
          </div>
          {next && <div className="nc-label">{next.label}</div>}
        </div>
        <div className="nc-cell">
          <div className="nc-k">{allDone ? "Count" : "In"}</div>
          <div className="nc-v nc-mono">
            {now == null ? "—" : allDone ? "Underway" : next ? fmtCountdown(Date.parse(next.utc) - now) : "—"}
          </div>
          {now != null && (
            <div className="nc-label">
              {allDone
                ? `All ${totalStates} jurisdictions closed`
                : "Anyone in line at closing can still vote"}
            </div>
          )}
        </div>
      </div>
      <style>{`
        .nc { background:var(--surface-1); border:1px solid var(--line); border-radius:12px;
          padding:16px 18px; margin-top:18px; }
        .nc-row { display:grid; grid-template-columns:repeat(auto-fit,minmax(190px,1fr)); gap:14px; }
        .nc-k { font-size:.72rem; text-transform:uppercase; letter-spacing:.04em; color:var(--text-secondary); }
        .nc-v { font-size:1.35rem; font-weight:650; margin-top:2px; }
        .nc-sub { font-size:.9rem; font-weight:500; color:var(--text-secondary); }
        .nc-mono { font-variant-numeric:tabular-nums; }
        .nc-label { font-size:.8rem; color:var(--text-secondary); margin-top:3px; }
      `}</style>
    </div>
  );
}

export function WaveStatus({ utc }: { utc: string }) {
  const now = useNow(15000);
  if (now == null) return <span className="ws ws-pending">&nbsp;</span>;
  const t = Date.parse(utc);
  const closed = now >= t;
  const soon = !closed && t - now <= 30 * 60 * 1000;
  return (
    <span className={`ws ${closed ? "ws-closed" : soon ? "ws-soon" : "ws-open"}`}>
      {closed ? "Polls closed" : soon ? `Closing in ${Math.max(1, Math.ceil((t - now) / 60000))} min` : "Polls open"}
      <style>{`
        .ws { font-size:.7rem; font-weight:600; line-height:1.6; padding:1px 9px; border-radius:999px;
          white-space:nowrap; display:inline-block; min-width:5em; text-align:center; }
        .ws-pending { background:transparent; }
        .ws-open { background:#e9efe9; color:#2f5e3a; }
        .ws-soon { background:#fbecd9; color:#8a4b12; }
        .ws-closed { background:#e8e7e3; color:#3d3c39; }
      `}</style>
    </span>
  );
}
