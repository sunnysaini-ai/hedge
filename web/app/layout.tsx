import type { Metadata } from "next";

const DESCRIPTION = "Free, open, auditable US polling averages — no forecasts.";

export const metadata: Metadata = {
  metadataBase: new URL("https://choosehedge.com"),
  title: {
    default: "Hedge — US polling averages",
    template: "%s — Hedge",
  },
  description: DESCRIPTION,
  openGraph: {
    title: "Hedge — US polling averages",
    description: DESCRIPTION,
    siteName: "Hedge",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Hedge — US polling averages",
    description: DESCRIPTION,
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="sitehead">
          <div className="sitehead-inner">
            <a href="/" className="sitehead-brand">Hedge</a>
            <nav className="sitehead-nav">
              <a href="/pollsters">Pollsters</a>
              <a href="/methodology">Methodology</a>
              <a href="/about">About</a>
            </nav>
          </div>
        </header>
        {children}

        <style>{`
          :root { --surface-0:#f6f5f2; --surface-1:#fcfcfb; --line:#e3e1db;
            --text-primary:#0b0b0b; --text-secondary:#52514e;
            --dem:#2a78d6; --rep:#e34948;
            --approve:#1baf7a; --disapprove:#e0793c; }
          body { margin:0; background:var(--surface-0); color:var(--text-primary);
            font-family:ui-sans-serif,-apple-system,"Segoe UI",Roboto,sans-serif; }

          .sitehead { border-bottom:1px solid var(--line); background:var(--surface-1); }
          .sitehead-inner { max-width:900px; margin:0 auto; padding:14px 20px;
            display:flex; align-items:center; justify-content:space-between; gap:16px; }
          .sitehead-brand { font-weight:700; font-size:.95rem; color:var(--text-primary);
            text-decoration:none; }
          .sitehead-nav { display:flex; gap:18px; flex-wrap:wrap; }
          .sitehead-nav a { color:var(--text-secondary); text-decoration:none; font-size:.84rem; }
          .sitehead-nav a:hover { color:var(--text-primary); text-decoration:underline; }
        `}</style>
      </body>
    </html>
  );
}
