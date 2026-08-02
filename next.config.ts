import type { NextConfig } from "next";

/**
 * No hace falta configuración especial para la base: el cliente de libSQL es
 * JavaScript puro y se empaqueta como cualquier otra dependencia. (Con el
 * driver nativo anterior había que excluirlo del empaquetado; ya no.)
 */
const nextConfig: NextConfig = {};

export default nextConfig;
