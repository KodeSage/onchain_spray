import Link from "next/link";
import JoinForm from "./JoinForm";

export default function Home() {
  return (
    <main className="flex min-h-dvh flex-col justify-between bg-ink px-6 py-10 sm:px-12">
      <header className="flex items-baseline justify-between">
        <p className="t-tap-label text-green">Onchain Spray</p>
        <p className="t-meta">Monad testnet</p>
      </header>

      <section className="mx-auto w-full max-w-3xl py-16">
        <h1
          className="text-paper"
          style={{
            fontFamily: "var(--font-display), sans-serif",
            fontWeight: 900,
            fontSize: "clamp(44px, 9vw, 108px)",
            lineHeight: 0.94,
            letterSpacing: "-0.03em",
          }}
        >
          Spray money,
          <br />
          onchain.
        </h1>

        <p
          className="mt-8 max-w-xl text-text-2"
          style={{ fontSize: 19, lineHeight: 1.5 }}
        >
          At a Nigerian party you don&apos;t send one transfer — you spray
          hundreds of small notes, as fast as the music. Every note here is a
          real transaction.
        </p>

        <div className="mt-12">
          <JoinForm />
        </div>

        <p className="t-meta mt-6">
          no wallet · no popups · no signing · just tap
        </p>
      </section>

      <footer className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex gap-6">
          <Link href="/stage/0" className="t-meta hover:text-text-2">
            projector view →
          </Link>
          <Link href="/styleguide" className="t-meta hover:text-text-2">
            styleguide →
          </Link>
        </div>
        <p className="t-meta">built at Monad Blitz Abuja</p>
      </footer>
    </main>
  );
}
