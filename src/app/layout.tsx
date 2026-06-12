import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Sidebar } from "@/components/Sidebar";
import { AuthGuard } from "@/components/AuthGuard";
import CommandPalette from "@/components/CommandPalette";
import AIChatWidget from "@/components/AIChatWidget";
import AIChatGlobalShortcuts from "@/components/AIChatGlobalShortcuts";
import AlertScheduler from "@/components/AlertScheduler";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "GroundControl — VPS Cockpit",
  description: "The self-hosted cockpit for your VPS fleet.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full bg-background text-foreground">
        <AuthGuard>
          <Sidebar />
          <main className="min-h-screen md:ml-64 pt-16 md:pt-0">
            {children}
          </main>
          <CommandPalette />
          <AIChatGlobalShortcuts />
          <AIChatWidget />
          <AlertScheduler />
        </AuthGuard>
      </body>
    </html>
  );
}
