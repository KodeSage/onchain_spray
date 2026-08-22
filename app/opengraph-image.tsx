import { ImageResponse } from "next/og";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "Onchain Spray — spray money onchain, at Monad speed";

export default function OgImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: "#0B0B0C",
          padding: 72,
          fontFamily: "sans-serif",
        }}
      >
        {/* scattered notes */}
        <div style={{ display: "flex", position: "absolute", top: 0, left: 0 }}>
          {[
            [820, 90, -18],
            [960, 250, 12],
            [740, 330, 24],
            [1010, 60, 34],
            [880, 430, -8],
          ].map(([x, y, r], i) => (
            <div
              key={i}
              style={{
                position: "absolute",
                left: x,
                top: y,
                width: 132,
                height: 68,
                background: i % 2 === 0 ? "#14361E" : "#1B4A28",
                border: "3px solid #1F6438",
                borderRadius: 6,
                transform: `rotate(${r}deg)`,
                display: "flex",
              }}
            />
          ))}
        </div>

        <div style={{ display: "flex", color: "#16C77F", fontSize: 26, letterSpacing: 2 }}>
          ONCHAIN SPRAY
        </div>

        <div style={{ display: "flex", flexDirection: "column" }}>
          <div
            style={{
              display: "flex",
              color: "#FAF7F0",
              fontSize: 104,
              fontWeight: 900,
              lineHeight: 1,
              letterSpacing: -3,
            }}
          >
            Spray money, onchain.
          </div>
          <div style={{ display: "flex", color: "#9C9992", fontSize: 32, marginTop: 24 }}>
            Hundreds of transactions a second. No popups. No signing.
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          <div
            style={{
              display: "flex",
              background: "#E8B33A",
              color: "#0B0B0C",
              fontSize: 30,
              fontWeight: 700,
              padding: "12px 24px",
            }}
          >
            Monad testnet
          </div>
          <div style={{ display: "flex", color: "#6B6862", fontSize: 26 }}>
            built at Monad Blitz Abuja
          </div>
        </div>
      </div>
    ),
    size
  );
}
