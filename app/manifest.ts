import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Otthon – családi irányítópult",
    short_name: "Otthon",
    description: "Naptár, házimunka és bevásárlólista egy helyen.",
    start_url: "/",
    display: "standalone",
    background_color: "#f6f4fb",
    theme_color: "#6d4aff",
    orientation: "portrait",
    icons: [
      { src: "/app-icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/app-icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}
