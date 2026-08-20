# Sistema de turnos

Aplicación web para que los clientes saquen turno online y el negocio los
administre. Dos zonas separadas:

- **Pública** (`/`) — sacar turno, sin cuenta ni login.
- **Panel** (`/admin`) — agenda, horarios, profesionales y ajustes, con login.

---

## Arrancar

```bash
npm install
```

```bash
npm run db:seed
```

Ese comando crea la base y **muestra por pantalla las contraseñas de los tres
usuarios del panel** (`admin`, `profesional1` y `profesional2`). Anotalas: no
se vuelven a mostrar.

Si preferís elegirlas vos, ponelas antes en el `.env`:

```
ADMIN_PASSWORD=…      PROF1_PASSWORD=…      PROF2_PASSWORD=…
ADMIN_EMAIL=…         PROF1_EMAIL=…         PROF2_EMAIL=…
```

Los emails son a donde le llega a cada profesional el aviso de turno nuevo y de
cancelación. Si no los cargás ahí, se completan después desde **Usuarios**.
Después:

```bash
npm run dev
```

Y abrí http://localhost:3000

| Comando | Qué hace |
|---|---|
| `npm run dev` | Servidor de desarrollo |
| `npm run build` / `npm start` | Compilar y correr en producción |
| `npm run typecheck` | Revisar tipos sin compilar |
| `npm run db:migrate` | Aplicar migraciones pendientes |
| `npm run db:seed` | Carga inicial (usuarios + datos de ejemplo) |
| `npm run db:seed -- --reset` | Vaciar todo y empezar de cero (pide confirmación) |
| `npm run db:users` | Listar las cuentas del panel |
| `npm run db:password -- <usuario>` | Ponerle una contraseña nueva a una cuenta |
| `npm run db:studio` | Visor de la base en el navegador |

En desarrollo la base es el archivo `data/turnos.db`. En producción es Turso;
no hay que cambiar código, solo variables de entorno.

---

## Primeros pasos en el panel

1. Entrá a `/admin` con el usuario `admin`.
2. **Ajustes** — nombre del negocio, datos de contacto y reglas de reserva.
3. **Profesionales** — cargá los nombres, la foto y, sobre todo, **los
   servicios con su duración**. Sin al menos un servicio no se le pueden sacar
   turnos a esa profesional.
4. **Horarios** — los días y las franjas en que atiende cada una, y sus
   vacaciones.
5. **Usuarios** — revisá que cada cuenta `profesional` esté vinculada a la
   profesional correcta y tenga su email de contacto cargado.

Después de eso la página pública ya funciona, y cada profesional puede entrar
con su propio usuario a ver su agenda y manejar sus horarios.

### Sobre los servicios

La duración del turno sale del servicio. Cada profesional puede tener:

- **Un solo servicio** → el cliente no elige nada, se usa esa duración.
- **Varios servicios** → aparece un paso extra donde el cliente elige.

Es el mismo lugar donde se cambia "cuánto dura un turno": se edita la duración
del servicio.

### Qué es cada servicio (la ficha al costado)

En la web pública, cuando la clienta elige un servicio aparece una tarjeta al
costado —debajo de la elección en el celular— que explica de qué se trata. Sirve
para lo que no todo el mundo sabe qué es: kapping, esmaltado semipermanente,
laminado de cejas.

Se carga en **Servicios**, y ahí hay dos cosas por servicio:

- **Qué es** — el texto, hasta 400 caracteres. Si queda vacío no aparece
  ninguna ficha.
- **Foto de ejemplo** — opcional, con un check *Mostrar la foto en la web*. Con
  el check apagado la ficha sale igual, solo que sin el recuadro de la foto. Sin
  foto cargada el check queda deshabilitado; al subir la primera se enciende
  solo.

Es la única pantalla de configuración que comparten los dos roles: **cada
profesional escribe la de sus propios servicios y no puede tocar la de la otra**;
la administración las ve todas, agrupadas por profesional. El nombre, la
duración y el precio se siguen cargando en **Profesionales**, solo desde una
cuenta `admin`.

### Vacaciones

Dos formas, según el caso:

- **Botón "Marcar de vacaciones"** — inmediato y sin fecha de vuelta. Útil
  cuando todavía no se sabe hasta cuándo. Se desmarca a mano.
- **Vacaciones con fecha** — un rango de días. Se puede cargar con
  anticipación: hoy sigue apareciendo normal y solo se bloquean esos días.

En cualquiera de los dos casos, en la web pública su foto se ve en escala de
grises, el nombre en gris claro, aparece la leyenda "De vacaciones" y no se la
puede seleccionar.

Cargar vacaciones **no cancela** los turnos que ya estaban reservados en esas
fechas: revisalos en la agenda y avisales vos a las clientas.

### Usuarios y roles

Todos entran por el mismo `/admin`, con su propio usuario y contraseña. Lo que
ven después depende del rol:

| Rol | Turnos | Horarios y vacaciones | Fichas de servicios | Profesionales, Usuarios y Ajustes |
|---|---|---|---|---|
| `admin` | de todas, con filtro por profesional | de todas | de todas | sí |
| `profesional` | **solo los suyos** | **solo los suyos** | **solo los suyos** | no |

Una cuenta `profesional` está atada a una fila de `professionals` por su campo
`professional_id`. Ese vínculo es lo que define qué ve: sin él la cuenta no ve
ningún turno.

**El aislamiento se aplica en el servidor, no escondiendo botones.** Cada
página y cada server action vuelve a resolver el alcance del usuario contra la
base:

- los ids que llegan por formulario se validan con `canAccessProfessional`;
- los borrados y ediciones por id llevan la condición de alcance dentro del
  `WHERE` (`withScope`), así un id ajeno no afecta ninguna fila;
- la agenda ignora el parámetro `?prof=` cuando quien mira es una profesional.

Editar la URL o falsificar el envío de un formulario no alcanza para ver ni
tocar los datos de la otra.

La carga inicial crea tres cuentas: `admin`, `profesional1` y `profesional2`,
cada una vinculada a la suya. Desde **Usuarios**, y solo desde una cuenta
`admin`, se puede:

- crear cuentas nuevas y vincularlas a una profesional (por ejemplo, sumar una
  tercera);
- cambiarle a cualquiera el **nombre de usuario**, el nombre para mostrar, el
  email, el rol y la profesional vinculada;
- resetear contraseñas;
- desactivar y reactivar cuentas.

Desactivar corta las sesiones abiertas en el acto: el permiso se lee de la base
en cada request, no de la cookie.

Cada quien cambia su propia contraseña y su email de contacto en **Mi cuenta**.

### Si nadie puede entrar al panel

Las contraseñas **no se pueden consultar**: en la base solo está su hash
bcrypt, que no se puede revertir. Lo único posible es poner una nueva. Desde la
consola, contra la misma base que usa el sitio:

```bash
npm run db:users
```

```bash
npm run db:password -- admin
```

El segundo comando genera una contraseña, la aplica y la muestra una única vez.
Si querés elegirla vos, va como segundo argumento:
`npm run db:password -- admin MiClave123`.

---

## Cómo cancela el cliente

Al confirmar, el sistema genera un **link único** que se muestra en la pantalla
de confirmación. Ese link es la vía principal: no hay que recordar nada y no
sirve para ver turnos ajenos.

Como respaldo, en `/cancelar` se puede buscar el turno con **DNI + email**
(ambos tienen que coincidir con los de la reserva). Se puede desactivar desde
Ajustes si preferís que el link sea la única forma.

El **límite de horas para cancelar** se configura en Ajustes. Con `0` no hay
límite. Desde el panel siempre se puede cancelar cualquier turno, sin importar
ese límite.

Cancelar **libera el horario al instante** y no borra el registro: el turno
queda en la agenda marcado como cancelado.

### Cómo llegar al local (el mapa al costado)

En la pantalla del turno —la de la confirmación y la misma que la clienta vuelve
a abrir después— aparece al costado un mapa de Google con la dirección del
local, y un botón **Cómo llegar** que en el celular abre la app de Maps. Debajo
del mapa, en pantallas angostas.

Sale de la **Dirección** de Ajustes: escribila como la buscarías en Google Maps
(calle, número y ciudad). Si queda vacía no hay mapa ni columna al costado, y la
página se ve igual que antes. En un turno cancelado tampoco se muestra.

Es el embed público de Google: **no hace falta ninguna clave de API** ni dar de
alta nada en Google Cloud, y por eso tampoco se puede personalizar el mapa.

---

## Emails

Salen cuatro tipos de mail, todos por el mismo camino:

| Cuándo | A quién | Qué lleva |
|---|---|---|
| Se confirma un turno | al cliente | fecha, hora, quién atiende y su link personal |
| El cliente cancela | al cliente | confirmación de la cancelación |
| Se confirma un turno | **a la profesional** | el turno y los datos de contacto del cliente |
| Se cancela un turno (cliente o panel) | **a la profesional** | qué horario se liberó y quién lo canceló |

Los avisos a la profesional van al **email de contacto de su cuenta del panel**
(el de **Mi cuenta**, o el que le cargue el admin en **Usuarios**). No hay una
segunda lista de direcciones que mantener: si el email de la cuenta está vacío,
no recibe avisos. Si hay más de una cuenta vinculada a la misma profesional, le
llega a todas.

Los mails salen por [Resend](https://resend.com). Vienen apagados: hay que
encenderlos una sola vez. El interruptor de Ajustes es uno solo y cubre tanto
los del cliente como los de las profesionales.

1. Crear cuenta en Resend. El plan gratuito da 3.000 emails por mes, de sobra
   para este uso.
2. Verificar el dominio agregando los registros DNS que indica el panel de
   Resend. **Sin dominio propio verificado solo se puede enviar a la casilla
   del titular de la cuenta**, usando `onboarding@resend.dev` como remitente.
   Sirve para probar, no para producción.
3. Cargar `RESEND_API_KEY` donde corra el sitio: en el archivo `.env` para
   desarrollo, y en Vercel → Settings → Environment Variables para producción.
   Después de agregarla en Vercel hay que volver a desplegar.
4. En **Ajustes → Emails de confirmación**: poner la dirección remitente
   (tiene que ser del dominio verificado) y tildar el envío. Guardar.
5. En **Ajustes → Probar el envío**: mandarte un mail de prueba a vos. Si llega,
   está todo bien; si no, la pantalla dice qué contestó Resend.

Conviene también cargar `APP_URL` con la dirección definitiva del sitio, para
que el link del mail salga siempre con el dominio bueno y no con el
`.vercel.app`. Sin `APP_URL` el link se arma con el dominio por el que entró
esa persona, que funciona igual pero puede no ser el que querés mostrar.

**Un mail que no sale nunca invalida un turno.** El turno se guarda primero y
el cliente ve su link en la pantalla de confirmación, con un botón para
copiarlo. Si el envío falla queda anotado el motivo en los logs del servidor
(en Vercel: pestaña Logs, buscar `[resend]`).

---

## Fotos y logo

Las imágenes se suben desde el panel y aparecen al instante, sin volver a
publicar el proyecto. Se pueden cambiar desde la computadora o el celular.

- **Fotos de las profesionales:** Profesionales → Foto y datos → Subir foto.
- **Fotos de los servicios:** Servicios → Foto de ejemplo → Subir foto.
- **Logo del negocio:** Ajustes → Logo → Subir logo.

No van en la carpeta `public/`: eso es parte del código, así que cada foto
nueva obligaría a hacer un despliegue.

### Configurarlo una sola vez

1. En Vercel, entrá a tu proyecto → pestaña **Storage** → **Create** → **Blob**.
2. Ponele un nombre (por ejemplo `moksha-fotos`) y elegí acceso **público**
   (*public*). Esto es importante y no se puede cambiar después: las fotos se
   muestran en la web, así que en un almacén privado la subida falla con
   «No se pudo subir la imagen». Si te equivocaste, creá otro almacén público,
   conectalo y borrá el privado.
3. **Connect to Project** → elegí el proyecto y los tres entornos (Production,
   Preview y Development). Vercel agrega las variables solo, no hay que copiar
   nada a mano.
4. Volvé a desplegar para que las tome.

Según cuándo se haya creado el almacén, la variable que aparece es
`BLOB_READ_WRITE_TOKEN` (los viejos) o `BLOB_STORE_ID` (los nuevos, que se
autentican con un token temporal que Vercel renueva sola). El código acepta
las dos formas.

Si querés subir fotos también desde tu computadora, traé las variables con:

```bash
npx vercel env pull .env.local
```

Sin ellas el resto del sistema funciona igual: solo el botón de subir
avisa que falta configurarlo, se muestran las iniciales de cada profesional y
el nombre del negocio en texto en lugar del logo.

### Qué hace con la imagen

- La achica en el navegador y la recomprime: 800 píxeles de lado como máximo
  para las fotos, 400 para el logo. Una foto de celular de 4 MB queda en unos
  150 KB, sin diferencia visible.
- El logo se guarda en PNG para no perder el fondo transparente; las fotos, en
  JPEG, que pesa menos.
- Respeta la orientación: las fotos verticales no salen acostadas.
- Al reemplazar una foto, borra la anterior del almacenamiento.
- Si la foto era un link externo cargado a mano, la quita de la ficha pero no
  toca el original.

---

## Cobrar la seña por transferencia

Además de Mercado Pago, la seña se puede cobrar por transferencia bancaria.
Los dos medios conviven: si están los dos encendidos, la clienta elige al
reservar.

Se configura en **Señas y cobros** del panel: alias o CBU, titular, banco y
cuánto tiempo se le guarda el horario (1440 minutos = un día, que es lo
recomendado: una transferencia depende del horario del banco).

### El truco de los centavos

Una transferencia llega anónima: en la cuenta solo aparece "entraron $5.000",
sin ningún dato que diga de quién es. Si dos clientas señan lo mismo el mismo
día, los movimientos son idénticos.

Por eso a cada una se le pide un importe con **centavos propios** —$5.000,37 y
no $5.000— únicos entre las transferencias que están esperando. El monto pasa a
ser el identificador que la transferencia no trae, y no depende de que la
clienta complete bien ningún concepto: solo de que transfiera el número que ve
en pantalla.

En **Transferencias** del panel aparece cada reserva con su importe exacto al
lado del nombre. Se compara con la cuenta y se confirma con un clic; al
confirmar sale el mail de turno confirmado y se encola el WhatsApp, igual que
en cualquier turno pago.

### Verificación automática (opcional)

Si la cuenta que recibe es de Mercado Pago, se pueden acreditar solas: cada
diez minutos se buscan las transferencias entrantes y se confirma la que
coincide al centavo. Solo acredita coincidencias exactas; todo lo demás queda
para que lo resuelva una persona.

**Antes de encenderlo hay que comprobar que funcione con la cuenta real**, así:

```bash
curl -s -H "Authorization: Bearer $MERCADOPAGO_ACCESS_TOKEN" \
  "https://api.mercadopago.com/v1/payments/search?sort=date_created&criteria=desc&limit=10"
```

Transferite $1 al alias de esa cuenta y volvé a correrlo. Si el movimiento
aparece en la respuesta, la verificación automática sirve y se puede encender
en Señas y cobros. Si no aparece, dejala apagada: la aprobación con un clic
desde el panel funciona siempre.

### Programar el chequeo

Necesita `CRON_SECRET` en las variables de entorno, y algo que llame cada tanto
a:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" https://tu-dominio/api/pagos/transferencias
```

Cada diez o quince minutos alcanza de sobra: del otro lado hay alguien
esperando que le confirmen un turno, no un pago en tiempo real.

**Los cron de Vercel no sirven en el plan Hobby**, que es el que usa este
proyecto: ahí solo se permite uno por día, y un chequeo diario llegaría después
de que venza la retención. Las opciones son:

- Un servicio de cron gratuito (cron-job.org, EasyCron) apuntando a esa URL con
  el header.
- Un workflow de GitHub Actions con `schedule`, guardando el secreto en los
  Secrets del repositorio.
- El plan Pro de Vercel, donde el cron se declara en `vercel.json` con la
  frecuencia que se quiera.

Con la verificación automática apagada este endpoint no hace nada, así que se
puede dejar programado igual.

---

## Variables de entorno

Copiá `.env.example` a `.env`. La única obligatoria para desarrollo es
`AUTH_SECRET`:

```bash
openssl rand -base64 32
```

Si se cambia, se cierran todas las sesiones abiertas del panel.

`CRON_SECRET` hace falta solo si se usa la verificación automática de
transferencias. Se genera igual que `AUTH_SECRET`.

---

## Publicar en Vercel + Turso

La base es SQLite, así que **no puede ser un archivo en el servidor**: en
Vercel el disco se borra en cada despliegue y corren varias instancias en
paralelo. Turso es SQLite alojado y resuelve eso sin cambiar el código.

### 1. Crear la base en Turso

Instalá la CLI y creá la base:

```bash
curl -sSfL https://tur.so/install.sh | bash
```

```bash
turso auth signup
```

```bash
turso db create moksha-turnos
```

Ahora sacá los dos datos que necesita la aplicación:

```bash
turso db show moksha-turnos --url
```

```bash
turso db tokens create moksha-turnos
```

El primero es `TURSO_DATABASE_URL`, el segundo `TURSO_AUTH_TOKEN`.

### 2. Preparar la base

Poné esas dos variables en tu `.env` local y creá las tablas y los usuarios
**en la base remota**:

```bash
npm run db:migrate && npm run db:seed
```

Anotá las contraseñas que imprime. Este paso se hace una sola vez.

> Cuidado: mientras esas variables estén en tu `.env`, `npm run dev` trabaja
> contra la base de producción. Comentalas para volver al archivo local.

### 3. Desplegar

Subí el proyecto a GitHub, importalo en [vercel.com](https://vercel.com) y
cargá estas variables de entorno en el panel de Vercel:

| Variable | Valor |
|---|---|
| `AUTH_SECRET` | El que generaste con `openssl` |
| `TURSO_DATABASE_URL` | `libsql://…` |
| `TURSO_AUTH_TOKEN` | El token de Turso |
| `APP_URL` | La dirección final del sitio |
| `BLOB_STORE_ID` o `BLOB_READ_WRITE_TOKEN` | Las agrega Vercel sola al conectar el almacén de fotos |
| `RESEND_API_KEY` | Solo si querés los emails de confirmación |

Vercel compila y publica solo. El HTTPS y el certificado vienen incluidos, y
hacen falta: sin ellos no funcionan ni la cookie de sesión del panel ni el
botón "Copiar link".

### Despliegues siguientes

Solo hace falta correr las migraciones cuando cambia el esquema, y se hace
desde tu computadora con las variables de Turso puestas:

```bash
npm run db:migrate
```

### Costos

Vercel tiene plan gratuito y Turso también, ambos de sobra para un negocio de
este tamaño. Lo único que se paga es el dominio. Conviene confirmar los planes
vigentes en cada sitio antes de decidir.

### Respaldos

```bash
turso db shell moksha-turnos ".dump" > respaldo-turnos.sql
```

Turso mantiene además su propio historial de la base, que permite volver a un
punto anterior en el tiempo.

---

## Usar el sistema en otro negocio

No hay nada del negocio escrito en el código: el nombre, el logo, los datos de
contacto, la zona horaria y todas las reglas viven en la base y se editan desde
el panel.

Para instalarlo en otro local: crear otra base en Turso, desplegar otra copia
en Vercel apuntando a esa base, correr la carga inicial y configurar todo desde
`/admin`. Cada negocio queda con su propia base, así no hay forma de que se
mezclen datos entre clientes.

---

## Cómo está armado

```
src/
  app/
    page.tsx                 reserva (público)
    turno/[token]/           confirmación y cancelación con link único
    cancelar/                búsqueda por DNI + email
    admin/                   panel (protegido)
    api/disponibilidad/      horarios libres, consultado por el calendario
    actions/                 server actions (reservar, cancelar, administrar)
  components/                interfaz
  db/
    schema.ts                tablas
    connection.ts            conexión (archivo local o Turso)
    migrations.ts            migraciones, se aplican con db:migrate
  lib/
    availability.ts          ← cálculo de horarios libres (el núcleo)
    dates.ts                 fechas y horas en la zona del negocio
    settings.ts              configuración del negocio
    auth.ts / session.ts     ← login, roles y alcance por profesional
    notify.ts                avisos por email a la profesional
    tokens.ts                tokens de cancelación
  proxy.ts                   protege /admin (primera capa, por rol)
scripts/migrate.ts           aplica migraciones
scripts/seed.ts              carga inicial
```

Dos cosas que conviene saber antes de tocar el código:

**Toda la disponibilidad se calcula en `lib/availability.ts`.** La web pública,
el panel y la validación al confirmar usan la misma función. Si esa lógica se
duplica en otro lado, tarde o temprano se desincroniza y aparecen turnos
fantasma.

**Las fechas se guardan como texto `YYYY-MM-DD` y las horas como minutos desde
la medianoche**, en la zona horaria del negocio. No se usan timestamps UTC a
propósito: evita los errores de desplazamiento que aparecen al convertir de una
zona a otra.

**Los permisos se leen de la base en cada request, no de la cookie.** La cookie
firmada dice *quién* es; `getCurrentUser` dice *qué puede hacer*. Por eso
desactivar una cuenta o cambiarle el rol tiene efecto en el acto en vez de
cuando vence la sesión. El middleware (`proxy.ts`) solo mira la firma del
token, porque corre en el borde y no tiene acceso a la base: es una primera
capa barata, nunca la que decide.

### Cómo se evitan las reservas dobles

Dos capas, porque una sola no alcanza:

1. El alta es un único `INSERT … SELECT … WHERE NOT EXISTS`: la comprobación de
   choques y la inserción viajan en la misma sentencia, y SQLite ejecuta cada
   sentencia de forma atómica. No queda ninguna ventana entre "miré si estaba
   libre" y "lo guardé", que es donde se cuelan las reservas dobles. Esto cubre
   el solapamiento entre servicios de distinta duración (uno de 60' a las 10:00
   contra uno de 30' a las 10:30, que empiezan en minutos distintos).
2. Un índice único parcial en `appointments` rechaza cualquier segundo turno
   con el mismo inicio exacto, aunque un error de código saltee lo anterior. Es
   parcial (`WHERE status = 'booked'`), y por eso al cancelar la fila sale del
   índice y el horario queda libre solo.

### Cambiar el esquema de la base

Agregá una entrada **nueva** al final del array en `src/db/migrations.ts`.
Nunca edites una que ya se usó: las bases existentes ya la aplicaron y no la
volverían a ejecutar.

### Dejar de pedir el teléfono

Borrar el campo `phone` del formulario en
`src/components/public/BookingFlow.tsx` y quitar su validación en
`src/lib/validation.ts`. La columna puede quedar vacía sin romper nada.
# Moksha
