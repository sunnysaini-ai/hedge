export const metadata = {
  title: "Methodology",
  description: "How Hedge computes every polling average it publishes, straight from the code that runs it.",
};

export default function MethodologyPage() {
  return (
    <main className="wrap">
      <a className="back" href="/">← Hedge</a>

      <header>
        <h1>Methodology</h1>
        <p className="lede">
          Hedge publishes one thing: polling averages, computed by a fixed set of rules from public
          data. This page is that fixed set of rules — the same ones the code runs — so anyone can
          check any number on this site against its inputs.
        </p>
      </header>

      <section className="card">
        <h2>1. What Hedge is — and isn't</h2>
        <p>
          Hedge publishes polling averages. That's the whole product: take the polls that exist for a
          race, a subject's approval rating, or the generic congressional ballot, weight them by how
          recent and how large they are, and publish the result.
        </p>
        <p>
          Hedge does not publish forecasts, seat projections, or win probabilities — and it never
          will. An average is a statement about polls that already happened; you can pull the same
          polls and recompute it yourself. A forecast is a statement about an election that hasn't
          happened yet, produced by a model with assumptions baked in that a reader can't check
          against anything. Hedge only publishes the kind of number a visitor can verify.
        </p>
      </section>

      <section className="card">
        <h2>2. Data sources &amp; licenses</h2>
        <p>Hedge ingests from exactly two upstream sources, both licensed CC BY 4.0:</p>
        <ul>
          <li>
            <strong>VoteHub poll feed</strong> — <code>api.votehub.com/polls</code>. Every individual
            poll record: pollster, subject/race, field dates, sample size, population (likely voters /
            registered voters / adults), partisan-sponsorship and internal-poll flags, sponsor names,
            answer choices and percentages, and a source URL. Hedge stores this as reported; a poll's
            own numbers are never altered.
          </li>
          <li>
            <strong>FiveThirtyEight/ABC News pollster ratings</strong> — an archived CC BY 4.0 dataset
            (fetched from the fivethirtyeight/data GitHub archive,{" "}
            <code>pollster-ratings-combined.csv</code>), covering numeric grade, POLLSCORE,
            transparency score, AAPOR/Roper membership, percent partisan work, and polls analyzed per
            pollster. This archive was frozen in 2024 and is no longer updated upstream — Hedge's copy
            is whatever the archive contains, not a live feed of new 538 ratings.
          </li>
        </ul>
        <p>
          Hedge did not create either dataset. It doesn't conduct polls, doesn't rate pollsters, and
          doesn't adjust either input before storing it. The only original work described on this page
          is the fetch schedule, the pollster-identity matching between the two sources, and the
          averaging below.
        </p>
      </section>

      <section className="card">
        <h2>3. Pipeline</h2>
        <p>Every 6 hours, a GitHub Actions workflow runs the full pipeline, in order:</p>
        <ol>
          <li>
            <strong>Fetch</strong> — pull the current VoteHub polls feed and the archived 538/ABC News
            pollster-ratings CSV. (The schedule is <code>17 */6 * * *</code>: 00:17, 06:17, 12:17, and
            18:17 UTC — deliberately offset from the top of the hour.)
          </li>
          <li>
            <strong>Snapshot</strong> — write both raw files into the repository and commit them only
            if they changed, so the exact bytes behind any given run stay preserved and diffable.
          </li>
          <li>
            <strong>Load</strong> — parse and upsert everything into Postgres: the pollster registry,
            polls, answers, and this run's data-quality findings.
          </li>
          <li>
            <strong>Recompute</strong> — call the database functions that fully rebuild{" "}
            <code>race_averages</code> and <code>approval_averages</code> from scratch, and rebuild{" "}
            <code>generic_ballot_average</code> from the loader itself. Every run is a full recompute,
            never a partial update.
          </li>
          <li>
            <strong>Rebuild</strong> — the site's static pages rebuild against the database roughly
            once an hour.
          </li>
        </ol>
        <p>
          At no point does a visitor's request trigger a computation. The front end only ever reads
          already-computed tables — it never aggregates raw polls at request time. Every number on
          this site was computed on a schedule, by the database, before you asked for the page.
        </p>
      </section>

      <section className="card">
        <h2>4. Race averages</h2>
        <p>
          For each 2026 general-election Senate and Governor race, Hedge first has to decide which two
          candidates the average is even about. That decision has two tiers. First,{" "}
          <strong>verified nominees</strong>: a curated <code>race_nominees</code> table records both
          parties' nominees, sourced from official primary results. When a race has a verified pair
          there and at least one poll asked about that exact pairing, that pairing is the matchup —
          no counting involved. Otherwise — before a primary is decided, or before any poll has
          tested the verified pair — Hedge falls back to <strong>co-polling</strong>: it looks at
          every candidate already resolved to a party in the candidate registry (§8) for that state
          and office, counts how many polls tested each possible Democrat-vs-Republican pairing, and
          picks the most-polled pairing. Ties are broken alphabetically by candidate name — a fixed
          rule, not a judgment call made at query time. Every race records which tier produced its
          matchup in the <code>matchup_source</code> column: <code>nominees</code> or{" "}
          <code>co-polling</code>. Whichever tier picks the matchup, only general-election polls
          (<code>race_class = &apos;general&apos;</code>) ever feed the average — primary polls never
          do.
        </p>
        <p>
          Every poll of that matchup is then weighted by how recently it closed (a 45-day half-life —
          a poll's influence roughly halves every 45 days after its last field date) and its sample
          size (bigger samples count more, with diminishing returns above 3,000 respondents; a poll
          that doesn't report a sample size is treated as 600 for weighting purposes only). There's no
          age cutoff beyond that decay — a very old poll of the same matchup still contributes, just at
          a vanishingly small weight. Approval and generic-ballot averages below use a hard trailing
          window instead; race averages don't.
        </p>
        <p>
          Below 3 qualifying polls, Hedge still shows the computed percentages but sets{" "}
          <code>leader_party</code> to null and <code>low_data</code> to true, rather than declaring a
          leader off thin data.
        </p>
        <p>
          Each race also publishes <code>avg_grade</code>: the weight-weighted mean of the archived
          538 numeric grade (0–3) over the polls used — the same recency-and-sample weights as the
          average itself, taken over graded polls only. When under half of a race's polls come from
          grade-matched pollsters, <code>avg_grade</code> is null rather than a number built mostly
          on missing data. It describes the polls behind the average; it never changes the average
          itself.
        </p>
        <pre>
          <code>{`weight = power(0.5, greatest(current_date - end_date, 0) / 45.0)
       * sqrt(least(coalesce(sample_size, 600), 3000) / 1000.0)

dem_pct = round(sum(dem_pct * weight) / sum(weight), 2)
rep_pct = round(sum(rep_pct * weight) / sum(weight), 2)
margin  = round(dem_pct - rep_pct, 2)

low_data = (polls_used < 3)   -- leader_party is null whenever this is true

avg_grade = round(sum(weight * pollster_538_grade) / sum(weight), 2)
  -- over graded polls only; null when graded polls < half of polls_used`}</code>
        </pre>
      </section>

      <section className="card">
        <h2>5. Approval averages</h2>
        <p>
          Each subject with <code>poll_type = &apos;approval&apos;</code> polls (a person or
          institution being asked about — a president, a legislative body) gets one row per day it has
          been polled. For each day, Hedge recomputes the average using only that subject's approval
          polls whose end date falls in the trailing 270 days; anything older is excluded entirely,
          not just decayed.
        </p>
        <p>
          The weighting is the same formula as race averages: a 45-day recency half-life times the
          same sample-size damping (600 default, 3,000 cap). <code>approve_pct</code> requires a poll
          to report an &quot;Approve&quot; answer; <code>disapprove_pct</code> skips any poll in the
          window that doesn't report a &quot;Disapprove&quot; choice (some polls only ask a single
          approve/not-approve question). <code>net</code> is approve minus disapprove, treating a
          missing disapprove as 0.
        </p>
        <p>
          Unlike race averages, there's no minimum-poll floor here — a day backed by a single poll
          still publishes a value. <code>polls_in_window</code> is published alongside every row
          specifically so a reader can weigh that for themselves.
        </p>
        <pre>
          <code>{`-- eligibility for day D:
end_date <= D  and  end_date > D - 270

weight = power(0.5, greatest(D - end_date, 0) / 45.0)
       * sqrt(least(coalesce(sample_size, 600), 3000) / 1000.0)

approve_pct    = round(sum(approve_pct * weight) / sum(weight), 2)
disapprove_pct = round(sum(disapprove_pct * weight) / sum(weight), 2)  -- null if no poll in window reports it
net            = round(approve_pct - coalesce(disapprove_pct, 0), 2)`}</code>
        </pre>
      </section>

      <section className="card">
        <h2>6. Generic congressional ballot average</h2>
        <p>
          This is Hedge's oldest average, and it uses a different formula from the two above — the
          schema's own comment on the newer race-average function describes its weighting as
          &quot;the same spirit as&quot; the generic ballot's, not the same formula. They haven't been
          unified yet. This page says so plainly, because the point of Hedge is that you shouldn't
          have to take that on faith.
        </p>
        <p>
          A poll counts toward the generic ballot only if it's <code>poll_type = &apos;generic-ballot&apos;</code>,
          isn't flagged partisan or internal, doesn't have a reversed field-date range, and reports
          both a Democratic and a Republican number. Each qualifying poll is weighted by recency (a
          <strong> 30-day half-life</strong> — noticeably faster decay than the 45-day half-life used
          for race and approval averages), the same sample-size damping used everywhere else (600
          default, 3,000 cap), and — the one ingredient the other two averages don't use at all — a{" "}
          <strong>pollster-quality multiplier</strong>: 0.6 + 0.4 × (a pollster's archived 538 numeric
          grade ÷ 3) if that pollster is grade-matched, or a flat 0.8 if it isn't. Only polls within
          120 days of the day being computed count, and a day only publishes once at least 3 polls
          qualify. The series also has a hard end: it stops at the newest qualifying generic-ballot
          poll's end date — no day is published past the last real poll, and nothing is extrapolated
          beyond the data.
        </p>
        <pre>
          <code>{`quality_weight = 0.6 + 0.4 * (pollster_538_grade / 3)   if grade-matched
               = 0.8                                     otherwise

weight = (0.5 ** (age_days / 30)) * sqrt(min(sample_size or 600, 3000) / 1000) * quality_weight
  -- age_days = day - poll.end_date; only 0 <= age_days <= 120 is eligible

dem    = round(sum(weight * dem_pct) / sum(weight), 2)
rep    = round(sum(weight * rep_pct) / sum(weight), 2)
margin = round(dem - rep, 2)
  -- published only once at least 3 polls qualify for that day`}</code>
        </pre>
        <div className="callout">
          <p>
            <strong>Honest note.</strong> Race and approval averages use a 45-day half-life and no
            pollster-quality term. The generic ballot uses a 30-day half-life and does weight by
            pollster quality. Both are the same family — exponential recency decay × sample-size
            damping — with different constants and one extra term, not the same formula wearing
            different clothes.
          </p>
          <p>
            Unifying all three under one documented formula is on the roadmap; it hasn't shipped yet.
          </p>
        </div>
      </section>

      <section className="card">
        <h2>7. What we exclude — and what we only flag</h2>
        <p>Every load runs three checks against the incoming polls:</p>
        <ul>
          <li>
            <strong>Reversed field dates.</strong> If a poll's start date is after its end date, that's
            logged as a &quot;serious&quot; finding. The poll itself is still stored — nothing is
            deleted — but it's skipped when computing the generic ballot average specifically.
          </li>
          <li>
            <strong>Partisan or internal sponsorship.</strong> Every poll's <code>partisan</code> and{" "}
            <code>internal</code> flags are stored and visible on the row itself. The generic ballot
            average excludes any poll with either flag set.
          </li>
          <li>
            <strong>Duplicate answer choices.</strong> If a poll's raw answers list the same choice
            twice, the second occurrence is dropped before it ever reaches the database and logged as
            a &quot;warning&quot; finding — this is the one check that's a true row-level exclusion,
            not just a flag.
          </li>
        </ul>
        <p>
          One scope note, stated plainly because burying it would defeat the point of this page: the
          partisan/internal filter and the reversed-date exclusion currently run in the generic-ballot
          pipeline only. Race averages and approval averages are computed directly from{" "}
          <code>polls</code> and <code>poll_answers</code> with no partisan, internal, or reversed-date
          filter of their own yet. A partisan-sponsored, internal, or reversed-date poll of a Senate or
          Governor race — or of an approval subject — would currently be included in those two
          averages. Nothing about this is hidden: the <code>partisan</code>, <code>internal</code>, and{" "}
          <code>start_date</code> columns are public on every poll row, and any reversed-date poll is
          flagged regardless of which average(s) it ends up feeding.
        </p>
        <p>
          Every finding — <code>good</code>, <code>warning</code>, or <code>serious</code> — lands in a
          public <code>data_quality_findings</code> table tied to the run that produced it. As the
          schema itself puts it: a commons that hides its own errors is not a commons.
        </p>
      </section>

      <section className="card">
        <h2>8. Pollster registry &amp; candidate parties</h2>
        <p>
          Pollster names arrive inconsistently — &quot;HarrisX&quot;, &quot;HarrisX/Harris&quot;, and
          &quot;HarrisX/Harris Poll&quot; can all be the same pollster in the wild. Hedge groups raw
          names by a coarse stem — lowercase the name, strip everything that isn't a–z, keep the first
          8 characters — and every raw string sharing a stem becomes an alias of one registry row; the
          most frequently seen raw string becomes that row's canonical display name. This is
          explicitly a starting point, not a finished answer: every alias grouping is stored in{" "}
          <code>pollsters.aliases</code>, in full view, specifically so a coarse match that merged two
          different pollsters (or failed to merge real variants) can be caught and fixed by a human —
          see Limitations.
        </p>
        <pre>
          <code>{`stem(name) = re.sub(r"[^a-z]", "", name.lower())[:8]`}</code>
        </pre>
        <p>
          Candidate party labels work the other direction: assisted, then reviewed, never silently
          overwritten. Every candidate name seen in a 2026 general-election Senate or Governor poll is
          registered with <code>party</code> left null. A narrow auto-classify pass resolves only the
          unambiguous cases immediately — literal non-candidate answers (&quot;Undecided&quot;,
          &quot;Other&quot;, &quot;Someone else&quot;, &quot;Refused&quot;, and similar) get party{" "}
          <code>X</code>; a literal &quot;Dem/Democrat/Democratic&quot; answer gets <code>D</code>; a
          literal &quot;Rep/Republican/GOP&quot; answer gets <code>R</code>. Every actual named
          candidate stays unresolved until curated by a person or an agent-plus-review pass, and{" "}
          <code>party_source</code> records how each value was set (values like{" "}
          <code>literal-label</code>, <code>non-candidate</code>, and agent-attributed sources among
          them).
        </p>
        <p>
          The one rule that's never broken: once <code>party</code> is non-null, nothing in the ETL can
          overwrite it — every auto-classify step is guarded by a &quot;still null&quot; check. This
          matters beyond bookkeeping: race averages (§4) only consider matchups between a candidate
          resolved to <code>D</code> and one resolved to <code>R</code>, so an unresolved candidate
          can't anchor a published race average.
        </p>
      </section>

      <section className="card">
        <h2>9. Limitations</h2>
        <ul>
          <li>
            <strong>Feeds are only as fresh as their newest poll.</strong> Both derived time series
            share the same end-bound rule: each stops at the newest qualifying poll's own end date —
            the generic ballot average at the last generic-ballot poll (§6), the approval average at
            the newest approval poll for each subject. Neither is extrapolated past its data, so
            either feed simply goes quiet whenever its source publishes nothing new, and the two can
            drift out of sync with each other for exactly that reason. Check the most recent dates in{" "}
            <code>approval_averages</code> and <code>generic_ballot_average</code> directly for the
            current gap rather than trusting any specific date on this page.
          </li>
          <li>
            <strong>Pollster grouping is a heuristic.</strong> The 8-character alphabetic stem (§8) is
            a starting point pending human curation — it can merge two unrelated pollsters that happen
            to share a stem, or fail to merge real spelling variants that don't.{" "}
            <code>pollsters.aliases</code> is exactly where to check.
          </li>
          <li>
            <strong>Exclusion rules aren't applied uniformly yet.</strong> See the scope note in §7 —
            partisan/internal/reversed-date filtering currently reaches the generic ballot average
            only.
          </li>
          <li>
            <strong>One source per metric.</strong> VoteHub is the only poll feed, and the archived
            538/ABC News file is the only pollster-rating source. If either has a gap or a bias, Hedge
            inherits it; there's no second source to cross-check against today.
          </li>
        </ul>
      </section>

      <section className="card">
        <h2>10. Verify it yourself</h2>
        <p>
          Every table behind every number on this site — <code>polls</code>, <code>poll_answers</code>,{" "}
          <code>pollsters</code>, <code>candidates</code>, <code>race_averages</code>,{" "}
          <code>approval_averages</code>, <code>generic_ballot_average</code>,{" "}
          <code>data_quality_findings</code>, even the <code>ingest_runs</code> log of every pipeline
          run — is Postgres with row-level security set to allow public, read-only access to all of
          it. There's no number on the homepage or this page that isn't sitting in a table you could
          query yourself; nothing is computed only behind the scenes and thrown away.
        </p>
        <p>
          The whole site rebuilds against that database on a fixed schedule — roughly once an hour —
          never on demand, never customized per visitor. What you're looking at right now is exactly
          what everyone else is looking at right now.
        </p>
        <p className="note">Source code and direct database access details aren't linked from this page yet.</p>
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
        .card ol, .card ul { margin:0 0 12px; padding-left:1.3em; line-height:1.6; }
        .card ol:last-child, .card ul:last-child { margin-bottom:0; }
        .card li { margin-bottom:6px; }
        .note { color:var(--text-secondary); font-size:.9rem; }
        .callout { border-left:3px solid var(--text-secondary); background:var(--surface-0);
          border-radius:0 8px 8px 0; padding:14px 16px; margin:14px 0 0; font-size:.95rem; }
        .callout p { margin:0 0 8px; }
        .callout p:last-child { margin-bottom:0; }
        pre { background:var(--surface-0); border:1px solid var(--line); border-radius:8px;
          padding:14px 16px; overflow-x:auto; margin:10px 0 12px; }
        code { font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace; font-size:.82rem; }
        pre code { line-height:1.6; white-space:pre; }
        p code, li code { background:var(--surface-0); border:1px solid var(--line); border-radius:4px;
          padding:1px 5px; }
      `}</style>
    </main>
  );
}
