import type { NextConfig } from "next";

/**
 * No hace falta configuración especial para la base: el cliente de libSQL es
 * JavaScript puro y se empaqueta como cualquier otra dependencia. (Con el
 * driver nativo anterior había que excluirlo del empaquetado; ya no.)
 */
const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          {
            // Fuerza HTTPS en el navegador durante 2 años, solo para el
            // dominio raíz: sin `includeSubDomains` un subdominio futuro
            // puede servirse sin HTTPS sin quedar bloqueado. (`preload`
            // exige esa directiva, así que tampoco va.)
            key: "Strict-Transport-Security",
            value: "max-age=63072000",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
