import { supabase } from "../lib/supabase";

export const revalidate = 3600; // static-ish; ETL runs on its own schedule, page rebuilds hourly

async function getData() {
  const [{ data: series }, { data: pollsters }, { count: pollCount }, { count: pollsterCount }] =
    await Promise.all([
      supabase.from("generic_ballot_average").select("*").order("date"),
      supabase.from("pollsters").select("*").not("fte_numeric_grade", "is", null)
        .order("fte_polls_analyzed", { ascending: false }).limit(15),
      supabase.from("polls").select("*", { count: "exact", head: true }),
      supabase.from("pollsters").select("*", { count: "exact", head: true }),
    ]);
  return { series: series ?? [], pollsters: pollsters ?? [], pollCount, pollsterCount };
}

export default async function Page() {
  const { series, pollsters, pollCount, pollsterCount } = await getData();
  const last = series[series.length - 1];

  return (
    <main className="wrap">
      <header>
        <h1>Hedge</h1>
        <p>A free, open, auditable database of US political polls — served from Supabase,
           deployed on Vercel, built on CC BY 4.0 sources.</p>
      </header>

      <div className="tiles">
        <div className="tile"><div className="k">Polls</div><div className="v">{pollCount?.toLocaleString()}</div></div>
        <div className="tile"><div className="k">Pollsters</div><div className="v">{pollsterCount}</div></div>
        <div className="tile"><div className="k">Cost to run</div><div className="v">$0–25/mo</div></div>
      </div>

      {last && (
        <div className="card">
          <h2>Generic congressional ballot</h2>
          <div className="hero" style={{ color: "var(--dem)" }}>
            {last.margin > 0 ? "D" : "R"}+{Math.abs(last.margin)}
          </div>
          <p className="note">{last.dem}% Dem · {last.rep}% Rep · as of {last.date} · {last.polls_in_window} polls in window</p>
        </div>
      )}

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
          --text-primary:#0b0b0b; --text-secondary:#52514e; --dem:#2a78d6; }
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
