// Shared display formatting for archived 538/ABC News numeric pollster grades
// (0–3 scale), used by the Key races card, the state-map tooltip, and race pages.
//
// Why this is a number and not a "B+"-style letter: the archived ratings file
// Hedge ingests (data/raw/538_pollster_ratings.csv, mirrored into
// pollsters.fte_numeric_grade and race_averages.avg_grade) carries ONLY
// numeric_grade — 0.5 to 3.0 in 0.1 steps — with no letter-grade column
// anywhere in the dataset. With no real numeric→letter pairs to derive
// thresholds from, publishing our own A/B/C cutoffs would be invented
// precision, which is exactly what Hedge exists not to do. So we show the
// number on its own scale ("2.0 / 3.0") until a source with genuine letter
// grades is ingested.
export function formatGrade(n: number): string {
  return `${n.toFixed(1)} / 3.0`;
}
