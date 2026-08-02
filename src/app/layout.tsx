import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";

import { getSettings } from "@/lib/settings";
import { staticSiteOrigin } from "@/lib/site-url";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

/**
 * Metadatos base de todo el sitio. El nombre sale de la configuración, no del
 * código. Ver README (reventa).
 *
 * `metadataBase` es el que hace que las direcciones de las tarjetas para
 * compartir salgan absolutas. Sin él, Next las emite relativas y ni WhatsApp ni
 * Google las resuelven: el link se comparte sin imagen ni descripción.
 */
export async function generateMetadata(): Promise<Metadata> {
  const settings = await getSettings();
  const origin = staticSiteOrigin();
  const logo = settings.business_logo_url.trim();

  return {
    metadataBase: origin ? new URL(origin) : undefined,
    title: {
      default: `${settings.business_name} — Turnos`,
      template: `%s — ${settings.business_name}`,
    },
    description: settings.business_tagline,
    applicationName: settings.business_name,
    openGraph: {
      type: "website",
      locale: "es_AR",
      siteName: settings.business_name,
      title: `${settings.business_name} — Turnos`,
      description: settings.business_tagline,
      ...(logo ? { images: [{ url: logo }] } : {}),
    },
    twitter: {
      card: logo ? "summary_large_image" : "summary",
      title: `${settings.business_name} — Turnos`,
      description: settings.business_tagline,
      ...(logo ? { images: [logo] } : {}),
    },
    robots: {
      index: true,
      follow: true,
      googleBot: { index: true, follow: true, "max-image-preview": "large" },
    },
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
