import type { Metadata, Viewport } from "next";
import { Fraunces, Inter, Geist_Mono } from "next/font/google";
import { StaleBuildListener } from "@/components/stale-build-listener";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});
const fraunces = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"],
  axes: ["SOFT", "WONK"],
});
const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Bren Raphael's | Customer Relation & Ecommerce Ordering Management System",
  description: "Customer Relation and Ecommerce Ordering Management System",
};

// Always lay out at desktop width, phones included: phones get the zoomed-out desktop site
// (owner decision 2026-11-25). Never switch back to the phone width or block pinch-zoom.
const DESKTOP_WIDTH = 1280;
export const viewport: Viewport = {
  width: DESKTOP_WIDTH,
  // Next.js adds initial-scale=1 by default, which opens phones at 100% on a slice of the page.
  // Left unset, phones zoom out to show the whole desktop width.
  initialScale: undefined,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${fraunces.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-screen min-w-[1280px] bg-background text-foreground font-sans">
        {children}
        <Toaster />
        <StaleBuildListener />
      </body>
    </html>
  );
}
