import type { Metadata, Viewport } from "next";
import { IBM_Plex_Mono, Instrument_Serif, Public_Sans } from "next/font/google";
import "./globals.css";

const display = Instrument_Serif({ weight: ["400"], style: ["normal", "italic"], subsets: ["latin"], variable: "--font-display", display: "swap" });
const ui = Public_Sans({ weight: ["400", "500", "600"], subsets: ["latin"], variable: "--font-ui", display: "swap" });
const mono = IBM_Plex_Mono({ weight: ["400", "500"], subsets: ["latin"], variable: "--font-mono", display: "swap" });

export const metadata: Metadata = {
  title: { default: "dayMarkable", template: "%s · dayMarkable" },
  description: "Write it down. Wake up organized.",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#F7F4EE" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${ui.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
