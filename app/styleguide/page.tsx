import { COMBO_TIERS } from "@/lib/constants";

/**
 * Every token, rendered. This is how palette drift gets caught early instead of
 * argued about later. If something in the arena uses a value that is not on
 * this page, the component is wrong, not this page.
 */

const SURFACES = [
  ["--color-ink", "#08080A", "page background"],
  ["--color-ink-2", "#101014", "raised panel"],
  ["--color-ink-3", "#0C0C10", "recessed, the tap region"],
  ["--color-ink-4", "#17171D", "leaderboard row, chip inactive"],
  ["--color-hairline", "#232329", "borders on dark"],
  ["--color-hairline-hot", "#33304A", "border on an active/own row"],
] as const;

const BRAND = [
  ["--color-violet", "#836EF9", "primary accent — Monad brand"],
  ["--color-violet-deep", "#5A46C8", "pressed states, droplet edges"],
  ["--color-violet-lift", "#9C8BFF", "hover, near droplets"],
  ["--color-aqua", "#3FE0D0", "live state, combo, anything flowing"],
  ["--color-aqua-lift", "#7FE9DC", "hot droplets at high combo"],
  ["--color-amber", "#F5B33C", "records + budget warnings ONLY"],
] as const;

const DROPLETS = [
  ["--color-drop", "#9C8BFF", "near droplet"],
  ["--color-drop-edge", "#6B55E0", "mid droplet"],
  ["--color-drop-dim", "#4A3E8F", "far/background droplet"],
  ["--color-drop-hot", "#7FE9DC", "combo droplet"],
] as const;

const TEXT = [
  ["--color-paper", "#F5F3FF", "primary text, never pure white"],
  ["--color-text-2", "#A5A2B8", "secondary"],
  ["--color-text-3", "#8B8899", "tertiary"],
  ["--color-text-4", "#6A6878", "labels, meta, smallest caps"],
  ["--color-danger", "#E0524A", "claim failures, budget exhaustion"],
] as const;

function Swatches({
  title,
  rows,
}: {
  title: string;
  rows: readonly (readonly [string, string, string])[];
}) {
  return (
    <section className="mb-14">
      <p className="t-section mb-4">{title}</p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {rows.map(([token, hex, note]) => (
          <div
            key={token}
            className="flex items-center gap-4 rounded-panel border border-hairline bg-ink-2 p-3"
          >
            <span
              className="h-14 w-14 shrink-0 rounded-panel border border-hairline"
              style={{ background: `var(${token})` }}
            />
            <span className="min-w-0">
              <span className="t-chip block text-paper">{hex}</span>
              <span className="t-meta mt-1 block truncate">{token}</span>
              <span className="t-meta mt-0.5 block truncate">{note}</span>
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

export default function StyleGuide() {
  return (
    <main className="min-h-dvh bg-ink px-6 py-12 sm:px-12">
      <header className="mb-14">
        <h1 className="t-display text-paper">Styleguide</h1>
        <p className="t-meta mt-3">
          authoritative token set · app/globals.css · nothing outside this page
          may appear in the product
        </p>
      </header>

      <Swatches title="surfaces" rows={SURFACES} />
      <Swatches title="brand" rows={BRAND} />
      <Swatches title="droplets" rows={DROPLETS} />
      <Swatches title="type on dark" rows={TEXT} />

      {/* ---- type scale ---- */}
      <section className="mb-14">
        <p className="t-section mb-5">type scale — fluid, one surface</p>
        <div className="space-y-8 overflow-x-auto rounded-panel border border-hairline bg-ink-2 p-6">
          <div>
            <p className="t-hero whitespace-nowrap text-paper">128.4k</p>
            <p className="t-meta mt-2">
              hero · Archivo 900 · clamp(56px, 15vw, 132px) · tabular
            </p>
          </div>
          <div>
            <p className="t-display text-paper">0.284 MON</p>
            <p className="t-meta mt-2">display · Archivo 800 · clamp(30px, 6vw, 52px)</p>
          </div>
          <div>
            <p className="t-stat text-aqua">261.4</p>
            <p className="t-meta mt-2">stat · Archivo 800 · clamp(22px, 3.4vw, 34px)</p>
          </div>
          <div>
            <p className="t-body text-text-2">
              A testnet faucet you have to earn. Every tap is a real transaction.
            </p>
            <p className="t-meta mt-2">body · Inter · clamp(15px, 1.6vw, 18px)</p>
          </div>
          <div>
            <p className="t-label text-paper">tap · or hold</p>
            <p className="t-meta mt-2">label · JetBrains 700 · 12px · 0.08em</p>
          </div>
          <div>
            <p className="t-section">today&apos;s board</p>
            <p className="t-meta mt-2">section · JetBrains 400 · clamp(11px, 1.1vw, 14px)</p>
          </div>
          <div className="flex max-w-md items-center justify-between rounded-panel bg-ink-4 px-5 py-3">
            <span className="t-lb-addr text-text-2">0x7f2a…4b3c</span>
            <span className="t-lb-value text-paper">1,284</span>
          </div>
          <p className="t-meta">leaderboard row · value tabular, right-aligned</p>
        </div>
      </section>

      {/* ---- combo tiers ---- */}
      <section className="mb-14">
        <p className="t-section mb-5">combo tiers</p>
        <div className="flex flex-wrap gap-3">
          {COMBO_TIERS.map((tier) => {
            const hot = tier.at >= 10;
            return (
              <span
                key={tier.label}
                className="t-chip rounded-chip px-5 py-3 text-center"
                style={{
                  background: hot ? "var(--color-aqua)" : "var(--color-ink-4)",
                  color: hot ? "var(--color-ink)" : "var(--color-text-3)",
                }}
              >
                <span className="block">
                  {tier.at === 0 ? "tap" : `${tier.at}×`} {tier.label}
                </span>
                <span
                  className="t-meta mt-1 block"
                  style={hot ? { color: "var(--color-ink)", opacity: 0.62 } : undefined}
                >
                  {tier.particles} droplets
                </span>
              </span>
            );
          })}
        </div>
        <p className="t-meta mt-3">
          combo drives particle density and nothing that pays — anything that
          rewarded <em>how</em> you tap rather than <em>that</em> you tap is a
          thing a script does better than a person
        </p>
      </section>

      {/* ---- droplet sprite ---- */}
      <section className="mb-14">
        <p className="t-section mb-5">droplet sprite (static)</p>
        <div className="flex flex-wrap items-center gap-8 rounded-panel border border-hairline bg-ink-3 p-8">
          {[
            ["near", "var(--color-drop)", 1, 2.4],
            ["mid", "var(--color-drop-edge)", 0.8, 1.7],
            ["far", "var(--color-drop-dim)", 0.6, 1.2],
            ["combo", "var(--color-drop-hot)", 1, 2.4],
          ].map(([label, fill, scale, stretch]) => (
            <div key={String(label)} className="flex flex-col items-center gap-3">
              <span
                className="block rounded-full"
                style={{
                  width: 18 * Number(scale) * Number(stretch),
                  height: 18 * Number(scale),
                  background: String(fill),
                }}
              />
              <span className="t-meta">{label}</span>
            </div>
          ))}
        </div>
        <p className="t-meta mt-3">
          stretched along the direction of travel, easing off as the droplet
          slows — a round dot reads as a bubble, a stretched one reads as water
        </p>
      </section>

      {/* ---- motion ---- */}
      <section className="mb-14">
        <p className="t-section mb-5">motion</p>
        <div className="grid gap-3 sm:grid-cols-2">
          {[
            ["--ease-out", "cubic-bezier(0.16, 1, 0.3, 1)", "counters, leaderboard moves"],
            ["--ease-tap", "cubic-bezier(0.34, 1.4, 0.64, 1)", "tap press/release"],
            ["--dur-tap", "120ms", "tap target"],
            ["--dur-count", "420ms", "counters"],
            ["--dur-row", "260ms", "leaderboard row"],
          ].map(([token, value, use]) => (
            <div key={token} className="rounded-panel border border-hairline bg-ink-2 p-4">
              <p className="t-chip text-paper">{token}</p>
              <p className="t-meta mt-1">{value}</p>
              <p className="t-meta mt-0.5">{use}</p>
            </div>
          ))}
        </div>
        <p className="t-meta mt-3">
          every motion token is disabled under prefers-reduced-motion
        </p>
      </section>

      {/* ---- tabular proof ---- */}
      <section className="mb-8">
        <p className="t-section mb-5">tabular figures — no horizontal shift</p>
        <div className="rounded-panel border border-hairline bg-ink-2 p-6">
          {["999", "1,000", "11,111", "88,888"].map((n) => (
            <p key={n} className="t-display text-paper">
              {n}
            </p>
          ))}
          <p className="t-meta mt-3">
            every glyph occupies the same advance width — a counter easing past
            999 must not jitter sideways
          </p>
        </div>
      </section>
    </main>
  );
}
