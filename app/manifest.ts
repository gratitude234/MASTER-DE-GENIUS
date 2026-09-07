import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "MASTER@DE'GENIUS",
    short_name: "DE'GENIUS",
    description: "Exam preparation and CBT for Nigerian students.",
    id: "/",
    scope: "/",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    start_url: "/home",
    display: "standalone",
    background_color: "#F6F7FA",
    theme_color: "#0B1220",
    orientation: "portrait-primary",
  };
}
