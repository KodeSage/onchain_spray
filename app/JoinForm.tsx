"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function JoinForm() {
  const router = useRouter();
  const [partyId, setPartyId] = useState("0");
  const [going, setGoing] = useState(false);

  return (
    <form
      className="flex flex-wrap items-stretch gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        const id = Number.parseInt(partyId, 10);
        if (!Number.isFinite(id) || id < 0) return;
        setGoing(true);
        router.push(`/spray/${id}`);
      }}
    >
      <label className="sr-only" htmlFor="party">
        Party number
      </label>
      <input
        id="party"
        inputMode="numeric"
        value={partyId}
        onChange={(e) => setPartyId(e.target.value.replace(/[^0-9]/g, ""))}
        className="t-chip w-28 rounded-chip border border-hairline bg-ink-4 px-5 text-center text-paper outline-none focus:border-green"
        style={{ fontSize: 15, paddingBlock: 18 }}
        aria-label="Party number"
      />
      <button
        type="submit"
        disabled={going}
        className="t-chip rounded-chip bg-green px-10 text-ink transition-transform disabled:opacity-70"
        style={{
          fontSize: 15,
          paddingBlock: 18,
          transitionDuration: "var(--dur-tap)",
          transitionTimingFunction: "var(--ease-tap)",
        }}
      >
        {going ? "joining…" : "join the party"}
      </button>
    </form>
  );
}
