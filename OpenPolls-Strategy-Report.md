# Rebuilding the 538 Data Commons

### A landscape assessment and build plan for a free, open, non-profit US polling database

Prepared for Sunny Saini · August 1, 2026

---

## Executive summary

**The forecast void is filled. The data void is not.**

Five separate outfits published 2026 midterm forecasts before you started reading this. What nobody replaced is the thing that made 538 load-bearing infrastructure rather than just a popular website: **the free, openly-licensed, machine-readable poll database that everyone else built on top of.** 538's live poll CSVs went dark in March 2025 and now redirect to an ABC News landing page. The person who ran 538's newsroom at the end, G. Elliott Morris, now sells that same class of data for **$1,000–1,500 a year**.

That is your opening, and it's a good one — the public-good layer got thinner and more expensive, and no institution owns continuity.

Three findings shape everything downstream:

1. **You can bootstrap legally and immediately.** VoteHub runs a free, unauthenticated, CC BY 4.0 API with 5,413 polls — I pulled the whole thing in one 2.6 MB request. 538's pollster ratings survive on GitHub under CC BY 4.0. Nate Silver gives away 12,300+ historical polls. Two open sources, license-compatible, zero legal exposure. **No scraping required.**
2. **The hard part isn't the model — it's the registry.** In the prototype I built, naive name matching joined only 103 of 216 pollsters to 538's ratings. `HarrisX`, `HarrisX/Harris`, and `HarrisX/Harris Poll` are the same firm in three strings. A hand-curated pollster registry with stable IDs is the actual durable asset, and it's the piece an AI assistant can help you build far faster than it can help you build a forecast model.
3. **Publish the database. Be extremely reluctant about the forecast.** A database is verifiable — you're right or wrong about a fact. A forecast generates enormous attention and unfalsifiable blame. 538's reputational damage came from forecasts, never from its database.

Running cost: **~$25/year.** The constraints on this project are your time and your credibility, not money or technology.

---

## Part 1 — What actually exists in August 2026

### The forecast layer is crowded

| Outfit | Model | Price | **Open poll data?** | Pollster ratings? |
|---|---|---|---|---|
| Silver Bulletin (Nate Silver) | averages + ratings; 2026 model not launched as of July 31 | Freemium | ✅ free XLSX | ✅ |
| Split Ticket / The Argument | Monte Carlo, correlated errors | **Free** | ⚠️ partial | ❌ |
| Decision Desk HQ (Geoffrey Skelley, ex-538) | 1M sims, blends prediction markets | Freemium | ❌ | ❌ |
| The Economist | 25,001 sims | **Paywalled**, code closed | ❌ | ❌ |
| Race to the White House | 10k sims | Free | ❌ | ❌ |
| VoteHub | ML ensemble | **Free** | ✅ **open API** | ✅ scorecards |
| FiftyPlusOne (G. Elliott Morris, ex-538) | nowcast | averages free, **API $1,000–1,500/yr** | 💰 paid | uses 538's archive |
| Cook / Sabato / Inside Elections | race ratings | $0 – $6,500/yr | ❌ | ❌ |

New entrants since the shutdown: FiftyPlusOne, The Bellwether Project (operator anonymous — treat with caution), Election Statsheet (fully open source, Stan/MCMC), ElectIndex.

**Building a sixth forecast model would be entering the one crowded part of this market as its least experienced participant.** Don't.

### The data layer is thin and fragmenting

Where 538's data went:

- **`github.com/fivethirtyeight/data` is still live** and still CC BY 4.0. But the *poll-level CSVs were never in the repo* — it only linked out to the website. What survives there is the **pollster ratings** (539 firms with grades, POLLSCORE, transparency scores) and **`raw-polls.csv`** — 11,475 historical polls from 1998–2022 *with the actual election results already joined*. That join is worth months of work.
- **The live poll feeds 302-redirect to `abcnews.go.com/politics`.** A naive `curl` returns HTTP 200 with a ~300 KB HTML body. Anyone whose pipeline still points there is silently ingesting a news landing page. **Archive.org has working captures from March 6, 2025** — the last known good copies, including the `*_historical.csv` files. Mirroring those is itself a public service and should be your first act.
- The community mirrors (`simonw/fivethirtyeight-polls`, `rearc-data/...`) exist but **stopped updating in March 2021.** Don't rely on them.

Nobody institutional stepped in. Roper Center is subscription-only and doesn't allow redistribution. ICPSR holds microdata, not toplines. AAPOR runs a disclosure *standard*, not a repository. Pew publishes its own surveys but doesn't aggregate. **The open-data role got picked up by commercial and journalistic actors, not by the commons** — which is precisely the argument for what you're building.

> **The thesis, in one line:** two media-owned open polling databases have now been killed by corporate parents — HuffPost Pollster in 2017, FiveThirtyEight in 2025. That is the case for why this has to be a commons. Put it in every grant application.

---

## Part 2 — Where the data comes from

### Tier 1 — Current cycle: VoteHub API ⭐

`https://api.votehub.com/polls` — **no key, no auth, CC BY 4.0.** I verified this end to end:

- **5,413 polls** in one 2.6 MB request, no pagination
- **216 distinct pollsters**
- Coverage: approval 2,931 · favorability 1,033 · generic ballot 533 · Senate 314 · Governor 293 · presidential primary 187 · House 63
- Every record carries a **`url` field pointing at the original pollster release** — you get primary-source provenance for free, without building 216 scrapers
- Date range **2018-11-12 → 2026-07-30** (deeper than their docs imply; congressional approval goes back to 2018)

Caveats: rate limits are undocumented (be conservative, cache, identify your bot), there's no CSV bulk export or GitHub repo, and their *website* robots.txt blocks AI crawlers — that applies to the HTML site, not the affirmatively-offered API. **Email them.** As a fellow open-data nonprofit you are their ideal user, and a relationship beats guessing. Also: mirror everything you pull, daily, in a public git repo. They're a young company; don't build a single-source dependency.

### Tier 2 — Historical backbone (do this first, and soon)

1. **Wayback captures** of 538's six `*_historical.csv` files at the `20250306...if_/` timestamps. The Senate file alone is 9,292 rows × 52 columns spanning 2016–2024.
2. **`fivethirtyeight/data` on GitHub** — `pollster-ratings/2023/raw-polls.csv` (11,475 polls with actuals) and `pollster-ratings-combined.csv` (539 firms). CC BY 4.0.
3. **Silver Bulletin's free XLSX release** — 12,350 rows × 29 columns, retains `question_id_538` so it lineages directly back to the 538 corpus. Silver states it's free for any purpose with attribution.

### Tier 3 — Verification (build slowly)

Confirmed-working RSS feeds: **Emerson, Data for Progress, UNH Survey Center, YouGov, Pew, Monmouth.** Quinnipiac has no RSS but its robots.txt is a bare `Allow: /`. Prioritize **AAPOR Transparency Initiative members** — they're obligated to publish methodology, which makes them both the easiest to ingest and the highest quality.

### Tier 4 — Entity resolution

**OpenFEC API** (public domain, free key) for candidate and committee IDs — this is the right spine for linking polls to real candidates. Plus `unitedstates/congress-legislators` (public domain).

### Explicitly excluded

- **RealClearPolling** — DataDome anti-bot CAPTCHA *and* a ToS forbidding "re-transmission, distribution." Worst risk/reward on the list.
- **270toWin** — robots.txt declares `use=reference` and disallows `/download`. Cite them, don't harvest them.
- **Wikipedia** — superb 2026 coverage (articles edited hourly) and every poll row carries a `{{cite web}}` to the original source. But it's **CC BY-SA**, and share-alike would infect your whole database. **Use it as a discovery and cross-check layer only:** find polls you missed, then follow the citation and ingest from the *primary source*. Facts aren't copyrightable; Wikipedia's table arrangement arguably is.
- Roper, ICPSR, Ballotpedia, DDHQ, FiftyPlusOne — subscription or commercial, none permit redistribution.

---

## Part 3 — The legal position

*General information, not legal advice. Get a real opinion before launch — media-law clinics, FIRE, and the Reporters Committee often help nonprofits free.*

### Facts aren't copyrightable — *Feist v. Rural Telephone* (1991)

"Emerson polled 800 Maine voters Feb 12–16; Collins 67%, Smeriglio 6%" is a **fact**. Emerson can't copyright it. Neither can RCP, VoteHub, Wikipedia, or you. The Supreme Court killed the "sweat of the brow" doctrine — effort earns zero copyright. Compilations get only "thin" protection covering original *selection and arrangement*, never the underlying facts.

Two consequences: (1) extracting facts in bulk isn't infringement; (2) **your own database will also have only thin copyright** — anyone can lawfully take your numbers. Design for that. Your moat is freshness, accuracy, provenance, and trust, not exclusivity.

### Copyright isn't your real exposure — contract is

The popular summary "*hiQ* made scraping legal" is wrong and dangerous.

- ***Van Buren*** **(2021)** narrowed the CFAA to a "gates-up-or-down" test — a ToS violation isn't automatically a federal crime.
- ***hiQ v. LinkedIn*** held scraping *public* data likely doesn't violate the CFAA. **But the case didn't end there.** In November 2022 LinkedIn won summary judgment on **breach of contract** — hiQ had created an account, clicked "I agree," and used fake accounts. Final judgment: hiQ permanently enjoined, ordered to delete all code and data, **paid $500,000.** hiQ was destroyed by contract law, not copyright.

**The operative rules:** prefer offered APIs under open licenses; never click-accept terms on a site you intend to harvest; never circumvent CAPTCHAs or rate limits; identify your bot honestly; respect robots.txt. The VoteHub + primary-source strategy **takes contract law off the table entirely** — that's why it's stronger than it first looks.

### EU database rights — confirmed irrelevant

Directive 96/9/EC's *sui generis* right (the "sweat of the brow" protection *Feist* refused) is limited by Article 11 to EU nationals and EU-formed companies, extendable to third countries only by Council agreement. **No such agreement exists with the US.** A US nonprofit gets no such protection and owes no such liability. CC BY 4.0 §4 licenses these rights anyway where they exist.

### What license to use: **CC BY 4.0**

The constraint decides it: **both your best sources are CC BY 4.0, and CC BY's attribution requirement isn't waivable downstream.** You therefore can't cleanly release CC0.

There's a tempting counter-argument — under *Feist* the facts aren't copyrightable, so the license has nothing to attach to. **Legally arguable, strategically terrible.** You'd be a nonprofit built on open data publicly stiffing the two organizations whose openness made you possible, while asking pollsters and volunteers to trust you. Attribution costs one field per row.

| License | Verdict |
|---|---|
| **CC BY 4.0** | ✅ **Use this.** Compatible with both upstreams. Universally understood. Permits commercial reuse, which drives adoption. |
| CC0 | ❌ Incompatible with your sources. |
| ODbL / CC BY-SA | ❌ Copyleft scares off exactly the newsrooms and journalists you want. Share-alike is nearly unenforceable in the US anyway since the facts aren't copyrightable — it deters honest users without stopping bad actors. |

Code under **MIT or Apache-2.0**. And make **per-record provenance non-negotiable**: `source_org`, `source_url`, `source_license`, `retrieved_at`, `original_pollster_url` on every row. That one design decision satisfies attribution mechanically, makes you auditable, protects you from copyright traps, and preserves the option to re-license primary-sourced subsets to CC0 later.

---

## Part 4 — Technical architecture

**The pattern across every durable open-data project: the canonical artifact is plain text in version control, and everything else is a derived, disposable rendering layer.** OpenElections uses flat CSV in ~50 GitHub repos. MIT Election Lab outsources archival to Harvard Dataverse entirely. Our World in Data is the exception, and it has ~50 staff.

### The stack

| Layer | Choice | Why |
|---|---|---|
| **Canonical storage** | **Flat CSV in a public Git repo** | Human-readable diffs *are* the audit story. 200k polls × 30 cols is ~100 MB. |
| **Derived artifacts** | SQLite + Parquet as GitHub Release assets / R2 | Built fresh each run, never the source of truth. Parquet on a static host is queryable in-browser via DuckDB-Wasm. |
| **Database server** | **None.** No Postgres. | The moment you need a server you've lost the "durable for a solo builder" property. |
| **ETL / scheduling** | **GitHub Actions cron** | Free and unlimited on public repos. This is the biggest cost lever in the project. |
| **API** | **Don't build one.** Static JSON/CSV/Parquet on a CDN. | Faster, cheaper, more reliable than any API you'd write. Add Datasette Lite (runs in-browser via WASM, $0) for exploration. |
| **Front-end** | **Astro + Observable Plot** | Not Next.js — it pushes you toward a server runtime you'd have to operate. Keep the site boring; credibility comes from the data files and the methodology page. |
| **Hosting** | **Cloudflare Pages + R2**, GitHub Pages as mirror | **Static asset requests are free and unlimited on all Cloudflare plans.** An election-night traffic spike costs you nothing. |
| **Archival** | **Zenodo** (free, mints DOIs) | Gives academics a citable permanent object and gets you into citation graphs. Very high leverage. |

Two GitHub Actions gotchas: scheduled workflows on public repos auto-disable after 60 days of inactivity (daily commits solve this), and cron is best-effort and often delayed — make jobs idempotent and add a "last successful run" badge.

### Cost

| Scenario | Annual |
|---|---|
| Low traffic, static-only | **~$15–25** (just the domain) |
| 1M+ pageviews/month | **~$50–200** |
| If you build it wrong (server-rendered on Vercel Pro, managed Postgres, unprotected Datasette) | **$600–5,000** |

The gap between the good architecture and the bad one is roughly **50×**. That's the whole argument for static-first.

### Auditability practices, in priority order

1. **Git-scrape everything immutably** — every fetch writes a raw unmodified snapshot, commits only on change. Free, permanent, cryptographically-chained proof of what each source said and when. If a pollster silently revises a number, git history proves it.
2. **`raw → cleaned → derived`, never edit backwards.** Corrections are new commits with a stated reason. Publish a machine-readable `corrections.csv`.
3. **Version the *methodology*, not just the data.** Tag releases (`ratings-v1.0`). When you change the model, publish the diff and run both versions in parallel for a cycle. This is what separates "credible statistical shop" from "guy with a spreadsheet."
4. **Automated validation in CI, failing loudly.** (See the prototype — it already does this.)
5. **DOI-mint periodic releases to Zenodo.**
6. **Publish your own accuracy scorecard** after every election, including your misses. Cheapest credibility purchase available.

Skip DVC and Dolt — Git + CSV + tagged releases + Zenodo covers 95% of the value at a fraction of the complexity.

---

## Part 5 — Pollster ratings: what it takes

This is your highest-value and highest-risk component. Build it *last*.

### What 538 actually did, and what it never told you

538's ratings ran two mathematically distinct eras: **Predictive Plus-Minus** (Silver, 2008–2023, which Silver Bulletin still runs today) and **POLLSCORE** (Morris, 2024). The v4.0 pipeline is well documented and implementable:

1. **Poll-level error and bias**, on the margin between the top two *finishers in the election* (not in the poll — get this backwards and every sign flips).
2. **Excess error** — residuals from a multilevel regression on implied SD from sample size, **√(days to election)**, election cycle, and contest type.
3. **Relative excess** — subtract the weighted average of all *other* polls in the same race. This step is the mathematical heart of it: election-level bias is a **shared shock the pollster didn't cause**, so a rating built on raw error is close to meaningless.
4. **Shrinkage** toward a *peer-group* prior, not zero — `Adjusted × n/(n+k) + prior × k/(n+k)`, with `n` time-weighted at **14% decay per year** (`0.86^years`).
5. **Transparency Score** — 10 published yes/no questions, blended `0.7 × directly measured + 0.3 × (10 if AAPOR-TI or Roper member else 0)`.
6. **Herding penalty**, **1,000-run bootstrap**, then a Pareto-frontier star rating.

**What 538 never published, in any version:** regression coefficients, the error model's functional form, the shrinkage constant, the letter-grade thresholds, the house-effect estimator, the herding penalty's form, **and any source code.** They published outputs; nobody could ever re-derive them.

**That gap is your entire product.** Open data + open code + published coefficients + versioned reproducible releases + a public methodology changelog. Nobody does this.

### Three things to build in from day one

- **Design effect ≈ 1.24.** Shirani-Mehr, Rothschild, Goel & Gelman (*JASA* 2018) found reported margins of error should be multiplied by ~1.24 — nominal 95% intervals covered the truth only **73%** of the time in Senate races. If you don't inflate the binomial SE, every pollster looks worse than chance and you'll false-flag herding everywhere.
- **Publish uncertainty intervals.** 538 ran the bootstrap but showed only point estimates. Most pollsters' intervals overlap the mean, and **saying so plainly is the most honest thing a ratings system can do.** This is the single easiest improvement available.
- **Calibrate your own expectations.** 538's own validation: weighting by POLLSCORE improved average bias from **4.19 pp to 4.07 pp**. A 0.12 pp gain. Quote that to yourself before over-claiming. Past-to-future correlation on their headline metric was only ~0.45.

### Herding — report it, don't score it

Silver's 2024 binomial test found 193 of 249 October swing-state polls within ±2.5 pp when ~55% was expected: odds against, **1 in 9.5 trillion.** The AAPOR 2024 task force ran a pre/post-release asymmetry test and found **no evidence of herding**, attributing the narrow spread to methodological convergence — and demonstrated it by reweighting raw microdata to common targets and reproducing the narrowing.

**Both used defensible tests on the same cycle and reached opposite conclusions.** That disagreement is the most important thing to communicate. Publish herding as a *separate diagnostic beside the score*, never folded silently into a grade.

### Keep integrity separate from accuracy

538 banned seven firms (Strategic Vision, Research 2000, and five others). Their Plus-Minus scores ranged from −0.179 to +0.531 — **some banned firms scored better than average.** Most F grades were integrity penalties, not accuracy penalties. Keep an explicit `integrity_flag` with the reason, the evidence, the date, and an appeals record, rather than smuggling it into a number. This is also the most legally exposed part of the project.

---

## Part 6 — Governance, funding, credibility

### Entity structure: start light

| Option | Cost | Verdict |
|---|---|---|
| **Unincorporated open-source project** | $0 | ✅ **Start here.** Your costs are ~$25/yr; you have no urgent need for money. |
| **Fiscal sponsorship** | 5–10% of revenue | ✅ **Move here once you have something to show.** Grant-eligible almost immediately, no IRS application, no board, reversible. |
| **Your own 501(c)(3)** | $400–1,000 DIY yr 1; $2,500–5,000 with counsel | Only above ~$100–200k/yr, or when liability demands it. |

Best sponsors: **Institute for Nonprofit News** ($500 onboarding + 7% of charitable revenue) and **Investigative Reporters & Editors** — IRE is OpenElections' fiscal agent, the closest exact precedent to what you're building. Email them; their terms aren't published. Avoid NumFOCUS (not accepting applications) and Software Freedom Conservancy (wrong fit). **Caution on Open Collective:** its 501(c)(3) host dissolved at the end of 2024, forcing hundreds of projects to scramble; Open Source Collective is a 501(c)(6), which many foundations legally can't fund. Great ledger tool, risky legal home.

**Do these free things today regardless:** register the domain and a GitHub **org** under a project name, not your personal account. That makes every later transition trivial. And use a registered agent or virtual office on any public filing — never your home address.

### Funding: don't chase grants in year one

Your infrastructure costs $25. Grant applications will eat the time you need to build the thing. And the big doors are mostly closed: **Knight** funds "through relationships, research and ongoing work," not open applications. **Democracy Fund explicitly does not accept unsolicited proposals.** The genuinely open front doors are the **Sloan Foundation's Open Source in Science** program (two-page letter of inquiry by email) and **Press Forward**, which has invested $22.7M specifically in local news *infrastructure*.

The sequencing that works: **build the artifact → get cited → then fundraise.** One academic paper or one major newsroom citing your dataset changes every conversation. First money should probably be small individual donations — not for the amount, but because "500 people fund this" is evidence of public value, and it diversifies you away from the Ballotpedia problem below.

### Credibility — the make-or-break section

A new election data project is dismissed as partisan by default. The playbook:

1. **Radical funder transparency from dollar one.** Publish every funder and amount permanently. Policy: no money from campaigns, parties, PACs, or partisan advocacy orgs, ever, with a published cap on any single funder. **Ballotpedia's content is largely neutral and it has a 4-star Charity Navigator rating — and it still gets attacked over its donors.** The attack targets your funding regardless of your content. Pre-empt it.
2. **Everything open source and reproducible.** Anyone should be able to `git clone` and reproduce your ratings exactly. "Check my work" is a far stronger claim than "trust me," and it's the one advantage you have over paywalled competitors.
3. **Pre-register your methodology and freeze it before elections.** Publish, open a comment period, lock and version-tag it before results are known. This is the single best defense against "you changed the model to favor X."
4. **Anchor to AAPOR.** Join as an individual member, adopt their disclosure standards as your literal data schema, make Transparency Initiative status a public field on every pollster. Ask AAPOR whether an aggregator can join the TI — even the question is a useful relationship-opener.
5. **Build a visibly bipartisan advisory board early.** Target an academic survey methodologist, a Republican pollster, a Democratic pollster, a data journalist, and a statistician. Three or four names transforms perception, and people say yes to interesting new projects more readily than to established ones.
6. **Find an academic partner.** MIT Election Lab sits inside MIT; Our World in Data's researchers are Oxford-affiliated. Even one named academic collaborator buys enormous credibility.
7. **Symmetric error reporting.** Every cycle, publish whether polls missed toward Democrats or Republicans — and lead with the direction that's inconvenient for whoever is currently praising you.
8. **Never editorialize about candidates.** Not on the site, not on the project's social accounts. Keep your personal political posting entirely separate.

**Copy Our World in Data's structure** — separate legal entity owning the site and tools, academic affiliation for scientific authority, a real board of trustees with recognizable independent names, full donor list and audited financials published.

### Risks worth taking seriously

**Legal.** The environment got materially worse in 2024–26. After the Selzer Iowa poll missed in 2024, **Trump sued the pollster and the newspaper.** A parallel class action was dismissed on First Amendment grounds in November 2025 — the court held polls are "a mere snapshot of a dynamic and changing electorate" — but Trump then dismissed his federal case and refiled in Iowa state court. Aggregating poll data is low-risk. **Publishing pollster accuracy ratings is meaningfully higher-risk** — you're making evaluative statements about named businesses. Truthful, methodologically-grounded, opinion-framed statements are strongly protected, but "protected" and "not sued" are different, and defense costs are real even when you win.

Mitigations: incorporate before publishing ratings so the entity is the defendant; **choose a state with a strong anti-SLAPP statute**; carry media liability / D&O insurance (~$500–1,500/yr); frame ratings as opinion based on fully disclosed facts and data; build a relationship with **FIRE** and the **Reporters Committee** *before* you need one; give pollsters a notice-and-comment window and a documented appeals process — most disputes die there.

**Harassment.** This is documented and quantified, not a vague worry. Princeton's Bridging Divides Initiative recorded ~170 election-related threat and harassment incidents against local officials from 2022–2024, ~30% involving a physically present perpetrator. The Stanford Internet Observatory — university-backed and well-resourced — was subpoenaed, sued, and effectively wound down. Do the defensive work *before* you have traffic: registered agent not your home, WHOIS privacy, hardware-key 2FA, data-broker removal (~$100–200/yr), publish under the project's name initially, write an incident plan, and **run no comments, forum, or Discord** — every user-generated surface is an attack surface and a liability. Given your day job, talk to your employer before this becomes news, not after.

**Being wrong.** This is the risk that ends projects, and the mitigation is structural: **ship the database and the ratings; be very reluctant about the forecast.** If you ever do forecast, publish calibration curves across all past forecasts, never lead with a single headline probability, and pre-commit publicly to a post-election accountability post. Either way, publish your own scorecard after every election, including your misses, before someone else does it for you. Being the first and harshest critic of your own work is the cheapest reputational insurance there is.

---

## Part 7 — Build plan

You said no deadline, building it yourself with AI help. That argues for sequencing by *durable value*, not by what's most visible.

**Phase 1 — Preservation (weeks 1–4).** Mirror the Wayback captures of 538's six historical CSVs and the `fivethirtyeight/data` pollster-ratings tree. Publish as CC BY 4.0 with attribution, a schema, and a changelog. Mint a Zenodo DOI. *This alone is a public service and gives you something citable immediately.*

**Phase 2 — The registry (weeks 4–12).** The pollster entity table with stable IDs, aliases with effective-date ranges, ownership and sponsor relationships, AAPOR/Roper status, methodology fields. **This is the durable moat and the piece AI helps most with.** Everything downstream depends on it.

**Phase 3 — Live ingest (weeks 8–16).** Git-scrape VoteHub daily into `/data/raw/` with immutable snapshots. Add 3–5 pollster RSS feeds. Publish CSV + SQLite + Parquet. Turn on CI validation.

**Phase 4 — Averages (weeks 16–24).** Transparent, documented, boring — a stated-window weighted average with published weights. No black boxes.

**Phase 5 — Ratings (month 6+).** Only after publishing the methodology for public comment. Open code, published coefficients, uncertainty intervals, herding as a separate diagnostic, integrity as a separate flag.

**Phase 6 — Forecast.** Seriously consider never doing this.

### The next five emails to send

1. **VoteHub** — introduce yourself, ask about rate limits and whether they'd support a public mirror. Ideal-user framing.
2. **IRE** — fiscal sponsorship terms. Closest precedent (they sponsor OpenElections).
3. **AAPOR** — can an aggregator join the Transparency Initiative?
4. **MIT Election Lab** — is there appetite for an informal affiliation or data partnership?
5. **One academic survey methodologist** — ask them to look at your methodology draft. Free advice, and the start of an advisory board.

---

## Part 8 — The prototype

Everything in `OpenPolls-prototype.html` is built from **real data pulled today**, entirely from CC BY 4.0 sources, with no scraping and no ToS acceptance. Pipeline: `raw → clean → derived`, ~250 lines of Python.

**What it proves works:**

- **5,413 polls** ingested from VoteHub in one request — 216 pollsters, 12,855 individual toplines, 2018–2026
- **A generic ballot average** on 504 non-partisan polls (29 partisan/internal excluded and flagged, not hidden), weighted by recency × √sample size × 538 pollster grade. Currently **D+5.1** (45.5 / 40.3) — with a prominent note that the most recent poll was fielded 32 days ago, because freshness is part of the truth
- **The pollster registry join** — 103 of 216 matched to 538's archived ratings by name (47.7%), covering 81.4% of all polls. The unmatched list is displayed *deliberately*, because it's the most instructive thing on the page
- **Six automated data-quality checks** that found real problems on the first pass: 4 records with reversed field dates, 35 exact duplicates, 80 missing sample sizes, 23 probable pollster-name variants

That last section is the most important part of the prototype. Every poll database has these defects. **The difference a commons makes is that it publishes its own defect list.**

---

## Sources

**Landscape:** [Nieman Lab on the 538 shutdown](https://www.niemanlab.org/2025/03/fivethirtyeight-is-shutting-down-as-part-of-broader-cuts-at-abc-and-disney/) · [Poynter](https://www.poynter.org/commentary/2025/538-disney-abc-layoffs-shut-down-nate-silver/) · [Nate Silver on 538's closure](https://www.natesilver.net/p/a-few-words-about-fivethirtyeight) · [Split Ticket 2026 model](https://www.theargumentmag.com/p/split-ticket-2026-midterms-model) · [DDHQ 2026 forecast](https://votes.decisiondeskhq.com/forecast/2026) · [FiftyPlusOne downloads/pricing](https://fiftyplusone.news/downloads) · [Morris's launch announcement](https://www.gelliottmorris.com/p/announcing-a-new-polling-and-elections) · [Election Statsheet (open source)](https://github.com/thisismactan/US-2026) · [HuffPost Pollster launch](https://www.niemanlab.org/2012/07/huffington-post-puts-polling-power-in-the-hands-of-developers-with-new-api/)

**Data sources:** [VoteHub API](https://votehub.com/polls/api/) · [VoteHub Pollster Scorecards](https://votehub.com/polls/pollster-scorecards/) · [fivethirtyeight/data](https://github.com/fivethirtyeight/data) · [538 pollster-ratings README](https://github.com/fivethirtyeight/data/blob/master/pollster-ratings/README.md) · [Silver Bulletin ratings + free data](https://www.natesilver.net/p/pollster-ratings-silver-bulletin) · [simonw/fivethirtyeight-polls mirror](https://github.com/simonw/fivethirtyeight-polls) · [MIT Election Lab](https://electionlab.mit.edu/data) · [OpenElections](https://openelections.net/about/) · [OpenFEC API](https://api.open.fec.gov/developers/) · [AAPOR Transparency Initiative](https://aapor.org/standards-and-ethics/transparency-initiative/)

**Methodology:** [How 538's pollster ratings work (v4.0)](https://abcnews.com/538/538s-pollster-ratings-work/story?id=105398138) · [Shirani-Mehr, Rothschild, Goel & Gelman, *Disentangling Bias and Variance in Election Polls*](https://sites.stat.columbia.edu/gelman/research/published/polling-errors.pdf) · [Jennings & Wlezien, *Election polling errors across time and space*](https://www.nature.com/articles/s41562-018-0315-6) · [AAPOR Task Force on 2024 Pre-Election Polling](https://aapor.org/wp-content/uploads/2025/10/AAPOR-Task-Force-on-2024-Pre-Election-Polling_Report.pdf) · [AAPOR Task Force on 2020](https://aapor.org/wp-content/uploads/2022/11/AAPOR-Task-Force-on-2020-Pre-Election-Polling_Report-FNL.pdf) · [Silver on herding in 2024](https://www.natesilver.net/p/theres-more-herding-in-swing-state) · [Strategic Vision fraud analysis](https://fivethirtyeight.com/features/strategic-vision-polls-exhibit-unusual-patterns-possibly-indicating-fraud) · [Research 2000 fabrication tests](https://www.techdirt.com/2010/06/29/faux-randomness-strikes-again-how-researchers-realized-research-2000s-daily-kos-data-looked-faked/)

**Legal:** [Feist v. Rural Telephone, 499 U.S. 340](https://supreme.justia.com/cases/federal/us/499/340/) · [hiQ v. LinkedIn — breach of contract ruling](https://newmedialaw.proskauer.com/2022/11/11/court-finds-hiq-breached-linkedins-terms-prohibiting-scraping-but-in-mixed-ruling-declines-to-grant-summary-judgment-to-either-party-as-to-certain-key-issues/) · [hiQ settlement](https://newmedialaw.proskauer.com/2022/12/08/hiq-and-linkedin-reach-proposed-settlement-in-landmark-scraping-case/) · [EU Database Directive 96/9/EC](https://www.wipo.int/wipolex/en/text/126788) · [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) · [FIRE on the Selzer dismissal](https://www.fire.org/news/victory-federal-district-court-dismisses-class-action-suit-against-pollster-j-ann-selzer) · [IRS restriction on campaign intervention](https://www.irs.gov/charities-non-profits/charitable-organizations/restriction-of-political-campaign-intervention-by-section-501c3-tax-exempt-organizations)

**Build & governance:** [Simon Willison on git scraping](https://simonwillison.net/2020/Oct/9/git-scraping/) · [Datasette Lite](https://github.com/simonw/datasette-lite) · [Cloudflare Pages limits](https://developers.cloudflare.com/pages/platform/limits/) · [Cloudflare R2 pricing](https://developers.cloudflare.com/r2/pricing/) · [GitHub Pages limits](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits) · [Observable Framework](https://github.com/observablehq/framework) · [Frictionless Data](https://frictionlessdata.io/) · [INN fiscal sponsorship](https://inn.org/resources/inn-fiscal-sponsorship/) · [Open Collective Foundation dissolution](https://opencollective.com/foundation/updates/announcement-we-are-dissolving-open-collective-foundation-at-the-end-of-this-year) · [Sloan Open Source in Science](https://sloan.org/programs/digital-technology/open-source-in-science) · [Press Forward infrastructure funding](https://www.pressforward.news/infrastructure25/) · [Our World in Data funding](https://ourworldindata.org/funding) · [Princeton Bridging Divides threat data](https://bridgingdivides.princeton.edu/analysis-threat-and-harassment-data-2024-election) · [Stanford Internet Observatory wind-down](https://www.techpolicy.press/what-the-fate-of-the-stanford-internet-observatory-means-for-disinformation-research/)

---

### Things I could not confirm

- **NYT's poll-tracker data endpoint and license.** Two independent 2026 models cite NYT as their poll source under CC BY 4.0, but nytimes.com blocked direct verification. If real, NYT is arguably the entity that actually inherited 538's collection role — **worth checking yourself.**
- Silver Bulletin's subscription price; whether a 2026 model has launched since July 31.
- IRE's fiscal sponsorship terms (no public page); whether an aggregator can join AAPOR's Transparency Initiative.
- Current status of Knight News Challenge, Hewlett's democracy program, Mozilla's tech fund, NSF POSE FY2026.
- Outcome of the Iowa state-court Selzer case.
- VoteHub's rate limits (undocumented).
