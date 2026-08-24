import { ImageResponse } from "next/og";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "Tap — a Monad testnet faucet you have to earn";

/**
 * Rendered at build time by Satori, which supports a deliberately small subset
 * of CSS: flex only, no gradients worth trusting, no external assets. The
 * droplets are plain positioned circles for that reason, not an SVG import.
 */
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
          background: "#08080A",
          padding: 72,
          fontFamily: "sans-serif",
        }}
      >
        {/* a scatter of droplets, falling toward the lower right */}
        <div style={{ display: "flex", position: "absolute", top: 0, left: 0 }}>
          {[
            [840, 70, 30, "#836EF9"],
            [960, 180, 20, "#6B55E0"],
            [1040, 300, 34, "#3FE0D0"],
            [880, 330, 16, "#4A3E8F"],
            [1100, 120, 22, "#9C8BFF"],
            [790, 210, 13, "#4A3E8F"],
            [1010, 440, 26, "#6B55E0"],
            [910, 490, 15, "#836EF9"],
          ].map(([x, y, r, colour], i) => (
            <div
              key={i}
              style={{
                position: "absolute",
                left: Number(x),
                top: Number(y),
                width: Number(r) * 2.1,
                height: Number(r),
                borderRadius: Number(r),
                background: String(colour),
                opacity: 0.9,
              }}
            />
          ))}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          <div
            style={{
              width: 14,
              height: 14,
              borderRadius: 14,
              background: "#3FE0D0",
              display: "flex",
            }}
          />
          <div style={{ color: "#6A6878", fontSize: 24, letterSpacing: 2 }}>
            MONAD TESTNET FAUCET
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column" }}>
          <div
            style={{
              color: "#F5F3FF",
              fontSize: 132,
              fontWeight: 900,
              letterSpacing: -4,
              lineHeight: 1,
              display: "flex",
            }}
          >
            Earn your
          </div>
          <div
            style={{
              color: "#836EF9",
              fontSize: 132,
              fontWeight: 900,
              letterSpacing: -4,
              lineHeight: 1,
              display: "flex",
            }}
          >
            testnet MON.
          </div>
          <div
            style={{
              color: "#A5A2B8",
              fontSize: 30,
              marginTop: 26,
              maxWidth: 720,
              display: "flex",
            }}
          >
            A live global arena where every tap is a real transaction. No wallet
            popups, ever.
          </div>
        </div>

        <div style={{ display: "flex", color: "#6A6878", fontSize: 22 }}>
          tap · hold · claim
        </div>
      </div>
    ),
    size
  );
}
