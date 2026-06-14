import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { AuthGuard } from "@/components/AuthGuard";
import { AuthenticatedWidgets } from "@/components/AuthenticatedWidgets";
import { SidebarProvider } from "@/components/SidebarContext";

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
        <AuthGuard>{children}</AuthGuard>
        <SidebarProvider>
          <AuthenticatedWidgets />
        </SidebarProvider>
      </body>
    </html>
  );
}
