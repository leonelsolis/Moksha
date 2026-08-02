import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";

import { getSettings } from "@/lib/settings";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

/** El título sale de la configuración, no del código. Ver README (reventa). */
export async function generateMetadata(): Promise<Metadata> {
  const settings = await getSettings();
  return {
    title: {
      default: `${settings.business_name} — Turnos`,
      template: `%s — ${settings.business_name}`,
    },
    description: settings.business_tagline,
  };
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#faf9f7",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es-AR" className={`${inter.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
