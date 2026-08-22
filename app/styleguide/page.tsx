import { DENOMINATIONS } from "@/lib/constants";

/**
 * Every token, rendered. This is how palette drift gets caught at hour six
 * instead of argued about. If something on /spray or /stage uses a value that
 * is not on this page, the component is wrong, not this page.
 */

const SURFACES = [
  ["--color-ink", "#0B0B0C", "page background"],
  ["--color-ink-2", "#141416", "raised panel"],
  ["--color-ink-3", "#101012", "recessed, tap region"],
  ["--color-ink-4", "#1C1C1F", "leaderboard row, chip inactive"],
  ["--color-hairline", "#232326", "borders on dark"],
] as const;

const BRAND = [
  ["--color-green", "#16C77F", "primary accent, active states"],
  ["--color-green-deep", "#0E7A4E", "note edge, pressed states"],
  ["--color-gold", "#E8B33A", "tx/sec + big-spray takeover ONLY"],
] as const;

const NOTES = [
  ["--color-note-fill", "#14361E", "particle body"],
  ["--color-note-edge", "#1F6438", "particle edge"],
  ["--color-note-fill-hi", "#1B4A28", "in flight, near camera"],
  ["--color-note-edge-hi", "#20613A", "in flight edge"],
  ["--color-note-dim", "#173B21", "far/background particles"],
] as const;

const TEXT = [
  ["--color-paper", "#FAF7F0", "primary text, never pure white"],
  ["--color-text-2", "#9C9992", "secondary"],
  ["--color-text-3", "#8F8C86", "tertiary"],
  ["--color-text-4", "#6B6862", "labels, meta, smallest caps"],
  ["--color-danger", "#C0392B", "internal/debug only, never in the demo"],
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
        <h1 className="t-personal-total text-paper">Styleguide</h1>
        <p className="t-meta mt-3">
          authoritative token set · app/globals.css · nothing outside this page
          may appear in the product
        </p>
      </header>

      <Swatches title="surfaces" rows={SURFACES} />
      <Swatches title="brand" rows={BRAND} />
      <Swatches title="naira notes" rows={NOTES} />
      <Swatches title="type on dark" rows={TEXT} />

      {/* ---- type scales ---- */}
      <section className="mb-14">
        <p className="t-section mb-5">type scale — phone (/spray)</p>
        <div className="space-y-6 rounded-panel border border-hairline bg-ink-2 p-6">
          <div>
            <p className="t-personal-total text-paper">₦1,204,500</p>
            <p className="t-meta mt-2">personal total · Archivo 800 · 40/1.0 · tabular</p>
          </div>
          <div>
            <p className="t-chip text-paper">₦500</p>
            <p className="t-meta mt-2">denomination chip · JetBrains 700 · 13px</p>
          </div>
          <div>
            <p className="t-tap-label text-paper">tap to spray · hold to pour</p>
            <p className="t-meta mt-2">tap label · JetBrains 700 · 12px · 0.08em</p>
          </div>
          <div>
            <p className="t-party">party #0</p>
            <p className="t-meta mt-2">party name · JetBrains 400 · 10px</p>
          </div>
          <div>
            <p className="t-meta">0x7f2a…4b3c · 214/220 sent</p>
            <p className="t-meta mt-2">meta line · JetBrains 400 · 9px</p>
          </div>
        </div>
      </section>

      <section className="mb-14">
        <p className="t-section mb-5">type scale — projector (/stage)</p>
        <div className="space-y-8 overflow-x-auto rounded-panel border border-hairline bg-ink-2 p-6">
          <div>
            <p className="t-total whitespace-nowrap text-paper">₦8,750,000</p>
            <p className="t-meta mt-2">total sprayed · Archivo 900 · 128/0.95 · tabular</p>
          </div>
          <div>
            <span className="inline-block bg-gold px-6 py-4">
              <span className="t-tps" style={{ color: "var(--color-ink)" }}>
                261.4
              </span>
            </span>
            <p className="t-meta mt-2">tx/sec · Archivo 800 · 48px · gold block, ink text</p>
          </div>
          <div>
            <p className="t-section">top sprayers</p>
            <p className="t-meta mt-2">section label · JetBrains 400 · 18px</p>
          </div>
          <div className="flex max-w-md items-center justify-between rounded-panel bg-ink-4 px-5 py-3">
            <span className="t-lb-addr text-text-2">0x7f2a…4b3c</span>
            <span className="t-lb-value text-paper">₦412,000</span>
          </div>
          <p className="t-meta">leaderboard row · 24px · value tabular, right-aligned</p>
        </div>
      </section>

      {/* ---- chip states ---- */}
      <section className="mb-14">
        <p className="t-section mb-5">chip states</p>
        <div className="flex flex-wrap gap-3">
          {DENOMINATIONS.map((d, i) => (
            <span
              key={d.id}
              className={[
                "t-chip rounded-chip border px-8 py-4",
                i === 1
                  ? "border-green bg-green text-ink"
                  : "border-hairline bg-ink-4 text-text-2",
              ].join(" ")}
            >
              {d.label}
            </span>
          ))}
          <span className="t-chip rounded-chip border border-green-deep bg-green-deep px-8 py-4 text-paper">
            pressed
          </span>
        </div>
      </section>

      {/* ---- note sprite ---- */}
      <section className="mb-14">
        <p className="t-section mb-5">note sprite (static)</p>
        <div className="flex flex-wrap items-center gap-6 rounded-panel border border-hairline bg-ink-3 p-8">
          {[
            ["near", "var(--color-note-fill-hi)", "var(--color-note-edge-hi)", 1],
            ["mid", "var(--color-note-fill)", "var(--color-note-edge)", 0.8],
            ["far", "var(--color-note-dim)", "var(--color-note-edge)", 0.55],
          ].map(([label, fill, edge, scale]) => (
            <div key={String(label)} className="flex flex-col items-center gap-3">
              <span
                className="relative block rounded-[4px] border"
                style={{
                  width: 116 * Number(scale),
                  height: 60 * Number(scale),
                  background: String(fill),
                  borderColor: String(edge),
                }}
              >
                <span
                  className="absolute inset-[6px] rounded-[2px] border"
                  style={{ borderColor: "var(--color-gold)", opacity: 0.45 }}
                />
              </span>
              <span className="t-meta">{label}</span>
            </div>
          ))}
        </div>
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
      </section>

      {/* ---- tabular proof ---- */}
      <section className="mb-8">
        <p className="t-section mb-5">tabular figures — no horizontal shift</p>
        <div className="rounded-panel border border-hairline bg-ink-2 p-6">
          {["₦999", "₦1,000", "₦11,111", "₦88,888"].map((n) => (
            <p key={n} className="t-personal-total text-paper">
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
