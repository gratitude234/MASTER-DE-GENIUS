import type { Metadata, Viewport } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans, Source_Serif_4 } from "next/font/google";
import "./globals.css";
import { PwaManager } from "@/components/pwa/pwa-manager";

/*
 * The three approved faces, self-hosted by next/font: IBM Plex Sans for the
 * interface, Source Serif 4 for headings, IBM Plex Mono for every number a
 * student compares. Self-hosting matters twice over — no third-party request on
 * a slow Nigerian connection, and the files sit under /_next/static, which the
 * service worker already caches for offline use.
 */
const sans = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-sans",
  display: "swap",
});

const serif = Source_Serif_4({
  subsets: ["latin"],
  weight: ["400", "600", "700"],
  variable: "--font-serif",
  display: "swap",
});

const mono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["500", "600"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "MASTER@DE'GENIUS",
    template: "%s · MASTER@DE'GENIUS",
  },
  description: "Mobile-first exam preparation and CBT for Nigerian students.",
  icons: { apple: "/icons/apple-touch-icon.png" },
  applicationName: "MASTER@DE'GENIUS",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "DE'GENIUS",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#0B1220",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${sans.variable} ${serif.variable} ${mono.variable}`}>
      <body><PwaManager />{children}</body>
    </html>
  );
}
