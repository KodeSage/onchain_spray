import type { Metadata, Viewport } from "next";
import { Archivo, Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";

/* Archivo carries a genuine width axis and proper tabular figures — that is why
   it is the display face. Every counter in the arena depends on those figures
   being tabular. */
const archivo = Archivo({
  subsets: ["latin"],
  display: "swap",
  axes: ["wdth"],
  variable: "--font-archivo",
});

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-inter",
});

const jetbrains = JetBrains_Mono({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-jetbrains",
});

/* Vercel sets NEXT_PUBLIC_APP_URL to an empty string when the value is blank in
   the dashboard, and `new URL("")` throws at module scope — which kills page-data
   collection for every route. Fall through anything that is not a parseable
   absolute URL. */
function resolveAppUrl(): URL {
  const candidates = [
    process.env.NEXT_PUBLIC_APP_URL,
    process.env.VERCEL_PROJECT_PRODUCTION_URL,
    process.env.VERCEL_URL,
    "http://localhost:3000",
  ];
  for (const candidate of candidates) {
    const value = candidate?.trim();
    if (!value) continue;
    try {
      return new URL(/^https?:\/\//.test(value) ? value : `https://${value}`);
    } catch {
      continue;
    }
  }
  return new URL("http://localhost:3000");
}

const appUrl = resolveAppUrl();

export const metadata: Metadata = {
  metadataBase: appUrl,
  title: "Tap — Monad testnet faucet",
  description:
    "A testnet faucet you have to earn. Tap in a live global arena where every " +
    "tap is a real transaction, then claim your MON. No wallet popups, ever.",
  openGraph: {
    title: "Tap — Monad testnet faucet",
    description:
      "A testnet faucet you have to earn. Every tap is a real transaction on Monad.",
  },
  icons: { icon: "/icon.svg" },
};

export const viewport: Viewport = {
  themeColor: "#08080A",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  // the tap target is hammered; never let a double-tap zoom the page
  userScalable: false,
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body
        className={`${archivo.variable} ${inter.variable} ${jetbrains.variable}`}
      >
        {children}
      </body>
    </html>
  );
}
