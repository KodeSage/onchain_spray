import type { Metadata, Viewport } from "next";
import { Archivo, Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";

/* Archivo carries a genuine width axis and proper tabular figures — that is why
   it is the display face. Every counter on the projector depends on those
   figures being tabular. */
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

const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

export const metadata: Metadata = {
  metadataBase: new URL(appUrl),
  title: "Onchain Spray",
  description:
    "Spray money onchain. Nigerian owambe culture at Monad speed — thousands of micro-transactions a minute.",
  openGraph: {
    title: "Onchain Spray",
    description:
      "Spray money onchain. Nigerian owambe culture at Monad speed.",
    images: ["/og.png"],
  },
  icons: { icon: "/icon.svg" },
};

export const viewport: Viewport = {
  themeColor: "#0B0B0C",
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
