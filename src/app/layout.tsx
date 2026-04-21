import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { ThemeProvider } from "@/components/theme-provider";
import { SessionProvider } from "@/components/session-provider";
import { TooltipProvider } from "@/components/ui/tooltip";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Central site identity. Update these when rebranding the template so
// metadata, manifest, and Open Graph tags stay in sync.
const SITE_NAME = "XLS-66 Lending Protocol · XRPL Demo App";
const SITE_SHORT_NAME = "XLS-66 & XLS-65Lending";
const SITE_DESCRIPTION =
  "Open-source demo application implementing the XRP Ledger lending amendments (XLS-66 + XLS-65) on Devnet.";
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0a" },
  ],
  width: "device-width",
  initialScale: 1,
};

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: SITE_NAME,
    template: `%s · ${SITE_SHORT_NAME}`,
  },
  description: SITE_DESCRIPTION,
  applicationName: SITE_SHORT_NAME,
  authors: [{ name: "krkmu" }],
  keywords: [
    "XRPL",
    "XRP Ledger",
    "XLS-66",
    "XLS-65",
    "XLS-33",
    "Lending Protocol",
    "Single Asset Vault",
    "MPT",
    "DeFi",
    "repo",
  ],
  category: "finance",
  creator: "krkmu",
  publisher: "krkmu",
  robots: { index: true, follow: true },
  manifest: "/manifest.webmanifest",
  icons: { icon: "/favicon.ico" },
  openGraph: {
    type: "website",
    siteName: SITE_SHORT_NAME,
    title: SITE_NAME,
    description: SITE_DESCRIPTION,
    url: SITE_URL,
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    title: SITE_NAME,
    description: SITE_DESCRIPTION,
  },
  other: {
    "format-detection": "telephone=no",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <SessionProvider>
            <TooltipProvider>{children}</TooltipProvider>
          </SessionProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
