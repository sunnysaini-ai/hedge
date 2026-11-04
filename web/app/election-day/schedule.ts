// Election night reference data for the Nov 3, 2026 general election.
//
// Poll-closing times: statewide closing times in Eastern Time as published by
// 270toWin (https://www.270towin.com/poll-closing-times), checked Nov 3 2026.
// DST ended Nov 1, so ET = UTC-5 and PT = UTC-8 all night. Individual polling
// places can differ (and anyone in line at closing can still vote), so the
// page says so.
//
// Election office links: the FEC's directory of state election offices
// (https://www.fec.gov/introduction-campaign-finance/how-to-research-public-records/state-election-offices),
// except GA, MI and OH, whose directory paths are stale — those use the
// offices' current elections pages.
//
// Hedge does not report vote counts or call races. Nothing here is a result.

export type Wave = {
  /** ISO instant (UTC) when the LAST polls in these states close. */
  utc: string;
  et: string;
  pt: string;
  states: string[];
};

export const WAVES: Wave[] = [
  { utc: "2026-11-04T00:00:00Z", et: "7:00 PM", pt: "4:00 PM", states: ["GA", "IN", "KY", "SC", "VT", "VA"] },
  { utc: "2026-11-04T00:30:00Z", et: "7:30 PM", pt: "4:30 PM", states: ["NC", "OH", "WV"] },
  {
    utc: "2026-11-04T01:00:00Z", et: "8:00 PM", pt: "5:00 PM",
    states: ["AL", "CT", "DE", "DC", "FL", "IL", "ME", "MD", "MA", "MS", "MO", "NH", "NJ", "OK", "PA", "RI", "TN"],
  },
  { utc: "2026-11-04T01:30:00Z", et: "8:30 PM", pt: "5:30 PM", states: ["AR"] },
  {
    utc: "2026-11-04T02:00:00Z", et: "9:00 PM", pt: "6:00 PM",
    states: ["AZ", "CO", "IA", "KS", "LA", "MI", "MN", "NE", "NM", "NY", "ND", "SD", "TX", "WI", "WY"],
  },
  { utc: "2026-11-04T03:00:00Z", et: "10:00 PM", pt: "7:00 PM", states: ["MT", "NV", "UT"] },
  { utc: "2026-11-04T04:00:00Z", et: "11:00 PM", pt: "8:00 PM", states: ["CA", "ID", "OR", "WA"] },
  { utc: "2026-11-04T05:00:00Z", et: "12:00 AM", pt: "9:00 PM", states: ["HI"] },
  { utc: "2026-11-04T06:00:00Z", et: "1:00 AM", pt: "10:00 PM", states: ["AK"] },
];

/** States split across time zones: when their FIRST polls close (ET). */
export const FIRST_CLOSE: Record<string, { utc: string; et: string }> = {
  IN: { utc: "2026-11-03T23:00:00Z", et: "6:00 PM" },
  KY: { utc: "2026-11-03T23:00:00Z", et: "6:00 PM" },
  FL: { utc: "2026-11-04T00:00:00Z", et: "7:00 PM" },
  KS: { utc: "2026-11-04T01:00:00Z", et: "8:00 PM" },
  MI: { utc: "2026-11-04T01:00:00Z", et: "8:00 PM" },
  ND: { utc: "2026-11-04T01:00:00Z", et: "8:00 PM" },
  SD: { utc: "2026-11-04T01:00:00Z", et: "8:00 PM" },
  TX: { utc: "2026-11-04T01:00:00Z", et: "8:00 PM" },
  ID: { utc: "2026-11-04T03:00:00Z", et: "10:00 PM" },
  OR: { utc: "2026-11-04T03:00:00Z", et: "10:00 PM" },
  AK: { utc: "2026-11-04T05:00:00Z", et: "12:00 AM" },
};

export const STATE_NAMES: Record<string, string> = {
  AK: "Alaska", AL: "Alabama", AR: "Arkansas", AZ: "Arizona", CA: "California",
  CO: "Colorado", CT: "Connecticut", DC: "District of Columbia", DE: "Delaware",
  FL: "Florida", GA: "Georgia", HI: "Hawaii", IA: "Iowa", ID: "Idaho",
  IL: "Illinois", IN: "Indiana", KS: "Kansas", KY: "Kentucky", LA: "Louisiana",
  MA: "Massachusetts", MD: "Maryland", ME: "Maine", MI: "Michigan",
  MN: "Minnesota", MO: "Missouri", MS: "Mississippi", MT: "Montana",
  NC: "North Carolina", ND: "North Dakota", NE: "Nebraska", NH: "New Hampshire",
  NJ: "New Jersey", NM: "New Mexico", NV: "Nevada", NY: "New York", OH: "Ohio",
  OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania", RI: "Rhode Island",
  SC: "South Carolina", SD: "South Dakota", TN: "Tennessee", TX: "Texas",
  UT: "Utah", VA: "Virginia", VT: "Vermont", WA: "Washington", WI: "Wisconsin",
  WV: "West Virginia", WY: "Wyoming",
};

export const ELECTION_OFFICE: Record<string, string> = {
  AL: "https://www.sos.alabama.gov/alabama-votes",
  AK: "https://www.elections.alaska.gov/",
  AZ: "https://azsos.gov/elections",
  AR: "https://www.sos.arkansas.gov/elections",
  CA: "https://www.sos.ca.gov/elections",
  CO: "https://www.sos.state.co.us/pubs/elections/main.html",
  CT: "https://portal.ct.gov/en/SOTS/Common-Elements/V5-Template---Redesign/Elections--Voting--Home-Page",
  DE: "https://elections.delaware.gov/",
  DC: "https://www.dcboe.org/",
  FL: "https://dos.myflorida.com/elections/",
  GA: "https://sos.ga.gov/elections",
  HI: "https://elections.hawaii.gov/",
  ID: "https://sos.idaho.gov/elections-division/",
  IL: "https://www.elections.il.gov/",
  IN: "https://www.in.gov/sos/elections/",
  IA: "https://sos.iowa.gov/",
  KS: "https://www.sos.ks.gov/",
  KY: "https://elect.ky.gov/Pages/default.aspx",
  LA: "https://www.sos.la.gov/ElectionsAndVoting/Pages/default.aspx",
  ME: "https://www.maine.gov/sos/cec/elec/index.html",
  MD: "https://www.elections.maryland.gov/",
  MA: "https://www.sec.state.ma.us/ele/eleidx.htm",
  MI: "https://www.michigan.gov/sos/elections",
  MN: "https://www.sos.state.mn.us/elections-voting/",
  MS: "https://www.sos.ms.gov/index.php/elections-voting",
  MO: "https://www.sos.mo.gov/elections/",
  MT: "https://sosmt.gov/elections/",
  NE: "https://sos.nebraska.gov/index",
  NV: "https://www.nvsos.gov/sos/elections",
  NH: "https://sos.nh.gov/",
  NJ: "https://www.state.nj.us/state/elections/index.shtml",
  NM: "https://www.sos.state.nm.us/",
  NY: "https://www.elections.ny.gov/",
  NC: "https://www.ncsbe.gov/",
  ND: "https://sos.nd.gov/elections",
  OH: "https://www.ohiosos.gov/elections/",
  OK: "https://oklahoma.gov/elections.html",
  OR: "https://sos.oregon.gov/voting-elections/Pages/default.aspx",
  PA: "https://www.dos.pa.gov/VotingElections/Pages/default.aspx",
  RI: "https://elections.ri.gov/",
  SC: "https://www.scvotes.gov/",
  SD: "https://sdsos.gov/elections-voting/default.aspx",
  TN: "https://sos.tn.gov/elections",
  TX: "https://www.sos.state.tx.us/elections/index.shtml",
  UT: "https://vote.utah.gov/",
  VT: "https://sos.vermont.gov/elections/",
  VA: "https://www.elections.virginia.gov/",
  WA: "https://www.sos.wa.gov/elections/",
  WV: "https://sos.wv.gov/elections/Pages/default.aspx",
  WI: "https://elections.wi.gov/",
  WY: "https://sos.wyo.gov/Elections/Default.aspx",
};

// When to expect numbers — only states where a published source says
// something specific. Paraphrased from Al Jazeera's Nov 3 2026 explainer
// (https://www.aljazeera.com/news/2026/11/3/when-will-we-know-the-us-midterm-election-results),
// which draws on 2024 reporting patterns. Past pace is a guide, not a promise.
export const EXPECT_SOURCE = "https://www.aljazeera.com/news/2026/11/3/when-will-we-know-the-us-midterm-election-results";
export const EXPECT: Record<string, string> = {
  AK: "Mail ballots arrive over the following days, and a ranked-choice count may be needed later in November.",
  AZ: "Mail ballots dropped off on Election Day need signature checks; close races can take several days.",
  CA: "Mostly mail voting, verified over the following days; close races can take days or weeks.",
  FL: "Usually counts fast: in 2024 about 99% was in within roughly three hours of polls closing.",
  ME: "Ranked-choice: if no one clears 50%, ballots go to Augusta for further tabulation, which delays a final result.",
  NV: "Mail ballots postmarked by today can arrive up to four days later, plus six days to fix signatures; could run into next week.",
  NC: "Most mail ballots come in the first update; in 2024, 90% was reported by about 11:36 PM ET.",
  OH: "Nearly all early and absentee votes come in the first update; in 2024, 90% was reported by about 11:03 PM ET.",
  PA: "First numbers arrive at close; in 2024, 90% was reported by about 12:48 AM ET.",
  WA: "Mail voting; ballots postmarked by today keep arriving and are counted over the following days.",
  WI: "In 2024, 90% of results were in by about 2:22 AM ET.",
};
