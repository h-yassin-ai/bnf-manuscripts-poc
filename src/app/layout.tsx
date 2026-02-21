import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import localFont from "next/font/local";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const scheherazade = localFont({
  src: "../../fonts/ScheherazadeNew-Regular.ttf",
  variable: "--font-scheherazade",
  display: "swap",
});

const rabat = localFont({
  src: "../../fonts/Rabat Regular.ttf",
  variable: "--font-rabat",
  display: "swap",
});

export const metadata: Metadata = {
  title: "BNF Manuscripts POC",
  description: "Digitize and transcribe manuscripts with AI",
};

import { Toaster } from "@/components/ui/sonner";

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} ${scheherazade.variable} ${rabat.variable} antialiased`}
      >
        {children}
        <Toaster />
      </body>
    </html>
  );
}
