import { ImageResponse } from "next/og";

export const alt = "Hedge — US polling averages";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// Static site-wide OG image — no dynamic params, no network fetches (default
// bundled font covers plain Latin text), so this renders the same for every
// route that doesn't ship its own opengraph-image.
export default function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          backgroundColor: "#f6f5f2",
        }}
      >
        <div style={{ display: "flex", width: "100%", height: 16 }}>
          <div style={{ display: "flex", width: "50%", height: "100%", backgroundColor: "#2a78d6" }} />
          <div style={{ display: "flex", width: "50%", height: "100%", backgroundColor: "#e34948" }} />
        </div>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            flex: 1,
            justifyContent: "center",
            padding: "0 90px",
          }}
        >
          <div style={{ display: "flex", fontSize: 128, fontWeight: 700, color: "#0b0b0b" }}>
            Hedge
          </div>
          <div style={{ display: "flex", fontSize: 36, color: "#52514e", marginTop: 20 }}>
            US polling averages — free, open, auditable
          </div>
        </div>
      </div>
    ),
    { ...size }
  );
}
