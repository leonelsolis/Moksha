import "server-only";

/**
 * Punto de entrada a la base para la aplicación.
 *
 * La marca `server-only` hace que el build falle si algún componente del
 * navegador llega a importar esto por error, en lugar de descubrirlo en
 * producción. La conexión en sí vive en `./connection`, que los scripts de
 * consola pueden importar sin esa restricción.
 */
export { db, client, isRemoteDatabase, schema } from "./connection";
