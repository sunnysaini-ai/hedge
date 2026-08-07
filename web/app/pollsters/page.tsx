import Link from "next/link";
import { supabase } from "../../lib/supabase";
import PollsterTable from "./PollsterTable";
import type { PollsterRow } from "./PollsterTable";

export const revalidate = 3600;

export const metadata = {
  title: "Pollster registry",
  description:
    "Every pollster tracked by Hedge, with archived FiveThirtyEight/ABC News ratings (CC BY 4.0).",
};

// Single literal (not concatenated) so supabase-js can parse the column list
// at the type level instead of degrading to GenericStringError.
const SELECT =
  "id,display_name,aliases,fte_numeric_grade,fte_pollscore,fte_transparency,fte_aapor_roper,fte_pct_partisan_work,fte_polls_analyzed";

// 187 rows total — well under PostgREST's 1,000-row response cap, so a single
// unranged query returns everything. Secondary order keeps the unrated
// (null polls_analyzed) tail deterministic.
async function getPollsters(): Promise<PollsterRow[]> {
  const { data } = await supabase
    .from("pollsters")
    .select(SELECT)
    .order("fte_polls_analyzed", { ascending: false, nullsFirst: false })
    .order("display_name");
  return (data ?? []) as PollsterRow[];
}

export default async function PollstersPage() {
  const rows = await getPollsters();
  const rated = rows.filter(
    (r) =>
      r.fte_pollscore != null ||
      r.fte_numeric_grade != null ||
      r.fte_polls_analyzed != null
  ).length;

  return (
    <main className="wrap">
      <header>
        <p className="back">
          <Link href="/">← Hedge</Link>
        </p>
        <h1>Pollster registry</h1>
        <p className="note">
          {rows.length} pollsters tracked · {rated} with ratings · Ratings:
          FiveThirtyEight/ABC News, archived 2024, CC BY 4.0 — no longer updated
          upstream.
        </p>
      </header>

      <div className="card">
        <PollsterTable rows={rows} />
      </div>

      <style>{`
        :root { --surface-0:#f6f5f2; --surface-1:#fcfcfb; --line:#e3e1db;
          --text-primary:#0b0b0b; --text-secondary:#52514e;
          --dem:#2a78d6; --rep:#e34948;
          --approve:#1baf7a; --disapprove:#e0793c; }
        body { background:var(--surface-0); color:var(--text-primary);
          font-family:ui-sans-serif,-apple-system,"Segoe UI",Roboto,sans-serif; }
        .wrap { max-width:900px; margin:0 auto; padding:40px 20px; }
        .card { background:var(--surface-1); border:1px solid var(--line); border-radius:12px; padding:20px; margin-top:20px; }
        table { width:100%; border-collapse:collapse; font-size:.86rem; }
        th, td { text-align:left; padding:6px 8px; border-bottom:1px solid var(--line); }
        .n { text-align:right; }
        .note { color:var(--text-secondary); }
        .back { margin:0 0 10px; font-size:.9rem; }
        .back a { color:var(--text-secondary); text-decoration:none; }
        .back a:hover { color:var(--text-primary); text-decoration:underline; }
        header h1 { margin:0 0 6px; }
        header .note { margin:0; font-size:.9rem; }
      `}</style>
    </main>
  );
}
