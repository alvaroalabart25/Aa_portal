import { Router } from 'express';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { ah } from '../../lib/async';
import { db } from '../../db';
import { bankAccounts, bankConnections, bankTransactions } from '../../db/schema';
import type { AuthedRequest } from '../../core/auth/middleware';
import {
  BancoApagado,
  ClaveIlegible,
  bancoConfigurado,
  bancosDisponibles,
  canjearSesion,
  crudo,
  iniciarAutorizacion,
  movimientosDe,
  saldosDe,
} from './banco';

/**
 * Las rutas del banco. Todo cuelga de /api/autonomo/banco y va con sesión
 * iniciada; cada consulta filtra por `user_id`, como el resto del portal.
 *
 * El camino de la autorización tiene un detalle importante: el banco devuelve
 * al NAVEGADOR, no a la API, así que la vuelta aterriza en el front (que sí
 * lleva la sesión del portal) y es él quien canjea el código llamando aquí.
 * Si el banco redirigiera directamente a la API no habría forma de saber qué
 * cuenta del portal está autorizando.
 */
export const bancoRouter = Router();

const DIAS_HISTORIAL = 90; // lo que se pide la primera vez

function urlDeVuelta(): string {
  const base = (process.env.FRONT_URL ?? 'http://localhost:5173').replace(/\/$/, '');
  return `${base}/autonomo/banco/vuelta`;
}

/** Traduce el fallo del conector a algo que se pueda leer en pantalla. */
function fallo(e: unknown): { status: number; error: string } {
  if (e instanceof BancoApagado) {
    return { status: 503, error: 'La conexión con el banco no está configurada todavía' };
  }
  if (e instanceof ClaveIlegible) return { status: 503, error: (e as Error).message };
  return { status: 502, error: (e as Error).message || 'El banco no ha respondido' };
}

// GET /estado — qué hay montado: si el conector vive y qué conexiones tienes
bancoRouter.get('/estado', ah(async (req: AuthedRequest, res) => {
  const conexiones = await db
    .select()
    .from(bankConnections)
    .where(and(eq(bankConnections.userId, req.userId!), sql`${bankConnections.status} <> 'revocada'`))
    .orderBy(desc(bankConnections.createdAt));

  const cuentas = await db
    .select()
    .from(bankAccounts)
    .where(and(eq(bankAccounts.userId, req.userId!), isNull(bankAccounts.archivedAt)));

  res.json({
    configurado: bancoConfigurado(),
    conexiones: conexiones.map((c) => ({
      id: c.id,
      banco: c.aspspName,
      pais: c.aspspCountry,
      estado: c.status,
      validoHasta: c.validUntil,
      ultimaSync: c.lastSyncAt,
      error: c.lastError,
      cuentas: cuentas
        .filter((a) => a.connectionId === c.id)
        .map((a) => ({
          id: a.id,
          nombre: a.name,
          iban: a.ibanTail,
          moneda: a.currency,
          saldo: a.balance,
          saldoAt: a.balanceAt,
        })),
    })),
  });
}));

// GET /bancos — la lista de bancos a los que se puede conectar
bancoRouter.get('/bancos', ah(async (req: AuthedRequest, res) => {
  try {
    const lista = await bancosDisponibles(String(req.query.pais ?? 'ES'));
    res.json(
      lista.map((b) => ({ nombre: b.name, pais: b.country, logo: b.logo ?? null })),
    );
  } catch (e) {
    const f = fallo(e);
    res.status(f.status).json({ error: f.error });
  }
}));

// POST /conectar — arranca la autorización y devuelve a dónde mandar al usuario
bancoRouter.post('/conectar', ah(async (req: AuthedRequest, res) => {
  const parsed = z
    .object({ banco: z.string().trim().min(1).max(120), pais: z.string().length(2).default('ES') })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Datos incorrectos' });

  // El `state` es nuestro billete: vuelve tal cual desde el banco y es lo que
  // ata la respuesta a esta conexión concreta.
  const state = randomUUID();
  const [r] = await db.insert(bankConnections).values({
    userId: req.userId!,
    aspspName: parsed.data.banco,
    aspspCountry: parsed.data.pais.toUpperCase(),
    authState: state,
    status: 'pendiente',
  });

  try {
    const auth = await iniciarAutorizacion({
      aspspName: parsed.data.banco,
      country: parsed.data.pais.toUpperCase(),
      state,
      redirectUrl: urlDeVuelta(),
    });
    res.json({ url: auth.url, conexionId: r.insertId });
  } catch (e) {
    // la conexión a medias no se queda de adorno en la lista
    await db.delete(bankConnections).where(eq(bankConnections.id, r.insertId));
    const f = fallo(e);
    res.status(f.status).json({ error: f.error });
  }
}));

// POST /vuelta — el front trae el código del banco y aquí se canjea
bancoRouter.post('/vuelta', ah(async (req: AuthedRequest, res) => {
  const parsed = z.object({ code: z.string().min(6), state: z.string().min(6) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Datos incorrectos' });

  const [conexion] = await db
    .select()
    .from(bankConnections)
    .where(and(eq(bankConnections.authState, parsed.data.state), eq(bankConnections.userId, req.userId!)));
  if (!conexion) return res.status(404).json({ error: 'Esa autorización no es de esta cuenta' });

  try {
    const sesion = await canjearSesion(parsed.data.code);
    await db
      .update(bankConnections)
      .set({
        sessionId: sesion.session_id,
        status: 'activa',
        authState: null,
        lastError: null,
        validUntil: sesion.access?.valid_until ? new Date(sesion.access.valid_until) : null,
      })
      .where(eq(bankConnections.id, conexion.id));

    // Las cuentas que el banco ha autorizado. Del IBAN, solo la cola.
    for (const cuenta of sesion.accounts ?? []) {
      const iban = cuenta.account_id?.iban ?? '';
      await db
        .insert(bankAccounts)
        .values({
          userId: req.userId!,
          connectionId: conexion.id,
          accountUid: cuenta.uid,
          name: cuenta.name ?? null,
          ibanTail: iban ? iban.slice(-4) : null,
          currency: cuenta.currency ?? 'EUR',
        })
        .onDuplicateKeyUpdate({ set: { name: cuenta.name ?? null, archivedAt: null } });
    }

    res.json({ ok: true, conexionId: conexion.id, cuentas: (sesion.accounts ?? []).length });
  } catch (e) {
    const f = fallo(e);
    await db.update(bankConnections).set({ lastError: f.error }).where(eq(bankConnections.id, conexion.id));
    res.status(f.status).json({ error: f.error });
  }
}));

// POST /sincronizar — traer saldos y movimientos nuevos
bancoRouter.post('/sincronizar/:id(\\d+)', ah(async (req: AuthedRequest, res) => {
  const id = Number(req.params.id);
  const [conexion] = await db
    .select()
    .from(bankConnections)
    .where(and(eq(bankConnections.id, id), eq(bankConnections.userId, req.userId!)));
  if (!conexion) return res.status(404).json({ error: 'No existe esa conexión' });
  if (conexion.status !== 'activa') return res.status(400).json({ error: 'Esa conexión no está activa' });

  const cuentas = await db
    .select()
    .from(bankAccounts)
    .where(and(eq(bankAccounts.connectionId, id), isNull(bankAccounts.archivedAt)));

  // Desde cuándo pedir: la primera vez, 90 días; después, desde el último
  // movimiento menos una semana (los bancos a veces contabilizan con retraso).
  const desde = new Date();
  desde.setDate(desde.getDate() - (conexion.lastSyncAt ? 7 : DIAS_HISTORIAL));
  const desdeIso = desde.toISOString().slice(0, 10);

  let nuevos = 0;
  try {
    for (const cuenta of cuentas) {
      const saldos = await saldosDe(cuenta.accountUid);
      const principal = saldos[0]?.balance_amount?.amount;
      if (principal != null) {
        await db
          .update(bankAccounts)
          .set({ balance: String(principal), balanceAt: new Date() })
          .where(eq(bankAccounts.id, cuenta.id));
      }

      const movimientos = await movimientosDe(cuenta.accountUid, desdeIso);
      for (const m of movimientos) {
        // Sin referencia del banco no hay forma de saber si ya lo tenemos: se
        // compone una con lo que sí es estable. Mejor eso que duplicar.
        const referencia =
          m.entry_reference ??
          `${m.booking_date ?? ''}|${m.transaction_amount?.amount ?? ''}|${(m.remittance_information ?? []).join(' ').slice(0, 40)}`;
        const importe = m.transaction_amount?.amount;
        if (!importe) continue;

        const [r] = await db
          .insert(bankTransactions)
          .values({
            userId: req.userId!,
            accountId: cuenta.id,
            entryReference: referencia.slice(0, 140),
            bookingDate: m.booking_date ?? null,
            valueDate: m.value_date ?? null,
            amount: String(importe),
            currency: m.transaction_amount?.currency ?? cuenta.currency,
            direction: m.credit_debit_indicator === 'CRDT' ? 'CRDT' : 'DBIT',
            counterparty: (m.credit_debit_indicator === 'CRDT' ? m.debtor?.name : m.creditor?.name)?.slice(0, 200) ?? null,
            concept: (m.remittance_information ?? []).join(' ').slice(0, 500) || null,
            status: (m.status ?? 'BOOK').slice(0, 8),
          })
          // ya lo teníamos: se refresca el estado (un PEND que pasa a BOOK) y
          // nada más. La clave única (cuenta, referencia) hace el trabajo.
          .onDuplicateKeyUpdate({ set: { status: (m.status ?? 'BOOK').slice(0, 8) } });
        // MySQL: 1 = insertado, 2 = ya estaba y se actualizó, 0 = ya estaba igual
        if (r.affectedRows === 1) nuevos += 1;
      }
    }

    await db
      .update(bankConnections)
      .set({ lastSyncAt: new Date(), lastError: null })
      .where(eq(bankConnections.id, id));
    res.json({ ok: true, nuevos });
  } catch (e) {
    const f = fallo(e);
    await db.update(bankConnections).set({ lastError: f.error }).where(eq(bankConnections.id, id));
    res.status(f.status).json({ error: f.error });
  }
}));

// GET /movimientos — lo que hay guardado, que es lo que se pinta
bancoRouter.get('/movimientos', ah(async (req: AuthedRequest, res) => {
  const limite = Math.min(Number(req.query.limite ?? 100), 300);
  const filas = await db
    .select({
      id: bankTransactions.id,
      fecha: bankTransactions.bookingDate,
      importe: bankTransactions.amount,
      moneda: bankTransactions.currency,
      direccion: bankTransactions.direction,
      contraparte: bankTransactions.counterparty,
      concepto: bankTransactions.concept,
      estado: bankTransactions.status,
      cuenta: bankAccounts.name,
      cuentaIban: bankAccounts.ibanTail,
    })
    .from(bankTransactions)
    .innerJoin(bankAccounts, eq(bankTransactions.accountId, bankAccounts.id))
    .where(eq(bankTransactions.userId, req.userId!))
    .orderBy(desc(bankTransactions.bookingDate), desc(bankTransactions.id))
    .limit(limite);
  res.json(filas);
}));

// GET /crudo — la respuesta del banco SIN interpretar, para poder mirarla.
// Es la herramienta del primer paso: antes de decidir qué se enseña, ver qué
// campos rellena de verdad cada banco. Solo cuentas propias.
bancoRouter.get('/crudo/:id(\\d+)', ah(async (req: AuthedRequest, res) => {
  const [cuenta] = await db
    .select()
    .from(bankAccounts)
    .where(and(eq(bankAccounts.id, Number(req.params.id)), eq(bankAccounts.userId, req.userId!)));
  if (!cuenta) return res.status(404).json({ error: 'No existe esa cuenta' });

  const desde = new Date();
  desde.setDate(desde.getDate() - Number(req.query.dias ?? DIAS_HISTORIAL));
  const uid = encodeURIComponent(cuenta.accountUid);
  try {
    const [saldos, movimientos] = await Promise.all([
      crudo(`/accounts/${uid}/balances`),
      crudo(`/accounts/${uid}/transactions?date_from=${desde.toISOString().slice(0, 10)}`),
    ]);
    res.json({ cuenta: cuenta.name, saldos, movimientos });
  } catch (e) {
    const f = fallo(e);
    res.status(f.status).json({ error: f.error });
  }
}));

// DELETE /conexiones/:id — desconectar el banco
// Los movimientos ya leídos se quedan: son tu histórico, no del banco.
bancoRouter.delete('/conexiones/:id(\\d+)', ah(async (req: AuthedRequest, res) => {
  const id = Number(req.params.id);
  const [r] = await db
    .update(bankConnections)
    .set({ status: 'revocada', sessionId: null })
    .where(and(eq(bankConnections.id, id), eq(bankConnections.userId, req.userId!)));
  if (r.affectedRows === 0) return res.status(404).json({ error: 'No existe esa conexión' });
  await db
    .update(bankAccounts)
    .set({ archivedAt: new Date() })
    .where(and(eq(bankAccounts.connectionId, id), eq(bankAccounts.userId, req.userId!)));
  res.json({ ok: true });
}));
