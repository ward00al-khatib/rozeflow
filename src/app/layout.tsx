import type { Metadata, Viewport } from "next";
import { IBM_Plex_Sans_Arabic, JetBrains_Mono, Noto_Kufi_Arabic } from "next/font/google";
import "./globals.css";

// next/font downloads these at build time and serves them from our own domain (brand guide 5.2).
const body = IBM_Plex_Sans_Arabic({
  variable: "--font-body",
  subsets: ["arabic", "latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

const heading = Noto_Kufi_Arabic({
  variable: "--font-heading",
  subsets: ["arabic"],
  weight: ["600", "700", "800"],
  display: "swap",
});

const mono = JetBrains_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  weight: ["500"],
  display: "swap",
});

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
      <body className={`${body.variable} ${heading.variable} ${mono.variable}`}>{children}</body>
    </html>
  );
}
