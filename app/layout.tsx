import type { Metadata } from "next";
import {
  Inter,
  Inter_Tight,
  JetBrains_Mono,
  Noto_Sans_Bengali,
  Source_Serif_4,
} from "next/font/google";

import { AppShell } from "@/components/AppShell";
import { AppProvider } from "@/lib/store";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700", "800"],
  variable: "--font-inter",
  display: "swap",
});

const interTight = Inter_Tight({
  subsets: ["latin"],
  weight: ["500", "600", "700", "800"],
  variable: "--font-inter-tight",
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-jetbrains-mono",
  display: "swap",
});

// Inter carries no Bengali glyphs, and the script screens are written in
// Bangla — this keeps them legible without a system font installed.
const notoBengali = Noto_Sans_Bengali({
  subsets: ["bengali"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-noto-bengali",
  display: "swap",
});

// Reading mode sets long-form text in a serif: at 18px over a 68-character
// measure, the extra stroke contrast is what stops a page of script from
// levelling out into grey. Nothing else in the app uses it.
const sourceSerif = Source_Serif_4({
  subsets: ["latin"],
  weight: ["400", "600"],
  style: ["normal", "italic"],
  variable: "--font-source-serif",
  display: "swap",
});

export const metadata: Metadata = {
  title: "dotcontent",
  applicationName: "dotcontent",
  description:
    "Open-source content production: topics feed templates, and templates write every section. By dotmirror.",
  authors: [{ name: "dotmirror", url: "https://dotmirror.com" }],
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body
        className={`${inter.variable} ${interTight.variable} ${jetbrainsMono.variable} ${notoBengali.variable} ${sourceSerif.variable}`}
      >
        <AppProvider>
          <AppShell>{children}</AppShell>
        </AppProvider>
      </body>
    </html>
  );
}
