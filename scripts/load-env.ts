/**
 * Carga el archivo .env en los scripts de consola.
 *
 * Next lee el .env solo, pero los scripts que se ejecutan con tsx no: sin
 * esto, `npm run db:migrate` no vería las variables de Turso y trabajaría
 * contra el archivo local sin avisar, que es peor que fallar.
 *
 * Se importa PRIMERO en cada script, antes que cualquier módulo que lea
 * process.env.
 */

try {
  process.loadEnvFile();
} catch {
  // No hay .env: se usan los valores por defecto (archivo local).
}
