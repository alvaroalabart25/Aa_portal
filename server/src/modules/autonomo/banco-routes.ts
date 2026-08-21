import { Router } from 'express';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { and, desc, eq, gte, inArray, isNull, lte, sql } from 'drizzle-orm';
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
import { NOMBRE_TIPO, TIPOS, emparejarTraspasos, tipoDeMovimiento, type Tipo } from './tipos';

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

/** Los últimos 120 días: el emparejado necesita ver los dos lados, no el mes. */
const VENTANA_TRASPASOS = 120;

/**
 * Recalcula qué movimientos son traspasos entre cuentas propias.
 *
 * Se hace aparte de la clasificación porque un traspaso no se puede ver
 * mirando un movimiento solo: hace falta el cargo en un banco Y el abono en el
 * otro. Es idempotente: cada vez borra las parejas de la ventana y las vuelve
 * a calcular, así que arreglar la regla es volver a llamarla.
 */
async function recalcularTraspasos(userId: number): Promise<number> {
  const desde = new Date();
  desde.setDate(desde.getDate() - VENTANA_TRASPASOS);
  const desdeIso = desde.toISOString().slice(0, 10);

  const filas = await db
    .select({
      id: bankTransactions.id,
      accountId: bankTransactions.accountId,
      amount: bankTransactions.amount,
      direction: bankTransactions.direction,
      bookingDate: bankTransactions.bookingDate,
      bankCode: bankTransactions.bankCode,
      concept: bankTransactions.concept,
      tipo: bankTransactions.tipo,
    })
    .from(bankTransactions)
    .where(and(eq(bankTransactions.userId, userId), gte(bankTransactions.bookingDate, desdeIso)));

  if (filas.length === 0) return 0;

  // Se parte de cero: si ayer algo se emparejó mal, hoy se deshace.
  await db
    .update(bankTransactions)
    .set({ pairId: null })
    .where(
      and(
        eq(bankTransactions.userId, userId),
        gte(bankTransactions.bookingDate, desdeIso),
        sql`${bankTransactions.pairId} is not null`,
      ),
    );

  const parejas = emparejarTraspasos(filas);
  for (const [salida, entrada] of parejas) {
    await db
      .update(bankTransactions)
      .set({ pairId: entrada, tipo: 'traspaso' })
      .where(and(eq(bankTransactions.id, salida), eq(bankTransactions.userId, userId)));
    await db
      .update(bankTransactions)
      .set({ pairId: salida, tipo: 'traspaso' })
      .where(and(eq(bankTransactions.id, entrada), eq(bankTransactions.userId, userId)));
  }
  return parejas.length;
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

        const concepto = (m.remittance_information ?? []).join(' ').slice(0, 500) || null;
        const codigoBanco = m.bank_transaction_code?.code?.slice(0, 40) ?? null;

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
            concept: concepto,
            status: (m.status ?? 'BOOK').slice(0, 8),
            bankCode: codigoBanco,
            tipo: tipoDeMovimiento({ bankCode: codigoBanco, concept: concepto }),
          })
          // ya lo teníamos: se refresca el estado (un PEND que pasa a BOOK) y
          // nada más. La clave única (cuenta, referencia) hace el trabajo.
          // ya lo teníamos: además del estado se refrescan código y tipo, que
          // es como se pone al día lo guardado antes de que esto existiera
          .onDuplicateKeyUpdate({
            set: {
              status: (m.status ?? 'BOOK').slice(0, 8),
              bankCode: codigoBanco,
              tipo: tipoDeMovimiento({ bankCode: codigoBanco, concept: concepto }),
            },
          });
        // MySQL: 1 = insertado, 2 = ya estaba y se actualizó, 0 = ya estaba igual
        if (r.affectedRows === 1) nuevos += 1;
      }
    }

    // Los traspasos solo se ven con los DOS lados delante, así que se
    // recalculan al final y sobre todas las cuentas, no solo las de este banco.
    const traspasos = await recalcularTraspasos(req.userId!);

    await db
      .update(bankConnections)
      .set({ lastSyncAt: new Date(), lastError: null })
      .where(eq(bankConnections.id, id));
    res.json({ ok: true, nuevos, traspasos });
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
      tipo: bankTransactions.tipo,
    })
    .from(bankTransactions)
    .innerJoin(bankAccounts, eq(bankTransactions.accountId, bankAccounts.id))
    .where(eq(bankTransactions.userId, req.userId!))
    .orderBy(desc(bankTransactions.bookingDate), desc(bankTransactions.id))
    .limit(limite);
  // el nombre del tipo lo pone el servidor: una sola lista de nombres, no dos
  res.json(
    filas.map((f) => ({
      ...f,
      tipoNombre: f.tipo && f.tipo in NOMBRE_TIPO ? NOMBRE_TIPO[f.tipo as Tipo] : null,
    })),
  );
}));

// POST /reclasificar — volver a poner el tipo a todo lo guardado
//
// Existe porque la regla va a mejorar: cuando se afine, esto lo aplica a lo que
// ya está en casa sin volver a pedirle nada al banco. No toca importes ni
// fechas, solo la etiqueta.
bancoRouter.post('/reclasificar', ah(async (req: AuthedRequest, res) => {
  const filas = await db
    .select({
      id: bankTransactions.id,
      bankCode: bankTransactions.bankCode,
      concept: bankTransactions.concept,
    })
    .from(bankTransactions)
    .where(eq(bankTransactions.userId, req.userId!));

  // Una sentencia por tipo en vez de una por movimiento: son 344 hoy, pero
  // serán 4.000 en un año y la base está en Oregón.
  const porTipo = new Map<Tipo, number[]>();
  for (const f of filas) {
    const t = tipoDeMovimiento(f);
    (porTipo.get(t) ?? porTipo.set(t, []).get(t)!).push(f.id);
  }
  for (const [tipo, ids] of porTipo) {
    for (let i = 0; i < ids.length; i += 200) {
      await db
        .update(bankTransactions)
        .set({ tipo })
        .where(and(eq(bankTransactions.userId, req.userId!), inArray(bankTransactions.id, ids.slice(i, i + 200))));
    }
  }

  const traspasos = await recalcularTraspasos(req.userId!);
  res.json({
    ok: true,
    movimientos: filas.length,
    traspasos,
    sinClasificar: porTipo.get('otro')?.length ?? 0,
  });
}));

// GET /resumen?mes=YYYY-MM — el mes de verdad
//
// La pantalla 1. Su única razón de ser: los traspasos NO son ni ingreso ni
// gasto. Sin descontarlos, 2.140 € que solo pasaron de Santander a Revolut se
// cuentan dos veces y el mes miente. Se devuelven aparte y contados para que
// eso se pueda auditar en pantalla, no para que haya que creerse el número.
bancoRouter.get('/resumen', ah(async (req: AuthedRequest, res) => {
  const hoy = new Date().toISOString().slice(0, 7);
  const mes = /^\d{4}-(0[1-9]|1[0-2])$/.test(String(req.query.mes ?? '')) ? String(req.query.mes) : hoy;
  const [anio, m] = mes.split('-').map(Number);
  const ultimoDia = new Date(Date.UTC(anio, m, 0)).getUTCDate();
  const desde = `${mes}-01`;
  const hasta = `${mes}-${String(ultimoDia).padStart(2, '0')}`;

  const cuentas = await db
    .select({
      id: bankAccounts.id,
      nombre: bankAccounts.name,
      iban: bankAccounts.ibanTail,
      moneda: bankAccounts.currency,
      saldo: bankAccounts.balance,
      saldoAt: bankAccounts.balanceAt,
      banco: bankConnections.aspspName,
    })
    .from(bankAccounts)
    .innerJoin(bankConnections, eq(bankAccounts.connectionId, bankConnections.id))
    .where(and(eq(bankAccounts.userId, req.userId!), isNull(bankAccounts.archivedAt)));

  const filas = await db
    .select({
      importe: bankTransactions.amount,
      direccion: bankTransactions.direction,
      fecha: bankTransactions.bookingDate,
      tipo: bankTransactions.tipo,
    })
    .from(bankTransactions)
    .where(
      and(
        eq(bankTransactions.userId, req.userId!),
        gte(bankTransactions.bookingDate, desde),
        lte(bankTransactions.bookingDate, hasta),
      ),
    );

  // En céntimos: con decimales en coma flotante, 0,1 + 0,2 no es 0,3.
  const cent = (s: string) => Math.round(Number(s) * 100);
  const euros = (c: number) => Number((c / 100).toFixed(2));

  let entra = 0;
  let sale = 0;
  let traspasos = 0;
  let nTraspasos = 0;
  const semanas = [1, 8, 15, 22].map((d) => ({
    etiqueta: `${d}–${d === 22 ? ultimoDia : d + 6}`,
    entra: 0,
    sale: 0,
  }));
  const tipos = new Map<string, { n: number; entra: number; sale: number }>();

  for (const f of filas) {
    const c = cent(f.importe);
    const tipo = (f.tipo ?? 'otro') as Tipo;
    const t = tipos.get(tipo) ?? { n: 0, entra: 0, sale: 0 };
    t.n += 1;
    if (f.direccion === 'CRDT') t.entra += c;
    else t.sale += c;
    tipos.set(tipo, t);

    if (tipo === 'traspaso') {
      // se cuentan aparte: es dinero cambiando de bolsillo, no del mes
      if (f.direccion === 'DBIT') {
        traspasos += c;
        nTraspasos += 1;
      } else nTraspasos += 1;
      continue;
    }

    if (f.direccion === 'CRDT') entra += c;
    else sale += c;

    const dia = Number((f.fecha ?? `${desde}`).slice(8, 10));
    const hueco = semanas[Math.min(3, Math.floor((dia - 1) / 7))];
    if (f.direccion === 'CRDT') hueco.entra += c;
    else hueco.sale += c;
  }

  const [primero] = await db
    .select({ fecha: sql<string | null>`min(${bankTransactions.bookingDate})` })
    .from(bankTransactions)
    .where(eq(bankTransactions.userId, req.userId!));

  res.json({
    mes,
    primerMes: primero?.fecha ? String(primero.fecha).slice(0, 7) : mes,
    saldo: {
      total: euros(cuentas.reduce((a, c) => a + (c.saldo ? cent(c.saldo) : 0), 0)),
      at: cuentas.map((c) => c.saldoAt).filter(Boolean).sort().pop() ?? null,
      cuentas: cuentas.map((c) => ({
        id: c.id,
        banco: c.banco,
        nombre: c.nombre,
        iban: c.iban,
        moneda: c.moneda,
        saldo: c.saldo ? Number(c.saldo) : null,
      })),
    },
    movimientos: filas.length,
    entra: euros(entra),
    sale: euros(sale),
    queda: euros(entra - sale),
    traspasos: { n: nTraspasos, importe: euros(traspasos) },
    semanas: semanas.map((s) => ({ ...s, entra: euros(s.entra), sale: euros(s.sale) })),
    tipos: TIPOS.filter((t) => tipos.has(t)).map((t) => ({
      tipo: t,
      nombre: NOMBRE_TIPO[t],
      n: tipos.get(t)!.n,
      entra: euros(tipos.get(t)!.entra),
      sale: euros(tipos.get(t)!.sale),
    })),
  });
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
