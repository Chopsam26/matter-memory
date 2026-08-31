import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

import { IdentityProvider } from "@/components/identity";
import { SiteHeader } from "@/components/site-header";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Matter Memory",
  description:
    "Permission-aware retrieval over an estate planning firm's client files.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        {/* The identity selector lives in the header, not in the upload form,
            which CLAUDE.md fixes at exactly three fields. */}
        <IdentityProvider>
          <SiteHeader />
          <main className="mx-auto max-w-4xl px-6 py-10">{children}</main>
        </IdentityProvider>
      </body>
    </html>
  );
}
