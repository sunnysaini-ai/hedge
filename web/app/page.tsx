import { supabase } from "../lib/supabase";
import type { ApprovalDay, GenericBallotDay, RaceAverage } from "../lib/supabase";
import StateMap from "./StateMap";
import KeyRaces from "./KeyRaces";
import ApprovalTracker from "./ApprovalTracker";
import GenericBallotChart from "./GenericBallotChart";

export const revalidate = 3600; // static-ish; ETL runs on its own schedule, page rebuilds hourly

// All subjects at once from the precomputed daily-averages table (never the
// raw polls). ~5.8K small rows, but PostgREST caps each response at 1,000
// rows, so page through with .range(). Secondary sort on subject keeps the
// pagination deterministic (multiple subjects share each date).
async function getApproval(): Promise<ApprovalDay[]> {
  const PAGE = 1000;
  const rows: ApprovalDay[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data } = await supabase
      .from("approval_averages")
      .select("subject,date,approve_pct,disapprove_pct,net,polls_in_window")
      .order("date")
      .order("subject")
      .range(from, from + PAGE - 1);
    const page = (data ?? []) as ApprovalDay[];
    rows.push(...page);
    if (page.length < PAGE) break;
  }
  return rows;
}

async function getData() {
  const [
    { data: series },
    { data: pollsters },
    { count: pollCount },
    { count: pollsterCount },
    { data: races },
    approvalRows,
  ] = await Promise.all([
    supabase.from("generic_ballot_average").select("*").order("date"),
    supabase.from("pollsters").select("*").not("fte_numeric_grade", "is", null)
      .order("fte_polls_analyzed", { ascending: false }).limit(15),
    supabase.from("polls").select("*", { count: "exact", head: true }),
    supabase.from("pollsters").select("*", { count: "exact", head: true }),
    // One query for both offices; the map component splits/toggles in memory.
    supabase.from("race_averages").select("*").eq("cycle", 2026).order("state"),
    getApproval(),
  ]);
  const all = (races ?? []) as RaceAverage[];
  const approval: Record<string, ApprovalDay[]> = {};
  for (const row of approvalRows) (approval[row.subject] ??= []).push(row);
  return {
    series: (series ?? []) as GenericBallotDay[],
    pollsters: pollsters ?? [],
    pollCount,
    pollsterCount,
    senate: all.filter((r) => r.office === "senate"),
    governor: all.filter((r) => r.office === "governor"),
    approval,
  };
}

export default async function Page() {
  const { series, pollsters, pollCount, pollsterCount, senate, governor, approval } = await getData();

  return (
    <main className="wrap">
      <header>
        <h1>Hedge</h1>
        <p>A free, open, auditable database of US political polls — served from Supabase,
           deployed on Vercel, built on CC BY 4.0 sources.</p>
      </header>

      <StateMap senate={senate} governor={governor} />

      <KeyRaces senate={senate} governor={governor} />

      <ApprovalTracker series={approval} />

      <div className="tiles">
        <div className="tile"><div className="k">Polls</div><div className="v">{pollCount?.toLocaleString()}</div></div>
        <div className="tile"><div className="k">Pollsters</div><div className="v">{pollsterCount}</div></div>
        <div className="tile"><div className="k">Cost to run</div><div className="v">$0–25/mo</div></div>
      </div>

      <GenericBallotChart series={series} />

      <div className="card">
        <h2>Pollster registry (rated)</h2>
        <table>
          <thead><tr><th>Pollster</th><th className="n">Grade</th><th className="n">POLLSCORE</th></tr></thead>
          <tbody>
            {pollsters.map((p: any) => (
              <tr key={p.id}><td>{p.display_name}</td><td className="n">{p.fte_numeric_grade}</td>
                <td className="n">{p.fte_pollscore}</td></tr>
            ))}
          </tbody>
        </table>
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
        .tiles { display:grid; grid-template-columns:repeat(auto-fit,minmax(140px,1fr)); gap:12px; margin-top:20px; }
        .tile { background:var(--surface-1); border:1px solid var(--line); border-radius:12px; padding:14px 16px; }
        .k { font-size:.72rem; text-transform:uppercase; color:var(--text-secondary); }
        .v { font-size:1.5rem; font-weight:600; }
        .hero { font-size:2.4rem; font-weight:650; }
        table { width:100%; border-collapse:collapse; font-size:.86rem; }
        th, td { text-align:left; padding:6px 8px; border-bottom:1px solid var(--line); }
        .n { text-align:right; }
        .note { color:var(--text-secondary); }
      `}</style>
    </main>
  );
}
