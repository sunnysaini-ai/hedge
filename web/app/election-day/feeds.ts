import { unstable_cache } from "next/cache";

// Live, OFFICIAL election-night counts, read straight from state election
// offices' public results files. Only states whose office publishes a clean
// machine-readable statewide file are here; everything else is linked out.
//
//   NC  State Board of Elections   er.ncsbe.gov/enr/20261103/data/results_0.txt   (JSON)
//   FL  Division of Elections      flelectionfiles.floridados.gov/enightfilespublic/20261103_ElecResultsFL.txt (TSV, per county)
//   MN  Secretary of State         electionresultsfiles.sos.mn.gov/20261103/{ussenate,governor}.txt (semicolon)
//
// What these files report is PRECINCTS reporting and votes counted so far.
// They do not (and cannot) say what share of the expected vote is in — that
// is a media estimate. Hedge shows exactly what the office publishes and
// never calls a race.
//
// Each feed is cached for 60 s (one upstream request per minute at most, no
// matter the traffic) and fails soft: a broken feed shows as "unavailable",
// never as zero.

export type Party = "D" | "R" | "O";
export type CandidateCount = { name: string; party: Party; partyLabel: string; votes: number };
export type RaceCount = {
  office: "senate" | "governor";
  precinctsReporting: number;
  precinctsTotal: number;
  totalVotes: number;
  candidates: CandidateCount[];
};
export type StateCount = {
  state: string;
  sourceName: string;
  sourceUrl: string; // human-readable results page
  fileUrls: string[];
  fileUpdated: string | null; // upstream Last-Modified, ISO
  fetchedAt: string; // when Hedge last read the file, ISO
  races: RaceCount[];
  error: string | null;
};

const UA = "Hedge election-night tracker (+https://choosehedge.com/election-day)";

async function getText(url: string): Promise<{ text: string; lastModified: string | null }> {
  // The states' CDNs (CloudFront, Akamai) hand plain requests a stale cached
  // copy — on election night NC's edge was still serving a Nov 1 file. A
  // per-minute cache-buster plus no-cache headers reaches the origin. This
  // runs at most once a minute per file (see the cache at the bottom).
  const bust = `${url.includes("?") ? "&" : "?"}hedge=${Math.floor(Date.now() / 60000)}`;
  const res = await fetch(url + bust, {
    cache: "no-store", // caching happens one level up, on the parsed result
    headers: { "User-Agent": UA, "Cache-Control": "no-cache", Pragma: "no-cache" },
    signal: AbortSignal.timeout(9000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const lm = res.headers.get("last-modified");
  return { text: await res.text(), lastModified: lm ? new Date(lm).toISOString() : null };
}

function latest(dates: (string | null)[]): string | null {
  const ok = dates.filter((d): d is string => !!d).sort();
  return ok.length ? ok[ok.length - 1] : null;
}

function partyOf(code: string): { party: Party; label: string } {
  const c = code.trim().toUpperCase();
  if (c === "DEM" || c === "DFL" || c === "D") return { party: "D", label: c === "DFL" ? "DFL" : "D" };
  if (c === "REP" || c === "R") return { party: "R", label: "R" };
  return { party: "O", label: c || "—" };
}

function toInt(s: string | undefined): number {
  const n = parseInt((s ?? "").replace(/[^0-9-]/g, ""), 10);
  return Number.isFinite(n) ? n : 0;
}

function finishRace(office: RaceCount["office"], pr: number, pt: number, cands: CandidateCount[]): RaceCount {
  const totalVotes = cands.reduce((n, c) => n + c.votes, 0);
  const order = (c: CandidateCount) => (c.party === "D" ? 0 : c.party === "R" ? 1 : 2);
  // Fixed order (D, R, then others by votes) — never sorted by who is ahead.
  cands.sort((a, b) => order(a) - order(b) || b.votes - a.votes);
  return { office, precinctsReporting: pr, precinctsTotal: pt, totalVotes, candidates: cands };
}

// ---------- North Carolina ----------
const NC_FILE = "https://er.ncsbe.gov/enr/20261103/data/results_0.txt";
async function nc(): Promise<StateCount> {
  const base = {
    state: "NC",
    sourceName: "NC State Board of Elections",
    sourceUrl: "https://er.ncsbe.gov/?election_dt=11/03/2026",
    fileUrls: [NC_FILE],
  };
  const { text, lastModified } = await getText(NC_FILE);
  const rows = JSON.parse(text) as Record<string, string>[];
  const sen = rows.filter((r) => /^US SENATE/i.test(r.cnm ?? ""));
  if (!sen.length) throw new Error("US Senate contest not found in file");
  const cands = sen.map((r) => {
    const p = partyOf(r.pty);
    return { name: r.bnm, party: p.party, partyLabel: p.label, votes: toInt(r.vct) };
  });
  const race = finishRace("senate", toInt(sen[0].prt), toInt(sen[0].ptl), cands);
  return { ...base, fileUpdated: lastModified, fetchedAt: new Date().toISOString(), races: [race], error: null };
}

// ---------- Florida (one row per candidate per county) ----------
const FL_FILE = "https://flelectionfiles.floridados.gov/enightfilespublic/20261103_ElecResultsFL.txt";
async function fl(): Promise<StateCount> {
  const base = {
    state: "FL",
    sourceName: "Florida Division of Elections",
    sourceUrl: "https://results.elections.myflorida.com/",
    fileUrls: [FL_FILE],
  };
  const { text, lastModified } = await getText(FL_FILE);
  const lines = text.split(/\r?\n/).filter(Boolean);
  const head = lines[0].split("\t").map((h) => h.trim());
  const col = (n: string) => {
    const i = head.indexOf(n);
    if (i < 0) throw new Error(`column ${n} missing`);
    return i;
  };
  const iRace = col("RaceCode"), iCounty = col("CountyCode"), iP = col("Precincts"),
    iPR = col("PrecinctsReporting"), iLast = col("CanNameLast"), iFirst = col("CanNameFirst"),
    iMid = col("CanNameMiddle"), iVotes = col("CanVotes"), iParty = col("PartyCode");

  const races: RaceCount[] = [];
  for (const [code, office] of [["USS", "senate"], ["GOV", "governor"]] as const) {
    const byCand = new Map<string, CandidateCount>();
    const byCounty = new Map<string, { p: number; pr: number }>();
    for (let k = 1; k < lines.length; k++) {
      const f = lines[k].split("\t");
      if ((f[iRace] ?? "").trim() !== code) continue;
      const name = [f[iFirst], f[iMid], f[iLast]].map((s) => (s ?? "").trim()).filter(Boolean).join(" ");
      const p = partyOf(f[iParty] ?? "");
      const key = `${name}|${p.label}`;
      const c = byCand.get(key) ?? { name, party: p.party, partyLabel: p.label, votes: 0 };
      c.votes += toInt(f[iVotes]);
      byCand.set(key, c);
      // Precinct counts repeat on every candidate row for a county — take once.
      if (!byCounty.has(f[iCounty])) byCounty.set(f[iCounty], { p: toInt(f[iP]), pr: toInt(f[iPR]) });
    }
    if (!byCand.size) continue;
    let p = 0, pr = 0;
    byCounty.forEach((v) => { p += v.p; pr += v.pr; });
    races.push(finishRace(office, pr, p, Array.from(byCand.values())));
  }
  if (!races.length) throw new Error("Senate/governor contests not found in file");
  return { ...base, fileUpdated: lastModified, fetchedAt: new Date().toISOString(), races, error: null };
}

// ---------- Minnesota (statewide rows, ';'-delimited) ----------
const MN_FILES = {
  senate: "https://electionresultsfiles.sos.mn.gov/20261103/ussenate.txt",
  governor: "https://electionresultsfiles.sos.mn.gov/20261103/governor.txt",
} as const;
async function mn(): Promise<StateCount> {
  const base = {
    state: "MN",
    sourceName: "Minnesota Secretary of State",
    sourceUrl: "https://electionresults.sos.mn.gov/",
    fileUrls: [MN_FILES.senate, MN_FILES.governor],
  };
  const races: RaceCount[] = [];
  const mods: (string | null)[] = [];
  for (const office of ["senate", "governor"] as const) {
    const { text, lastModified } = await getText(MN_FILES[office]);
    mods.push(lastModified);
    // state;county;precinct;officeId;office;district;candId;name;suffix;incumbent;party;
    // precinctsReporting;totalPrecincts;votes;pct;totalVotesForOffice
    const rows = text.split(/\r?\n/).filter(Boolean).map((l) => l.split(";"));
    const good = rows.filter((f) => f.length >= 16 && f[0] === "MN");
    if (!good.length) throw new Error(`${office} file empty or malformed`);
    const cands = good
      .filter((f) => !/write-?in/i.test(f[7] ?? "") || toInt(f[13]) > 0)
      .map((f) => {
        const p = partyOf(f[10]);
        return { name: (f[7] ?? "").trim(), party: p.party, partyLabel: p.label, votes: toInt(f[13]) };
      });
    races.push(finishRace(office, toInt(good[0][11]), toInt(good[0][12]), cands));
  }
  return { ...base, fileUpdated: latest(mods), fetchedAt: new Date().toISOString(), races, error: null };
}

const FEEDS: Record<string, () => Promise<StateCount>> = { NC: nc, FL: fl, MN: mn };

/** Static source info, so a failed feed still links to the right office. */
export const FEED_META: Record<string, { sourceName: string; sourceUrl: string }> = {
  NC: { sourceName: "NC State Board of Elections", sourceUrl: "https://er.ncsbe.gov/?election_dt=11/03/2026" },
  FL: { sourceName: "Florida Division of Elections", sourceUrl: "https://results.elections.myflorida.com/" },
  MN: { sourceName: "Minnesota Secretary of State", sourceUrl: "https://electionresults.sos.mn.gov/" },
};
export const COUNTED_STATES = Object.keys(FEEDS);

async function readAll(): Promise<StateCount[]> {
  return Promise.all(
    Object.entries(FEEDS).map(async ([state, fn]) => {
      try {
        return await fn();
      } catch (e) {
        return {
          state, ...FEED_META[state], fileUrls: [], fileUpdated: null,
          fetchedAt: new Date().toISOString(), races: [],
          error: e instanceof Error ? e.message : "unavailable",
        } satisfies StateCount;
      }
    }),
  );
}

/** Parsed counts for every feed, cached 60 s across all visitors. */
export const getOfficialCounts = unstable_cache(readAll, ["official-counts-20261103-v2"], { revalidate: 60 });
