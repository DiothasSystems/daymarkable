import type { Metadata, Viewport } from "next";
import { IBM_Plex_Mono, Public_Sans, Source_Serif_4 } from "next/font/google";
import "./globals.css";

const display = Source_Serif_4({ weight: ["400", "600", "700"], style: ["normal", "italic"], subsets: ["latin"], variable: "--font-display", display: "swap" });
const ui = Public_Sans({ weight: ["400", "500", "600", "700"], subsets: ["latin"], variable: "--font-ui", display: "swap" });
const mono = IBM_Plex_Mono({ weight: ["400", "500"], subsets: ["latin"], variable: "--font-mono", display: "swap" });

export const metadata: Metadata = {
  title: { default: "dayMarkable", template: "%s · dayMarkable" },
  description: "Note to Action Organizer. Today's notes, tomorrow's actions.",
  icons: { icon: "/icon.svg" },
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#F7F0E3" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${ui.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
