import type { Metadata } from "next";
import { Archivo, IBM_Plex_Mono, Public_Sans } from "next/font/google";

import "./globals.css";

/**
 * Three roles, all from the public-information / signage lineage:
 *   Archivo      — display. A signage grotesque; carries headlines at heavy
 *                  weight with tight tracking.
 *   Public Sans  — body. Designed for government public-information use, so it
 *                  stays legible at the small sizes job titles live at.
 *   Plex Mono    — data. Route labels, counts, eyebrows. Its plotted, technical
 *                  quality suits the map metaphor.
 */
const archivo = Archivo({
  subsets: ["latin"],
  variable: "--font-archivo",
  display: "swap",
});

const publicSans = Public_Sans({
  subsets: ["latin"],
  variable: "--font-public-sans",
  display: "swap",
});

const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  variable: "--font-plex-mono",
  weight: ["400", "500"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Referral Finder — find the people who can refer you",
  description:
    "Match your own LinkedIn connections against open roles, and see which companies are hiring where you already know someone.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    // The next/font variables must be declared on <html>, not <body>. Custom
    // properties resolve where they are *declared*, and globals.css's @theme
    // block declares --font-heading: var(--font-archivo) on :root — so if
    // --font-archivo only exists on <body>, that lookup fails at :root and the
    // whole token becomes invalid for every element beneath it.
    <html
      lang="en"
      className={`${archivo.variable} ${publicSans.variable} ${plexMono.variable}`}
    >
      <body className="min-h-dvh antialiased">{children}</body>
    </html>
  );
}
