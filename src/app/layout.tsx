import type { Metadata } from "next";
import { JetBrains_Mono, Space_Grotesk } from "next/font/google";
import "./globals.css";

const grotesk = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-grotesk",
});

const mono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains",
});

export const metadata: Metadata = {
  title: {
    default: "Jordan Orbit",
    template: "%s · Jordan Orbit",
  },
  description: "Jordan Orbit is the AI operations and automation platform for Jordan Fitness. Orbit People is the live module for HR and compliance.",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-GB" className={`${grotesk.variable} ${mono.variable} h-full`}>
      <body className="min-h-full bg-paper font-sans text-ink antialiased">{children}</body>
    </html>
  );
}
