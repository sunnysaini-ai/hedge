export const metadata = {
  title: "About",
  description: "What Hedge is, the rule it won't break, and where its data comes from.",
};

export default function AboutPage() {
  return (
    <main className="wrap">
      <a className="back" href="/">← Hedge</a>

      <header>
        <h1>About</h1>
        <p className="lede">
          Hedge publishes one thing: US polling averages — race-level Senate and Governor
          numbers, approval ratings, and the generic congressional ballot — free to read, open
          to inspect, and auditable against the polls behind every figure.
        </p>
      </header>

      <section className="card">
        <h2>No forecasts</h2>
        <p>
          Hedge doesn&apos;t publish forecasts, seat projections, or win probabilities, and it
          won&apos;t: an average is a statement about polls that already happened, so anyone can
          recompute it from the same inputs, while a forecast bakes in modeling assumptions a
          reader has no way to check.
        </p>
      </section>

      <section className="card">
        <h2>Data &amp; licenses</h2>
        <p>
          Everything comes from two upstream sources, both licensed CC BY 4.0: the VoteHub poll
          feed, and an archived FiveThirtyEight/ABC News pollster-ratings dataset. Hedge doesn&apos;t
          conduct polls or rate pollsters itself — it fetches, stores, and averages what these two
          sources publish.
        </p>
      </section>

      <section className="card">
        <h2>How it runs</h2>
        <p>
          A scheduled pipeline refetches both sources and recomputes every average from scratch
          every 6 hours; the site itself rebuilds against that data roughly once an hour. Nothing
          is computed on the fly for a visitor, which is also why Hedge costs almost nothing to
          run — that&apos;s a design choice, not an accident.
        </p>
        <p className="note">
          For the exact formulas behind every number, see <a href="/methodology">Methodology</a>.
        </p>
      </section>

      <style>{`
        :root { --surface-0:#f6f5f2; --surface-1:#fcfcfb; --line:#e3e1db;
          --text-primary:#0b0b0b; --text-secondary:#52514e;
          --dem:#2a78d6; --rep:#e34948;
          --approve:#1baf7a; --disapprove:#e0793c; }
        body { background:var(--surface-0); color:var(--text-primary);
          font-family:ui-sans-serif,-apple-system,"Segoe UI",Roboto,sans-serif; }
        .wrap { max-width:760px; margin:0 auto; padding:40px 20px 80px; }
        .back { color:var(--text-secondary); text-decoration:none; font-size:.9rem; }
        .back:hover { text-decoration:underline; }
        header { margin:22px 0 8px; }
        h1 { font-size:2rem; font-weight:650; margin:10px 0 10px; }
        h2 { font-size:1.15rem; font-weight:650; margin:0 0 12px; }
        .lede { color:var(--text-secondary); font-size:1.02rem; line-height:1.55; max-width:62ch; }
        .card { background:var(--surface-1); border:1px solid var(--line); border-radius:12px; padding:22px 24px; margin-top:20px; }
        .card p { line-height:1.6; margin:0 0 12px; }
        .card p:last-child { margin-bottom:0; }
        .card a { color:var(--text-primary); text-decoration:underline; text-underline-offset:2px; }
        .note { color:var(--text-secondary); font-size:.9rem; }
      `}</style>
    </main>
  );
}
