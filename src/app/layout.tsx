import type { Metadata, Viewport } from "next";
// Fonts are bundled from npm (@fontsource) and served from our own domain (brand guide 5.2).
// No network access to Google is needed at build time.
import "@fontsource/ibm-plex-sans-arabic/400.css";
import "@fontsource/ibm-plex-sans-arabic/500.css";
import "@fontsource/ibm-plex-sans-arabic/600.css";
import "@fontsource/ibm-plex-sans-arabic/700.css";
import "@fontsource/noto-kufi-arabic/600.css";
import "@fontsource/noto-kufi-arabic/700.css";
import "@fontsource/noto-kufi-arabic/800.css";
import "@fontsource/jetbrains-mono/500.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "ROZEFLOW",
  description: "موقع ألعاب خاص بالدعوات، بنقاط افتراضية فقط.",
  // Private, invite-only site: keep it out of search engines (spec 2.2).
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: "#06080F",
  colorScheme: "dark",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ar" dir="rtl">
      <body>{children}</body>
    </html>
  );
}
