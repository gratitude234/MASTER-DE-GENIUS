import type { Metadata, Viewport } from "next";
import "./globals.css";
import { PwaManager } from "@/components/pwa/pwa-manager";

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
  themeColor: "#0F172A",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body><PwaManager />{children}</body>
    </html>
  );
}
