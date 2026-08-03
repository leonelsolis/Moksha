/**
 * Pone la base al día antes de compilar.
 *
 * Corre solo en Vercel, enganchado al `build`. Existe por una caída real: el
 * 3 de agosto de 2026 se desplegó el cobro de señas contra una base que estaba
 * en la versión 4, y como el código nuevo pedía `services.deposit_amount`, la
 * web entera devolvió 500 hasta que la migración se corrió a mano.
 *
 * La causa no fue el olvido: era que **nada** ataba el esquema al despliegue.
 * `npm run db:migrate` es un paso aparte que hay que acordarse de hacer, y el
 * día que no te acordás te enterás por el sitio caído. El build es el único
 * momento que ocurre siempre y ocurre ANTES de que el código nuevo reciba
 * tráfico, así que es donde tiene que estar.
 *
 * Tres comportamientos, según dónde corra:
 *
 *   · Fuera de Vercel → no hace nada. Compilar en tu máquina no puede tener
 *     como efecto secundario escribir en una base; para eso está
 *     `npm run db:migrate`, explícito.
 *
 *   · Producción → migra, y si falla **corta el build**. Un deploy que no sale
 *     se arregla apretando "redeploy"; uno que sale contra un esquema que no
 *     le corresponde deja el sitio caído para las clientas.
 *
 *   · Preview → solo mira y avisa, no escribe. Hoy preview y producción
 *     comparten la misma base de Turso: si el preview de una rama migrara,
 *     estaría cambiando el esquema de producción antes de que ese código
 *     exista en `main`. Un preview roto es barato; producción migrada de
 *     prepo, no.
 *
 * ── La condición que esto asume ──────────────────────────────────────────
 *
 * La migración corre durante el build, o sea ANTES de que el deploy nuevo
 * reemplace al que está sirviendo. Durante esos segundos —y para siempre, si
 * el deploy se revierte— la base está una versión adelante del código vivo.
 *
 * Por eso cada migración tiene que poder convivir con el código anterior:
 * agregar columnas y tablas, sí; renombrar o borrar lo que el código viejo
 * todavía lee, no. Si alguna vez hace falta sacar algo, va en dos pasos y dos
 * despliegues: primero deja de usarse, después se borra.
 */

import "./load-env";

/** 'production' | 'preview' | 'development' en Vercel; vacío fuera de Vercel. */
const target = process.env.VERCEL_ENV?.trim();

function log(message: string) {
  console.log(`  [predeploy] ${message}`);
}

async function main() {
  if (!target) {
    log("Fuera de Vercel: la base no se toca. Usá `npm run db:migrate`.");
    return;
  }

  /*
   * La conexión se importa acá adentro y no arriba porque el módulo tira al
   * cargarse si hay URL de Turso sin token. Con el import diferido ese caso
   * cae en el catch y sale un mensaje que se entiende, en lugar de un stack
   * suelto antes de que este script llegue a decir nada.
   */
  const { client, isRemoteDatabase } = await import("../src/db/connection");
  const { currentVersion, runMigrations, SCHEMA_VERSION } = await import(
    "../src/db/migrations"
  );

  try {
    if (!isRemoteDatabase) {
      // En Vercel el sistema de archivos del build es descartable: migrar un
      // archivo local sería trabajar sobre algo que no sobrevive al deploy.
      log(`Entorno ${target} sin Turso configurado: no hay base que migrar.`);
      return;
    }

    if (target !== "production") {
      const version = await currentVersion(client);

      if (version < SCHEMA_VERSION) {
        log(
          `AVISO: la base está en v${version} y este código necesita v${SCHEMA_VERSION}.`,
        );
        log("Este preview va a fallar hasta que corras `npm run db:migrate`.");
        log("No se migra desde un preview: la base es la misma que producción.");
      } else {
        log(`Base en v${version}. Al día.`);
      }

      return;
    }

    const { from, to, applied } = await runMigrations(client);

    if (applied === 0) {
      log(`Base en v${to}. Sin cambios pendientes.`);
      return;
    }

    log(
      `${applied} ${applied === 1 ? "migración aplicada" : "migraciones aplicadas"}: v${from} → v${to}.`,
    );
  } finally {
    client.close();
  }
}

main().catch((error) => {
  console.error("\n  [predeploy] No se pudo poner la base al día:\n");
  console.error(error);
  console.error(
    "\n  El build se corta acá a propósito: desplegar contra un esquema que no" +
      "\n  le corresponde al código deja el sitio caído para las clientas.\n",
  );
  process.exitCode = 1;
});
