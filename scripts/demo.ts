/**
 * Demo local para mostrar el sistema sin datos reales.
 *
 *   npm run demo
 *
 * Arma data/demo.db desde cero con un negocio ficticio —profesionales,
 * servicios, horarios, vacaciones y unas semanas de turnos— y levanta el
 * servidor de desarrollo apuntando a esa base. La base de desarrollo
 * (data/turnos.db) y la de producción no se tocan.
 *
 * Cada corrida rehace la base, así las fechas de los turnos quedan siempre
 * alrededor de hoy. Ver scripts/demo-env.ts para lo que se bloquea.
 *
 * Los emails de las clientas son @example.com (dominio reservado, no entrega
 * a nadie) y los teléfonos son 11 0000-xxxx, que no existen.
 */

import { DEMO_DB } from "./demo-env";

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import bcrypt from "bcryptjs";
import { sql } from "drizzle-orm";

import { addDays, nowInTz, weekdayOf } from "../src/lib/dates";

// Mismo hash que src/lib/tokens.ts, que no se puede importar fuera de Next.
const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

const DEMO_PASSWORD = "demo1234";
const TZ = "America/Argentina/Buenos_Aires";

/** Siempre la misma demo: un PRNG con semilla fija en vez de Math.random. */
function prng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = prng(20261026);
const pick = <T,>(list: readonly T[]) => list[Math.floor(rand() * list.length)];

const FIRST_NAMES = [
  "Sofía", "Valentina", "Camila", "Martina", "Lucía", "Julieta", "Florencia",
  "Agustina", "Micaela", "Carolina", "Rocío", "Paula", "Victoria", "Milagros",
  "Antonella", "Delfina", "Josefina", "Catalina", "Renata", "Abril", "Lara",
  "Bianca", "Mora", "Pilar", "Emilia", "Guadalupe", "Ana", "Belén",
];
const LAST_NAMES = [
  "González", "Rodríguez", "Fernández", "López", "Martínez", "Pérez", "Gómez",
  "Díaz", "Romero", "Sosa", "Álvarez", "Torres", "Ruiz", "Ramírez", "Acosta",
  "Benítez", "Medina", "Herrera", "Suárez", "Aguirre", "Giménez", "Molina",
];
const NOTES = [
  "Pidió diseño francés.",
  "Alérgica al acetona, usar removedor suave.",
  "Viene con una amiga.",
  "Primera vez.",
  "Quiere tono nude.",
  "Llega 10 min tarde, avisó.",
];

function client(i: number) {
  const firstName = FIRST_NAMES[i % FIRST_NAMES.length];
  const lastName = LAST_NAMES[(i * 7) % LAST_NAMES.length];
  const slug = `${firstName}.${lastName}`
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
  return {
    firstName,
    lastName,
    dni: String(30_000_000 + ((i * 7919) % 15_000_000)),
    email: `${slug}${i}@example.com`,
    phone: `11 0000-${String(1000 + ((i * 37) % 9000))}`,
  };
}

async function seed() {
  rmSync(DEMO_DB, { force: true });
  rmSync(`${DEMO_DB}-wal`, { force: true });
  rmSync(`${DEMO_DB}-shm`, { force: true });
  mkdirSync("data", { recursive: true });

  // Recién acá: la conexión lee DATABASE_PATH al importarse.
  const { client: raw, db } = await import("../src/db/connection");
  const s = await import("../src/db/schema");
  const { runMigrations } = await import("../src/db/migrations");

  await runMigrations(raw);

  /* ── Negocio ───────────────────────────────────────────────────── */

  const settingRows: Record<string, string> = {
    business_name: "Moksha",
    business_tagline: "Uñas, cejas y pestañas · Palermo",
    contact_phone: "11 0000-0000",
    contact_address: "Av. Santa Fe 3200, Palermo, CABA",
    contact_instagram: "moksha.demo",
    booking_window_days: "30",
    min_hours_before_booking: "2",
    cancel_cutoff_hours: "24",
    email_enabled: "false",
    transfer_enabled: "true",
    transfer_alias: "moksha.demo.turnos",
    transfer_holder: "Moksha Estética (demo)",
    transfer_bank: "Banco Demo",
  };
  await db
    .insert(s.settings)
    .values(Object.entries(settingRows).map(([key, value]) => ({ key, value })))
    // Las migraciones ya dejan algunas claves cargadas.
    .onConflictDoUpdate({ target: s.settings.key, set: { value: sql`excluded.value` } });

  /* ── Profesionales ─────────────────────────────────────────────── */

  const pros = await db
    .insert(s.professionals)
    .values([
      {
        name: "Carla Méndez",
        specialty: "Uñas",
        bio: "Manicura y nail art. Ocho años de oficio, fan de los diseños minimalistas.",
        sortOrder: 1,
      },
      {
        name: "Lucía Ferreyra",
        specialty: "Cejas y pestañas",
        bio: "Especialista en mirada: perfilado, laminado y lifting de pestañas.",
        sortOrder: 2,
      },
      {
        name: "Romina Paz",
        specialty: "Pies y manos",
        bio: "Pedicuría y spa de manos. Atiende martes a sábado.",
        sortOrder: 3,
      },
    ])
    .returning();
  const [carla, lucia, romina] = pros;

  await db.insert(s.adminUsers).values([
    { username: "admin", displayName: "Administración", role: "admin" as const, professionalId: null },
    { username: "carla", displayName: carla.name, role: "profesional" as const, professionalId: carla.id },
    { username: "lucia", displayName: lucia.name, role: "profesional" as const, professionalId: lucia.id },
    { username: "romina", displayName: romina.name, role: "profesional" as const, professionalId: romina.id },
  ].map((u) => ({
    ...u,
    passwordHash: bcrypt.hashSync(DEMO_PASSWORD, 10),
    // Vacío a propósito: sin email de contacto no se arma ningún aviso.
    email: "",
  })));

  /* ── Catálogo ──────────────────────────────────────────────────── */

  const [unas, mirada, pies] = await db
    .insert(s.serviceCategories)
    .values([
      { name: "Uñas", description: "Esmaltado, kapping y esculpidas", sortOrder: 1 },
      { name: "Cejas y pestañas", description: "Perfilado, laminado y lifting", sortOrder: 2 },
      { name: "Pies", description: "Pedicuría y spa", sortOrder: 3 },
    ])
    .returning();

  const svc = await db
    .insert(s.services)
    .values([
      {
        professionalId: carla.id, categoryId: unas.id, name: "Esmaltado semipermanente",
        durationMinutes: 60, price: 18000, sortOrder: 1,
        description: "Esmaltado que se cura con lámpara y dura unas tres semanas sin saltarse ni perder brillo. Incluye el retiro del anterior.",
      },
      {
        professionalId: carla.id, categoryId: unas.id, name: "Kapping gel",
        durationMinutes: 90, price: 24000, depositAmount: 5000, sortOrder: 2,
        description: "Refuerzo de la uña natural con gel. No alarga: cubre la uña propia para que no se quiebre. Dura entre tres y cuatro semanas.",
      },
      {
        professionalId: carla.id, categoryId: unas.id, name: "Esculpidas",
        durationMinutes: 120, price: 32000, depositAmount: 8000, sortOrder: 3,
        description: "Extensión de la uña con molde y gel, con el largo y la forma que elijas.",
      },
      {
        professionalId: lucia.id, categoryId: mirada.id, name: "Perfilado de cejas",
        durationMinutes: 30, price: 9000, sortOrder: 1,
        description: "Diseño según la forma de tu cara, con pinza y cera.",
      },
      {
        professionalId: lucia.id, categoryId: mirada.id, name: "Laminado de cejas",
        durationMinutes: 60, price: 20000, sortOrder: 2,
        description: "Alisa y fija el vello para que las cejas se vean más pobladas y prolijas. Dura de seis a ocho semanas.",
      },
      {
        professionalId: lucia.id, categoryId: mirada.id, name: "Lifting de pestañas",
        durationMinutes: 60, price: 22000, depositAmount: 5000, sortOrder: 3,
        description: "Curva las pestañas desde la raíz, sin extensiones. Incluye tinte.",
      },
      {
        professionalId: romina.id, categoryId: pies.id, name: "Pedicuría completa",
        durationMinutes: 60, price: 19000, sortOrder: 1,
        description: "Limado, cutículas, durezas e hidratación. Termina con esmaltado tradicional.",
      },
      {
        professionalId: romina.id, categoryId: pies.id, name: "Spa de pies",
        durationMinutes: 90, price: 26000, sortOrder: 2,
        description: "Pedicuría completa con exfoliación, máscara y masaje.",
      },
      {
        professionalId: romina.id, categoryId: unas.id, name: "Semipermanente en pies",
        durationMinutes: 45, price: 14000, sortOrder: 3,
      },
    ])
    .returning();

  /* ── Horarios ──────────────────────────────────────────────────── */

  type Range = [number, number];
  const h = (from: number, to: number): Range => [from * 60, to * 60];
  const week: Record<number, Record<number, Range[]>> = {
    // Carla: lunes a viernes cortado, sábado a la mañana.
    [carla.id]: {
      1: [h(9, 13), h(15, 19)], 2: [h(9, 13), h(15, 19)], 3: [h(9, 13), h(15, 19)],
      4: [h(9, 13), h(15, 19)], 5: [h(9, 13), h(15, 19)], 6: [h(9, 13)],
    },
    // Lucía: corrido, sin miércoles.
    [lucia.id]: {
      1: [h(10, 18)], 2: [h(10, 18)], 4: [h(10, 18)], 5: [h(10, 18)], 6: [h(10, 14)],
    },
    // Romina: martes a sábado, de tarde.
    [romina.id]: {
      2: [h(13, 20)], 3: [h(13, 20)], 4: [h(13, 20)], 5: [h(13, 20)], 6: [h(10, 16)],
    },
  };

  await db.insert(s.workingHours).values(
    Object.entries(week).flatMap(([pid, days]) =>
      Object.entries(days).flatMap(([weekday, ranges]) =>
        ranges.map(([startMinute, endMinute]) => ({
          professionalId: Number(pid),
          weekday: Number(weekday),
          startMinute,
          endMinute,
        })),
      ),
    ),
  );

  const today = nowInTz(TZ).date;
  const now = Math.floor(Date.now() / 1000);

  // Vacaciones de Lucía dentro de dos semanas, y un feriado con el local cerrado.
  const vacStart = addDays(today, 16);
  const vacEnd = addDays(today, 20);
  await db.insert(s.vacations).values({
    professionalId: lucia.id, startDate: vacStart, endDate: vacEnd, note: "Viaje",
  });
  const holiday = addDays(today, 9);
  await db.insert(s.scheduleOverrides).values(
    pros.map((p) => ({ professionalId: p.id, date: holiday, kind: "closed" as const, note: "Feriado" })),
  );
  // Un día con horario especial para Carla.
  await db.insert(s.scheduleOverrides).values({
    professionalId: carla.id, date: addDays(today, 4), kind: "custom",
    startMinute: 14 * 60, endMinute: 20 * 60, note: "Solo tarde",
  });

  /* ── Turnos ────────────────────────────────────────────────────── */

  const blocked = (pid: number, date: string) =>
    date === holiday || (pid === lucia.id && date >= vacStart && date <= vacEnd);

  const rangesFor = (pid: number, date: string): Range[] => {
    if (pid === carla.id && date === addDays(today, 4)) return [h(14, 20)];
    return week[pid][weekdayOf(date)] ?? [];
  };

  type Row = typeof s.appointments.$inferInsert;
  const rows: Row[] = [];
  let n = 0;

  for (let offset = -14; offset <= 21; offset++) {
    const date = addDays(today, offset);
    for (const pro of pros) {
      if (blocked(pro.id, date)) continue;
      const mine = svc.filter((x) => x.professionalId === pro.id);

      // Más lleno cerca de hoy, más vacío hacia adelante: como una agenda real.
      const fill = offset < 0 ? 0.75 : offset < 4 ? 0.7 : offset < 10 ? 0.5 : 0.25;

      for (const [start, end] of rangesFor(pro.id, date)) {
        let cursor = start;
        while (cursor < end) {
          const service = pick(mine);
          const finish = cursor + service.durationMinutes;
          if (finish > end) break;

          if (rand() < fill) {
            const c = client(n++);
            const manual = rand() < 0.25;
            const roll = rand();
            const status: Row["status"] =
              roll < 0.08 ? "cancelled_by_client" : roll < 0.11 ? "cancelled_by_admin" : "booked";
            const createdAt = now - Math.floor((offset < 0 ? 20 : 6) * 86400 * rand()) - 86400;

            rows.push({
              professionalId: pro.id,
              serviceId: service.id,
              serviceName: service.name,
              date,
              startMinute: cursor,
              endMinute: finish,
              status,
              ...(manual
                ? { firstName: c.firstName, phone: c.phone, origin: "manual" as const }
                : { ...c, origin: "online" as const }),
              notes: rand() < 0.15 ? pick(NOTES) : "",
              cancelTokenHash: hashToken(`demo-${n}`),
              createdAt,
              cancelledAt: status === "booked" ? null : createdAt + 3600 * 5,
            });
          }
          // Algún hueco entre turnos, para que la grilla respire.
          cursor = finish + (rand() < 0.3 ? 30 : 0);
        }
      }
    }
  }

  // Dos señas por transferencia esperando verificación en el panel.
  const kapping = svc.find((x) => x.name === "Kapping gel")!;
  const lifting = svc.find((x) => x.name === "Lifting de pestañas")!;
  const pending: [typeof kapping, number, number, number][] = [
    [kapping, 2, 16 * 60, 5000.37],
    [lifting, 3, 11 * 60, 5000.81],
  ];
  for (const [service, offset, start, amount] of pending) {
    let date = addDays(today, offset);
    while (!rangesFor(service.professionalId, date).length || blocked(service.professionalId, date)) {
      date = addDays(date, 1);
    }
    // Saca lo que el loop haya puesto en ese horario.
    for (let i = rows.length - 1; i >= 0; i--) {
      const r = rows[i];
      if (
        r.professionalId === service.professionalId && r.date === date &&
        r.startMinute < start + service.durationMinutes && r.endMinute > start
      ) rows.splice(i, 1);
    }
    const c = client(n++);
    rows.push({
      professionalId: service.professionalId,
      serviceId: service.id,
      serviceName: service.name,
      date,
      startMinute: start,
      endMinute: start + service.durationMinutes,
      status: "pending_payment",
      ...c,
      cancelTokenHash: hashToken(`demo-${n}`),
      createdAt: now - 3 * 3600,
      depositAmount: service.depositAmount,
      paymentMethod: "transfer",
      transferAmount: amount,
      transferDeclaredAt: offset === 2 ? now - 2 * 3600 : null,
      holdExpiresAt: now + 20 * 3600,
    });
  }

  // De a tandas: SQLite tiene un tope de variables por sentencia.
  const inserted: { id: number; date: string; status: string; phone: string }[] = [];
  for (let i = 0; i < rows.length; i += 50) {
    inserted.push(
      ...(await db.insert(s.appointments).values(rows.slice(i, i + 50)).returning({
        id: s.appointments.id,
        date: s.appointments.date,
        status: s.appointments.status,
        phone: s.appointments.phone,
      })),
    );
  }

  /* ── Cola de WhatsApp ──────────────────────────────────────────── */

  const confirmed = inserted.filter((a) => a.status === "booked" && a.phone);
  const queue = [
    // Confirmaciones de turnos reservados hoy que todavía no se mandaron.
    ...confirmed
      .filter((a) => a.date > today)
      .slice(0, 5)
      .map((a) => ({ appointmentId: a.id, kind: "confirmation" as const, dueDate: today })),
    // Recordatorios para volver a reservar: los primeros ya vencidos.
    ...confirmed
      .filter((a) => a.date < addDays(today, -10))
      .slice(0, 4)
      .map((a) => ({ appointmentId: a.id, kind: "rebooking" as const, dueDate: addDays(today, -1) })),
  ];
  if (queue.length) await db.insert(s.whatsappMessages).values(queue);

  raw.close();

  const count = (st: string) => inserted.filter((a) => a.status === st).length;
  console.log(`
  Demo lista en ${DEMO_DB} (base aparte, la de desarrollo no se tocó).

    ${pros.length} profesionales · ${svc.length} servicios · ${inserted.length} turnos
    ${count("booked")} confirmados · ${count("cancelled_by_client") + count("cancelled_by_admin")} cancelados · ${count("pending_payment")} transferencias por verificar

  Panel: http://localhost:3000/admin
    admin   / ${DEMO_PASSWORD}   ve todo
    carla   / ${DEMO_PASSWORD}   solo su agenda (también lucia, romina)

  Mails, Mercado Pago y subida de fotos: apagados.
`);
}

async function main() {
  await seed();
  if (process.argv.includes("--seed-only")) return;

  // Next hereda el entorno ya limpio de scripts/demo-env.ts.
  const next = spawn("npx", ["next", "dev"], { stdio: "inherit", env: process.env });
  next.on("exit", (code) => process.exit(code ?? 0));
}

main().catch((error) => {
  console.error("\n  No se pudo armar la demo:\n", error, "\n");
  process.exit(1);
});
