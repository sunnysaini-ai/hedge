"use client";

import { useMemo, useState } from "react";
import type { Pollster } from "../../lib/supabase";

// The pollsters table carries more FTE rating columns than the shared
// Pollster type exposes; extend locally rather than touching lib/supabase.ts.
export type PollsterRow = Pollster & {
  fte_aapor_roper: boolean | null;
  fte_pct_partisan_work: number | null; // fraction 0–1 in the DB
  fte_polls_analyzed: number | null;
};

type SortKey =
  | "display_name"
  | "fte_numeric_grade"
  | "fte_pollscore"
  | "fte_transparency"
  | "fte_polls_analyzed"
  | "fte_pct_partisan_work"
  | "fte_aapor_roper";

type Dir = "asc" | "desc";

type Column = {
  key: SortKey;
  label: string;
  align?: "n" | "c"; // n = right (numeric), c = center; default left
  defaultDir: Dir; // first-click direction ("best/biggest first" per column)
  title?: string;
};

const COLUMNS: Column[] = [
  { key: "display_name", label: "Pollster", defaultDir: "asc" },
  {
    key: "fte_numeric_grade", label: "Grade", align: "n", defaultDir: "desc",
    title: "FiveThirtyEight/ABC News numeric grade — higher is better",
  },
  {
    key: "fte_pollscore", label: "POLLSCORE", align: "n", defaultDir: "asc",
    title: "POLLSCORE: lower is better — negative means more accurate than average",
  },
  {
    key: "fte_transparency", label: "Transparency", align: "n", defaultDir: "desc",
    title: "Methodological transparency score — higher is better",
  },
  { key: "fte_polls_analyzed", label: "Polls analyzed", align: "n", defaultDir: "desc" },
  {
    key: "fte_pct_partisan_work", label: "% partisan work", align: "n", defaultDir: "desc",
    title: "Share of a pollster's analyzed polls conducted for partisan clients",
  },
  {
    key: "fte_aapor_roper", label: "AAPOR/Roper", align: "c", defaultDir: "desc",
    title: "AAPOR Transparency Initiative member or Roper Center contributor",
  },
];

const byName = (a: PollsterRow, b: PollsterRow) =>
  a.display_name.localeCompare(b.display_name, "en", { sensitivity: "base" });

// Nulls sort last regardless of direction: unrated pollsters never float to
// the top just because the user flipped a ratings column to ascending.
function compareRows(a: PollsterRow, b: PollsterRow, key: SortKey, dir: Dir): number {
  const av = a[key];
  const bv = b[key];
  const aNull = av === null || av === undefined;
  const bNull = bv === null || bv === undefined;
  if (aNull && bNull) return byName(a, b);
  if (aNull) return 1;
  if (bNull) return -1;
  let base: number;
  if (typeof av === "string" && typeof bv === "string") {
    base = av.localeCompare(bv, "en", { sensitivity: "base" });
  } else if (typeof av === "boolean" && typeof bv === "boolean") {
    base = (av ? 1 : 0) - (bv ? 1 : 0);
  } else {
    base = (av as number) - (bv as number);
  }
  if (dir === "desc") base = -base;
  return base !== 0 ? base : byName(a, b);
}

// "—" (never 0) for unrated cells.
const fmt1 = (v: number | null) => (v == null ? "—" : v.toFixed(1));
const fmtInt = (v: number | null) => (v == null ? "—" : v.toLocaleString("en-US"));
const fmtPct = (v: number | null) => (v == null ? "—" : `${Math.round(v * 100)}%`);

export default function PollsterTable({ rows }: { rows: PollsterRow[] }) {
  const [sort, setSort] = useState<{ key: SortKey; dir: Dir }>({
    key: "fte_polls_analyzed",
    dir: "desc",
  });
  const [q, setQ] = useState("");

  const toggle = (c: Column) =>
    setSort((s) =>
      s.key === c.key
        ? { key: c.key, dir: s.dir === "asc" ? "desc" : "asc" }
        : { key: c.key, dir: c.defaultDir }
    );

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const filtered = needle
      ? rows.filter(
          (r) =>
            r.display_name.toLowerCase().includes(needle) ||
            (r.aliases ?? []).some((a) => a.toLowerCase().includes(needle))
        )
      : rows.slice();
    return filtered.sort((a, b) => compareRows(a, b, sort.key, sort.dir));
  }, [rows, q, sort]);

  return (
    <div>
      <div className="tbar">
        <input
          type="search"
          placeholder="Filter pollsters…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label="Filter pollsters by name or alias"
        />
      </div>
      <p className="note showing" aria-live="polite">
        Showing {shown.length} of {rows.length}
      </p>

      <div className="tscroll">
        <table className="ptable">
          <thead>
            <tr>
              {COLUMNS.map((c) => {
                const active = sort.key === c.key;
                return (
                  <th
                    key={c.key}
                    className={c.align}
                    aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : undefined}
                  >
                    <button type="button" onClick={() => toggle(c)} title={c.title}>
                      {c.label}
                      {active && (
                        <span className="arr" aria-hidden="true">
                          {sort.dir === "asc" ? "▲" : "▼"}
                        </span>
                      )}
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {shown.map((p) => {
              const aliases = p.aliases ?? [];
              const extra = aliases.length - 1;
              return (
                <tr key={p.id}>
                  <td>
                    {p.display_name}
                    {extra > 0 && (
                      <span className="morenames" title={aliases.join(", ")}>
                        +{extra} name{extra === 1 ? "" : "s"}
                      </span>
                    )}
                  </td>
                  <td className="n grade">{fmt1(p.fte_numeric_grade)}</td>
                  <td className="n">{fmt1(p.fte_pollscore)}</td>
                  <td className="n">{fmt1(p.fte_transparency)}</td>
                  <td className="n">{fmtInt(p.fte_polls_analyzed)}</td>
                  <td className="n">{fmtPct(p.fte_pct_partisan_work)}</td>
                  <td className="c">
                    {p.fte_aapor_roper == null ? "—" : p.fte_aapor_roper ? "✓" : ""}
                  </td>
                </tr>
              );
            })}
            {shown.length === 0 && (
              <tr>
                <td colSpan={COLUMNS.length} className="empty">
                  No pollsters match “{q.trim()}”
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <style>{`
        .tbar { display:flex; align-items:center; gap:12px; flex-wrap:wrap; }
        .tbar input { font:inherit; font-size:.86rem; padding:6px 10px; border:1px solid var(--line);
          border-radius:8px; background:var(--surface-0); color:var(--text-primary);
          width:min(280px,100%); }
        .tbar input:focus-visible { outline:2px solid var(--text-secondary); outline-offset:1px; }
        .showing { font-size:.8rem; margin:8px 0 4px; }
        .tscroll { overflow-x:auto; -webkit-overflow-scrolling:touch; }
        .ptable { min-width:680px; }
        .ptable th { padding:0; white-space:nowrap; }
        .ptable th button { display:block; width:100%; appearance:none; background:none; border:0;
          font:inherit; font-weight:600; color:var(--text-primary); padding:6px 8px;
          text-align:left; cursor:pointer; white-space:nowrap; }
        .ptable th.n button { text-align:right; }
        .ptable th.c button { text-align:center; }
        .ptable th button:hover { background:var(--surface-0); }
        .ptable th button:focus-visible { outline:2px solid var(--text-secondary); outline-offset:-2px; }
        .arr { font-size:.62rem; margin-left:4px; vertical-align:1px; }
        .ptable td.c { text-align:center; }
        .ptable td.grade { font-weight:600; }
        .ptable tbody tr:hover { background:var(--surface-0); }
        .morenames { color:var(--text-secondary); font-size:.74rem; margin-left:6px;
          white-space:nowrap; cursor:help; }
        .empty { color:var(--text-secondary); text-align:center; padding:18px 8px; }
      `}</style>
    </div>
  );
}
