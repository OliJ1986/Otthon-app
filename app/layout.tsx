import type { Metadata, Viewport } from "next";
import "@ionic/react/css/core.css";
import "@ionic/react/css/normalize.css";
import "@ionic/react/css/structure.css";
import "@ionic/react/css/typography.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "Otthon",
  description: "A család közös irányítópultja.",
  applicationName: "Otthon",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Otthon",
  },
  other: { "mobile-web-app-capable": "yes" },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
    apple: "/app-icon-192.png",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f8f5ff" },
    { media: "(prefers-color-scheme: dark)", color: "#12101d" },
  ],
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="hu">
      <body>{children}</body>
    </html>
  );
}
