"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";

/**
 * The join code, parked in a corner and always visible.
 *
 * Rendered from the live origin rather than a build-time constant, so it can
 * never encode localhost on the deployed host — which would mean nobody in the
 * room can scan it, and there is no demo.
 */
export default function JoinQr({ partyId }: { partyId: number }) {
  const [src, setSrc] = useState<string>("");
  const [url, setUrl] = useState<string>("");

  useEffect(() => {
    const origin =
      process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") || window.location.origin;
    const target = `${origin}/spray/${partyId}`;
    setUrl(target);

    QRCode.toDataURL(target, {
      errorCorrectionLevel: "M",
      margin: 1,
      width: 512,
      color: { dark: "#0B0B0C", light: "#FAF7F0" },
    })
      .then(setSrc)
      .catch(() => setSrc(""));
  }, [partyId]);

  return (
    <div className="flex flex-col items-center gap-3">
      <div className="rounded-panel bg-paper p-3">
        {src ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={src} alt={`Join party ${partyId}`} width={230} height={230} />
        ) : (
          <div className="h-[230px] w-[230px] bg-paper" />
        )}
      </div>
      <p className="t-section text-center leading-tight">
        scan to spray
        <br />
        <span className="text-text-4/70">{url.replace(/^https?:\/\//, "")}</span>
      </p>
    </div>
  );
}
