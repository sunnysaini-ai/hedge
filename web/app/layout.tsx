export const metadata = { title: "Hedge", description: "A free, open, auditable database of US political polls." };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
