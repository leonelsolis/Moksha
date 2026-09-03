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
            // Fuerza HTTPS en el navegador durante 2 años. `preload` queda
            // listo por si en algún momento se envía el dominio a
            // hstspreload.org; sin ese envío no tiene efecto extra.
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
