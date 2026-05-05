import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { SessionProvider } from "@/app/providers/SessionProvider";
import { GmailReconnectProvider } from "@/app/providers/GmailReconnectProvider";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "BaseFlow — Autopilot for your inbox",
  description:
    "Cold outreach, AI replies, and booked calls — one pipeline in BaseFlow.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full">
      <body
        suppressHydrationWarning
        className={`${geistSans.variable} ${geistMono.variable} font-sans flex h-full flex-col overflow-hidden bg-[#0a1428] antialiased`}
      >
        <SessionProvider>
          <GmailReconnectProvider>
            <div className="flex min-h-0 flex-1 flex-col">{children}</div>
          </GmailReconnectProvider>
        </SessionProvider>
      </body>
    </html>
  );
}
