import type { Metadata } from "next";
import { JetBrains_Mono, Space_Grotesk, Geist } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";
import { cn } from "@/lib/utils";

const geist = Geist({subsets:['latin'],variable:'--font-sans'});

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
    default: "Jordan Pulse",
    template: "%s · Jordan Pulse",
  },
  description: "Jordan Pulse is the AI operations and automation platform for Jordan Fitness. Pulse People is the live module for HR and compliance.",
  robots: { index: false, follow: false },
};

const themeBoot = `(function(){try{var k="pulse-theme";var t=localStorage.getItem(k);if(t!=="dark"&&t!=="light"){var m=document.cookie.match(/(?:^|; )pulse-theme=([^;]+)/);t=m?decodeURIComponent(m[1]):"light";}document.documentElement.dataset.theme=t==="dark"?"dark":"light";document.documentElement.classList.toggle("dark",t==="dark");}catch(e){document.documentElement.dataset.theme="light";}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-GB" className={cn("h-full", grotesk.variable, mono.variable, "font-sans", geist.variable)} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBoot }} />
      </head>
      <body className="min-h-full bg-paper font-sans text-ink antialiased">
        {children}
        <Toaster />
      </body>
    </html>
  );
}
