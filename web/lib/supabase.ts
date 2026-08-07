import { createClient } from "@supabase/supabase-js";

// Public, read-only client — uses the anon key, protected by the
// "public read" RLS policies in supabase/schema.sql. Never put the
// service_role key in this file or anywhere that ships to the browser.
//
// Fallbacks below are the real project's public URL + anon key — safe to
// commit, since every table is RLS-protected to read-only for this key.
// Set NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY in the
// Vercel project settings to override (e.g. pointing at a different
// environment) without touching code.
export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || "https://nrmkbelmxgngosykmdnx.supabase.co",
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "sb_publishable_NKOBCd4a3xoKXcpXEnC4UQ_MzNiC-CL",
  { auth: { persistSession: false } }
);

export type Poll = {
  id: string;
  poll_type: string;
  subject: string | null;
  pollster_raw: string;
  end_date: string;
  sample_size: number | null;
  source_url: string | null;
};

export type Pollster = {
  id: string;
  display_name: string;
  aliases: string[];
  fte_numeric_grade: number | null;
  fte_pollscore: number | null;
  fte_transparency: number | null;
};

export type RaceAverage = {
  state: string; // 2-letter postal code
  office: "senate" | "governor";
  cycle: number;
  dem_candidate: string | null;
  rep_candidate: string | null;
  dem_pct: number;
  rep_pct: number;
  margin: number; // dem minus rep
  leader_party: "D" | "R" | null;
  polls_used: number;
  latest_poll: string | null;
  low_data: boolean;
};

export type GenericBallotDay = {
  date: string;
  dem: number;
  rep: number;
  margin: number;
  polls_in_window: number;
};

export type ApprovalDay = {
  subject: string; // "Donald Trump" | "Congress" | "Supreme Court" | "JD Vance"
  date: string; // YYYY-MM-DD
  approve_pct: number;
  disapprove_pct: number;
  net: number; // approve minus disapprove
  polls_in_window: number;
};
