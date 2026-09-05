import { Router } from 'express';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { and, desc, eq, gte, inArray, isNull, lte, ne, sql } from 'drizzle-orm';
import { ah } from '../../lib/async';
import { db } from '../../db';
import { bankAccounts, bankBalanceDaily, bankCategoryRules, bankConnections, bankTransactions } from '../../db/schema';
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
  saldoPrincipal,
  saldosDe,
} from './banco';
import { NOMBRE_TIPO, TIPOS, emparejarTraspasos, nombraAlTitular, tipoDeMovimiento, type Tipo } from './tipos';
import {
  CATEGORIAS,
  NOMBRE_CATEGORIA,
  categoriaDe,
  comercioDe,
  esCategoria,
  type Categoria,
  type Regla,
} from './categorias';
import { CICLO_DIA } from './ciclo';

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

/**
 * Cuánto se espera cuando el banco dice que ya no hay más consultas hoy.
 *
 * No se puede saber a qué hora reponen el cupo —cada banco lo hace a su manera—,
 * así que en vez de adivinar se espera un rato y se vuelve a probar. Si sigue
 * agotado, otro rato. Nunca se queda bloqueado para siempre.
 */
/**
 * El cupo de PSD2 se cuenta POR DÍA, no por horas.
 *
 * Estaba en tres horas y era mentira: gastado el cupo a mediodía, a las tres
 * horas seguía gastado, y cada intento fallido volvía a sumar otras tres —así
 * que insistir alejaba el momento de poder sincronizar—. Ahora se espera al día
 * siguiente, que es cuando el banco lo repone de verdad.
 */
function manana(): Date {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(0, 5, 0, 0);
  return d;
}

const esCupoAgotado = (mensaje: string) => /HUB046|\(429\)/.test(mensaje);

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

  const mensaje = (e as Error).message ?? '';
  // PSD2 limita las consultas que se pueden hacer sin que el usuario esté
  // delante (unas pocas al día por consentimiento). Pasa de verdad y hay que
  // decirlo en español: «HUB046» no le dice nada a nadie.
  if (/HUB046|\(429\)/.test(mensaje)) {
    return {
      status: 429,
      error:
        'El banco solo permite unas cuantas consultas al día y hoy ya están gastadas. Mañana vuelve a funcionar solo.',
    };
  }
  // El consentimiento caducado se arregla volviendo a autorizar, no esperando
  if (/HUB012|consent.*(expired|invalid)|401/i.test(mensaje)) {
    return {
      status: 401,
      error: 'El permiso de este banco ha caducado o se ha revocado. Hay que volver a autorizarlo desde aquí.',
    };
  }
  return { status: 502, error: (e as Error).message || 'El banco no ha respondido' };
}

/**
 * Guarda la foto de hoy: cuánto hay en total y cuánto de eso no es suyo.
 *
 * Se hace al terminar cada sincronización. Una foto por día —la última manda—,
 * y así el patrimonio tiene histórico de verdad en vez de depender de que los
 * movimientos sigan estando ahí.
 */
async function retratarPatrimonio(userId: number): Promise<void> {
  const cuentas = await db
    .select({ saldo: bankAccounts.balance, escrow: bankAccounts.escrow })
    .from(bankAccounts)
    .where(and(eq(bankAccounts.userId, userId), isNull(bankAccounts.archivedAt)));
  if (cuentas.length === 0) return;

  const suma = (cuales: typeof cuentas) =>
    cuales.reduce((a, c) => a + (c.saldo ? Math.round(Number(c.saldo) * 100) : 0), 0);
  const propias = cuentas.filter((c) => !c.escrow);
  const hoy = new Date().toISOString().slice(0, 10);

  await db
    .insert(bankBalanceDaily)
    .values({
      userId,
      onDate: hoy,
      total: (suma(propias) / 100).toFixed(2),
      escrow: (suma(cuentas.filter((c) => c.escrow)) / 100).toFixed(2),
      accounts: propias.length,
    })
    .onDuplicateKeyUpdate({
      set: {
        total: (suma(propias) / 100).toFixed(2),
        escrow: (suma(cuentas.filter((c) => c.escrow)) / 100).toFixed(2),
        accounts: propias.length,
      },
    });
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
/** Las reglas que ha corregido él. Van primero: mandan sobre la semilla. */
async function reglasDe(userId: number): Promise<Regla[]> {
  const filas = await db
    .select()
    .from(bankCategoryRules)
    .where(eq(bankCategoryRules.userId, userId))
    .orderBy(bankCategoryRules.sortOrder, bankCategoryRules.id);
  return filas.map((f) => ({ patron: f.patron, tipo: f.tipo, categoria: f.category as Categoria }));
}

/**
 * Vuelve a categorizar todo lo guardado y escribe solo lo que CAMBIA.
 *
 * Se llama después de emparejar traspasos, no antes: un movimiento que resulta
 * ser un traspaso entre sus cuentas no lleva categoría, y eso no se sabe hasta
 * tener los dos lados delante.
 */
async function recategorizar(userId: number): Promise<{ categorizados: number; sin: number }> {
  const reglas = await reglasDe(userId);
  const filas = await db
    .select({
      id: bankTransactions.id,
      concept: bankTransactions.concept,
      counterparty: bankTransactions.counterparty,
      tipo: bankTransactions.tipo,
      direction: bankTransactions.direction,
      category: bankTransactions.category,
    })
    .from(bankTransactions)
    .where(eq(bankTransactions.userId, userId));

  // Una sentencia por categoría en vez de una por movimiento: la base está en
  // Oregón y cada consulta cuesta 165 ms.
  const cambios = new Map<Categoria | null, number[]>();
  let categorizados = 0;
  let sin = 0;
  for (const f of filas) {
    // Los ingresos no se categorizan: en qué se GASTA es otra pregunta, y
    // «de dónde entra» ya se agrupa por quién paga.
    const nueva = f.direction === 'DBIT' ? categoriaDe(f, reglas) : null;
    if (nueva) categorizados += 1;
    else if (f.direction === 'DBIT' && f.tipo !== 'traspaso') sin += 1;
    if ((f.category ?? null) === nueva) continue;
    (cambios.get(nueva) ?? cambios.set(nueva, []).get(nueva)!).push(f.id);
  }
  for (const [categoria, ids] of cambios) {
    for (let i = 0; i < ids.length; i += 200) {
      await db
        .update(bankTransactions)
        .set({ category: categoria })
        .where(and(eq(bankTransactions.userId, userId), inArray(bankTransactions.id, ids.slice(i, i + 200))));
    }
  }
  return { categorizados, sin };
}

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

  // Lo que el banco llama «titular»: si su nombre está en el concepto, el
  // dinero no ha salido de su patrimonio, solo ha cambiado de sitio.
  const titulares = (
    await db
      .selectDistinct({ nombre: bankAccounts.name })
      .from(bankAccounts)
      .where(eq(bankAccounts.userId, userId))
  )
    .map((c) => c.nombre)
    .filter((n): n is string => Boolean(n));

  const propios = filas.filter((f) => f.tipo !== 'traspaso' && nombraAlTitular(f.concept, titulares));
  for (let i = 0; i < propios.length; i += 200) {
    await db
      .update(bankTransactions)
      .set({ tipo: 'traspaso' })
      .where(
        and(
          eq(bankTransactions.userId, userId),
          inArray(
            bankTransactions.id,
            propios.slice(i, i + 200).map((f) => f.id),
          ),
        ),
      );
  }

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

  const marcados = new Set(propios.map((f) => f.id));
  const parejas = emparejarTraspasos(
    filas.map((f) => (marcados.has(f.id) ? { ...f, tipo: 'traspaso' } : f)),
  );
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
      reintentarDesde: c.retryAfter,
      cuentas: cuentas
        .filter((a) => a.connectionId === c.id)
        .map((a) => ({
          id: a.id,
          // el nombre del banco manda: «Hacienda 💶» dice más que el titular
          nombre: a.alias ?? a.name,
          iban: a.ibanTail,
          moneda: a.currency,
          saldo: a.balance,
          saldoAt: a.balanceAt,
          ajena: a.escrow,
        })),
    })),
  });
}));

// GET /bancos — la lista de bancos a los que se puede conectar
bancoRouter.get('/bancos', ah(async (req: AuthedRequest, res) => {
  try {
    const lista = await bancosDisponibles(String(req.query.pais ?? 'ES'));
    // ?crudo= devuelve lo que el banco anuncia DE SÍ MISMO (qué productos
    // expone, qué métodos de autorización, cuánto dura el consentimiento). No
    // hay ni un dato personal ahí, y es la única forma de contestar a «¿se
    // puede leer la tarjeta de crédito?» sin ir preguntando por ahí.
    const buscado = String(req.query.crudo ?? '').trim();
    if (buscado) {
      const uno = lista.find((b) => b.name.toLowerCase() === buscado.toLowerCase());
      return res.json(uno ?? { error: 'ese banco no está en la lista', hay: lista.length });
    }
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
    //
    // OJO con reautorizar el mismo banco: eso crea una conexión NUEVA, y la
    // clave única de una cuenta es (conexión, uid). Sin buscarla antes por uid,
    // cada cuenta entraría otra vez como cuenta distinta —con su saldo contado
    // dos veces en el patrimonio y sus 90 días de movimientos duplicados—. Así
    // que si la cuenta ya existe, se MUDA a la conexión nueva con su historia
    // dentro.
    for (const cuenta of sesion.accounts ?? []) {
      const iban = cuenta.account_id?.iban ?? '';
      // Reconocerla por su HUELLA, no por el uid: el uid cambia en cada
      // sesión. Y si aún no tiene huella guardada —las de antes de esto—, por
      // la cola del IBAN, que para las cuentas con IBAN también es estable.
      const huella = cuenta.identification_hash ?? null;
      const suyas = await db
        .select({ id: bankAccounts.id, identHash: bankAccounts.identHash, ibanTail: bankAccounts.ibanTail })
        .from(bankAccounts)
        .where(eq(bankAccounts.userId, req.userId!));
      const cola = iban ? iban.slice(-4) : null;
      const ya =
        (huella ? suyas.find((s) => s.identHash === huella) : undefined) ??
        (cola ? suyas.find((s) => !s.identHash && s.ibanTail === cola) : undefined);

      if (ya) {
        await db
          .update(bankAccounts)
          .set({
            connectionId: conexion.id,
            accountUid: cuenta.uid,
            identHash: huella,
            name: cuenta.name ?? null,
            ibanTail: cola,
            archivedAt: null,
          })
          .where(eq(bankAccounts.id, ya.id));
        continue;
      }

      await db
        .insert(bankAccounts)
        .values({
          userId: req.userId!,
          connectionId: conexion.id,
          accountUid: cuenta.uid,
          identHash: huella,
          name: cuenta.name ?? null,
          ibanTail: cola,
          currency: cuenta.currency ?? 'EUR',
        })
        .onDuplicateKeyUpdate({ set: { name: cuenta.name ?? null, archivedAt: null } });
    }

    // Las conexiones viejas del mismo banco que se han quedado sin ninguna
    // cuenta ya no sirven para nada: dejarlas «activas» solo consigue que
    // alguien le dé a sincronizar y gaste una consulta del cupo diario.
    const viejas = await db
      .select({ id: bankConnections.id })
      .from(bankConnections)
      .where(
        and(
          eq(bankConnections.userId, req.userId!),
          eq(bankConnections.aspspName, conexion.aspspName),
          eq(bankConnections.status, 'activa'),
          ne(bankConnections.id, conexion.id),
        ),
      );
    for (const v of viejas) {
      const [{ n }] = await db
        .select({ n: sql<number>`count(*)` })
        .from(bankAccounts)
        .where(and(eq(bankAccounts.connectionId, v.id), isNull(bankAccounts.archivedAt)));
      if (Number(n) === 0) {
        await db.update(bankConnections).set({ status: 'revocada' }).where(eq(bankConnections.id, v.id));
      }
    }

    /**
     * Una sesión sin cuentas no es una conexión: es un permiso vacío.
     *
     * Pasa en las aplicaciones en modo restringido —la nuestra lo está—: el
     * banco autoriza lo que le pidas, pero Enable Banking solo deja pasar las
     * cuentas que estén vinculadas en su panel. Si autorizas una que no lo
     * está, la sesión vuelve sin ninguna. Decir «conectado» ahí era mentira, y
     * dejaba una conexión fantasma en la pantalla.
     */
    if ((sesion.accounts ?? []).length === 0) {
      await db
        .update(bankConnections)
        .set({ status: 'revocada', sessionId: null, lastError: 'La autorización volvió sin ninguna cuenta' })
        .where(eq(bankConnections.id, conexion.id));
      return res.status(400).json({
        error:
          'El banco no ha dado acceso a ninguna cuenta. Si acabas de autorizar una nueva, ' +
          'antes hay que vincularla en el panel de Enable Banking: en modo restringido solo ' +
          'pasan las cuentas vinculadas ahí.',
      });
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

  // Si el banco ya dijo que no hay más consultas, no se le vuelve a molestar:
  // gastaría otra llamada para recibir el mismo no.
  if (conexion.retryAfter && conexion.retryAfter > new Date()) {
    return res.status(429).json({
      error: 'El banco no acepta más consultas por ahora. Se puede volver a intentar más tarde.',
      reintentarDesde: conexion.retryAfter,
    });
  }

  const cuentas = await db
    .select()
    .from(bankAccounts)
    .where(and(eq(bankAccounts.connectionId, id), isNull(bankAccounts.archivedAt)));

  // Desde cuándo pedir: la primera vez, 90 días; después, una semana (los
  // bancos a veces contabilizan con retraso). Con ?dias= se puede forzar el
  // historial entero, que es lo que hace falta cuando cambia la forma de
  // clasificar: repasa lo viejo sin tener que volver a autorizar nada.
  const pedidos = Number(req.query.dias ?? 0);
  const ventana = pedidos > 0 ? Math.min(pedidos, DIAS_HISTORIAL) : conexion.lastSyncAt ? 7 : DIAS_HISTORIAL;
  const desde = new Date();
  desde.setDate(desde.getDate() - ventana);
  const desdeIso = desde.toISOString().slice(0, 10);

  // ?nombres=1 vuelve a preguntar cómo llama el banco a cada cuenta. Por defecto
  // solo se pregunta si falta: es una llamada más por cuenta y Enable Banking
  // limita los accesos por consentimiento (HUB046).
  const refrescarNombres = req.query.nombres === '1';

  let nuevos = 0;
  try {
    for (const cuenta of cuentas) {
      if (refrescarNombres || !cuenta.alias) {
        try {
          const d = (await crudo(`/accounts/${encodeURIComponent(cuenta.accountUid)}/details`)) as {
            details?: string | null;
          };
          if (d?.details) {
            await db
              .update(bankAccounts)
              .set({ alias: d.details.slice(0, 80) })
              .where(eq(bankAccounts.id, cuenta.id));
          }
        } catch {
          // que no se sepa el nombre no puede tumbar una sincronización
        }
      }

      const saldos = await saldosDe(cuenta.accountUid);
      // por TIPO, no por posición: ver `saldoPrincipal`
      const principal = saldoPrincipal(saldos)?.balance_amount?.amount;
      if (principal != null) {
        await db
          .update(bankAccounts)
          .set({ balance: String(principal), balanceAt: new Date() })
          .where(eq(bankAccounts.id, cuenta.id));
      }

      const movimientos = await movimientosDe(cuenta.accountUid, desdeIso);
      // Lo que el banco dice que existe AHORA en esta cuenta. Se usa al final
      // para barrer los pendientes que ya no están (ver más abajo).
      const vistas: string[] = [];
      for (const m of movimientos) {
        // Sin referencia del banco no hay forma de saber si ya lo tenemos: se
        // compone una con lo que sí es estable. Mejor eso que duplicar.
        const referencia =
          m.entry_reference ??
          `${m.booking_date ?? ''}|${m.transaction_amount?.amount ?? ''}|${(m.remittance_information ?? []).join(' ').slice(0, 40)}`;
        const importe = m.transaction_amount?.amount;
        if (!importe) continue;
        vistas.push(referencia.slice(0, 140));

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

      // Un pendiente es EFÍMERO, y esa es la única regla fiable aquí. Cuando se
      // contabiliza puede volver con otra referencia, otra fecha —pendiente el
      // sábado, contabilizado el lunes— o hasta otro concepto, así que
      // reconocerlo por parecido es adivinar. Lo que sí se sabe: el banco
      // devuelve en cada pasada los que SIGUEN pendientes. El que teníamos y ya
      // no viene, o se contabilizó (y el bueno acaba de entrar con su
      // referencia buena) o se anuló. En los dos casos nuestra copia sobra, y
      // si se queda infla los ingresos del ciclo y hunde la reconstrucción del
      // patrimonio.
      //
      // Barrer y volver a insertar, nunca reescribir la referencia de la fila
      // vieja: al contabilizarse, el bueno YA está guardado con esa referencia
      // y el intento choca con la clave única —que fue justo lo que dejó a
      // Santander sin poder sincronizar—.
      //
      // Solo dentro de la ventana que se ha pedido, y solo si el banco ha
      // devuelto algo: con una respuesta vacía —un fallo, un cupo agotado— no
      // se borra nada.
      if (vistas.length) {
        await db
          .delete(bankTransactions)
          .where(
            and(
              eq(bankTransactions.accountId, cuenta.id),
              eq(bankTransactions.status, 'PDNG'),
              sql`(${bankTransactions.bookingDate} is null or ${bankTransactions.bookingDate} >= ${desdeIso})`,
              sql`${bankTransactions.entryReference} not in (${sql.join(vistas.map((v) => sql`${v}`), sql`, `)})`,
            ),
          );
      }
    }

    // Los traspasos solo se ven con los DOS lados delante, así que se
    // recalculan al final y sobre todas las cuentas, no solo las de este banco.
    const traspasos = await recalcularTraspasos(req.userId!);
    // después de emparejar: un traspaso no lleva categoría y eso no se sabe
    // hasta tener los dos lados
    await recategorizar(req.userId!);
    await retratarPatrimonio(req.userId!);

    await db
      .update(bankConnections)
      .set({ lastSyncAt: new Date(), lastError: null, retryAfter: null })
      .where(eq(bankConnections.id, id));
    res.json({ ok: true, nuevos, traspasos });
  } catch (e) {
    const f = fallo(e);
    const espera = esCupoAgotado((e as Error).message ?? '')
      ? manana()
      : null;
    await db
      .update(bankConnections)
      .set({ lastError: f.error, ...(espera ? { retryAfter: espera } : {}) })
      .where(eq(bankConnections.id, id));
    res.status(f.status).json({ error: f.error, ...(espera ? { reintentarDesde: espera } : {}) });
  }
}));

/**
 * GET /movimientos — el libro, con filtros.
 *
 * Ordenado por fecha porque es como se busca un movimiento («eso fue por
 * agosto»), pero se puede ordenar por importe para encontrar lo gordo. Los
 * filtros y la búsqueda van en el servidor y no en la pantalla: hoy son 344
 * movimientos, en dos años serán 4.000 y no se pueden mandar todos al móvil.
 *
 * Devuelve también QUÉ se puede filtrar —los bancos y los tipos que existen de
 * verdad en sus datos— para que la pantalla no ofrezca filtros vacíos.
 */
bancoRouter.get('/movimientos', ah(async (req: AuthedRequest, res) => {
  const limite = Math.min(Number(req.query.limite ?? 100), 500);
  const pagina = Math.max(0, Number(req.query.pagina ?? 0));
  const banco = String(req.query.banco ?? '').trim();
  const tipo = String(req.query.tipo ?? '').trim();
  const categoria = String(req.query.categoria ?? '').trim();
  const busca = String(req.query.q ?? '').trim();
  const orden = req.query.orden === 'importe' ? 'importe' : 'fecha';
  const asc = req.query.dir === 'asc';

  const condiciones = [eq(bankTransactions.userId, req.userId!)];
  if (banco) condiciones.push(eq(bankConnections.aspspName, banco));
  if (tipo) condiciones.push(eq(bankTransactions.tipo, tipo));
  // «sin» es un filtro de verdad, no la ausencia de filtro: es la lista de lo
  // que hay que enseñarle para que la corrija
  if (categoria === 'sin') condiciones.push(and(isNull(bankTransactions.category), eq(bankTransactions.direction, 'DBIT'))!);
  else if (categoria) condiciones.push(eq(bankTransactions.category, categoria));
  // Casi la mitad de sus movimientos son traspasos entre cuentas propias —los
  // redondeos de Revolut son céntimos— y ahogan el listado. Se esconden salvo
  // que se pidan, igual que no cuentan en el mes.
  if (!tipo && req.query.traspasos !== '1') {
    condiciones.push(sql`${bankTransactions.tipo} <> 'traspaso'`);
  }
  if (busca) {
    // TiDB compara distinguiendo mayúsculas (utf8mb4_bin), así que buscar
    // «apple» no encontraría «COMPRA APPLE.COM/BILL». Se iguala a mano.
    const patron = `%${busca.toUpperCase()}%`;
    condiciones.push(
      sql`(upper(${bankTransactions.concept}) like ${patron} or upper(${bankTransactions.counterparty}) like ${patron})`,
    );
  }
  const donde = and(...condiciones);

  const columnaOrden =
    orden === 'importe'
      ? sql`${bankTransactions.amount} + 0`
      : sql`${bankTransactions.bookingDate}`;

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
      cuenta: sql<string | null>`coalesce(${bankAccounts.alias}, ${bankAccounts.name})`,
      cuentaIban: bankAccounts.ibanTail,
      banco: bankConnections.aspspName,
      tipo: bankTransactions.tipo,
      categoria: bankTransactions.category,
    })
    .from(bankTransactions)
    .innerJoin(bankAccounts, eq(bankTransactions.accountId, bankAccounts.id))
    .innerJoin(bankConnections, eq(bankAccounts.connectionId, bankConnections.id))
    .where(donde)
    .orderBy(asc ? sql`${columnaOrden} asc` : sql`${columnaOrden} desc`, desc(bankTransactions.id))
    .limit(limite)
    .offset(pagina * limite);

  const [{ total }] = await db
    .select({ total: sql<number>`count(*)` })
    .from(bankTransactions)
    .innerJoin(bankAccounts, eq(bankTransactions.accountId, bankAccounts.id))
    .innerJoin(bankConnections, eq(bankAccounts.connectionId, bankConnections.id))
    .where(donde);

  // Lo que se puede filtrar, sacado de sus datos y no de una lista inventada
  const bancos = await db
    .selectDistinct({ nombre: bankConnections.aspspName })
    .from(bankTransactions)
    .innerJoin(bankAccounts, eq(bankTransactions.accountId, bankAccounts.id))
    .innerJoin(bankConnections, eq(bankAccounts.connectionId, bankConnections.id))
    .where(eq(bankTransactions.userId, req.userId!));

  const tipos = await db
    .select({ tipo: bankTransactions.tipo, n: sql<number>`count(*)` })
    .from(bankTransactions)
    .where(eq(bankTransactions.userId, req.userId!))
    .groupBy(bankTransactions.tipo);

  const categorias = await db
    .select({ categoria: bankTransactions.category, n: sql<number>`count(*)` })
    .from(bankTransactions)
    .where(and(eq(bankTransactions.userId, req.userId!), eq(bankTransactions.direction, 'DBIT')))
    .groupBy(bankTransactions.category);

  res.json({
    total: Number(total),
    pagina,
    limite,
    movimientos: filas.map((f) => ({
      ...f,
      tipoNombre: f.tipo && f.tipo in NOMBRE_TIPO ? NOMBRE_TIPO[f.tipo as Tipo] : null,
      categoriaNombre: f.categoria && esCategoria(f.categoria) ? NOMBRE_CATEGORIA[f.categoria] : null,
    })),
    bancos: bancos.map((b) => b.nombre).sort(),
    tipos: TIPOS.filter((t) => tipos.some((x) => x.tipo === t)).map((t) => ({
      tipo: t,
      nombre: NOMBRE_TIPO[t],
      n: Number(tipos.find((x) => x.tipo === t)?.n ?? 0),
    })),
    // Todas las categorías, tengan o no movimientos: aquí la lista completa no
    // es ruido, es lo que se puede elegir al corregir uno.
    categorias: [
      ...CATEGORIAS.map((c) => ({
        categoria: c as string,
        nombre: NOMBRE_CATEGORIA[c],
        n: Number(categorias.find((x) => x.categoria === c)?.n ?? 0),
      })),
      {
        categoria: 'sin',
        nombre: 'Sin categoría',
        n: Number(categorias.find((x) => x.categoria === null)?.n ?? 0),
      },
    ],
  });
}));

/**
 * PATCH /movimientos/:id/categoria — corregir en qué se fue el dinero.
 *
 * Corregir UNO corrige TODOS los del mismo sitio, y se guarda como regla: si
 * dice que GoPay es comida, el mes que viene los 26 movimientos de GoPay ya
 * nacen siendo comida. Un portal en el que hay que reetiquetar lo mismo cada
 * mes se abandona en dos meses.
 *
 * Con `todos: false` se cambia solo ese movimiento —una compra rara en un
 * comercio que normalmente es otra cosa—, pero entonces no se crea regla y una
 * recategorización lo devolvería a su sitio. Se dice en pantalla.
 */
bancoRouter.patch('/movimientos/:id(\\d+)/categoria', ah(async (req: AuthedRequest, res) => {
  const cuerpo = z
    .object({ categoria: z.string().nullable(), todos: z.boolean().optional() })
    .safeParse(req.body);
  if (!cuerpo.success) return res.status(400).json({ error: 'Falta la categoría' });

  const categoria = cuerpo.data.categoria;
  if (categoria !== null && !esCategoria(categoria)) return res.status(400).json({ error: 'Esa categoría no existe' });

  const [mov] = await db
    .select({
      id: bankTransactions.id,
      concept: bankTransactions.concept,
      counterparty: bankTransactions.counterparty,
      tipo: bankTransactions.tipo,
    })
    .from(bankTransactions)
    .where(and(eq(bankTransactions.id, Number(req.params.id)), eq(bankTransactions.userId, req.userId!)));
  if (!mov) return res.status(404).json({ error: 'No existe ese movimiento' });

  const comercio = comercioDe(mov);
  const conRegla = cuerpo.data.todos !== false && Boolean(comercio) && categoria !== null;

  if (conRegla) {
    // Una regla por comercio: si ya la había, se cambia a dónde apunta en vez
    // de apilar dos que se contradicen.
    const [previa] = await db
      .select({ id: bankCategoryRules.id })
      .from(bankCategoryRules)
      .where(and(eq(bankCategoryRules.userId, req.userId!), eq(bankCategoryRules.patron, comercio!)));
    if (previa) {
      await db.update(bankCategoryRules).set({ category: categoria }).where(eq(bankCategoryRules.id, previa.id));
    } else {
      await db.insert(bankCategoryRules).values({ userId: req.userId!, patron: comercio, category: categoria });
    }
  }

  if (conRegla) {
    const { categorizados, sin } = await recategorizar(req.userId!);
    return res.json({ ok: true, regla: comercio, categorizados, sinCategoria: sin });
  }

  await db
    .update(bankTransactions)
    .set({ category: categoria })
    .where(and(eq(bankTransactions.id, mov.id), eq(bankTransactions.userId, req.userId!)));
  res.json({ ok: true, regla: null });
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
  const categorias = await recategorizar(req.userId!);
  res.json({
    ok: true,
    movimientos: filas.length,
    traspasos,
    sinClasificar: porTipo.get('otro')?.length ?? 0,
    categorizados: categorias.categorizados,
    sinCategoria: categorias.sin,
  });
}));

// GET /resumen?mes=YYYY-MM — el mes de verdad
//
// La pantalla 1. Su única razón de ser: los traspasos NO son ni ingreso ni
// gasto. Sin descontarlos, 2.140 € que solo pasaron de Santander a Revolut se
// cuentan dos veces y el mes miente. Se devuelven aparte y contados para que
// eso se pueda auditar en pantalla, no para que haya que creerse el número.
bancoRouter.get('/resumen', ah(async (req: AuthedRequest, res) => {
  // Su mes NO es el del calendario: cobra del 24 al 30, así que un día 21 el mes
  // natural enseña 21 días de gasto y ningún ingreso, y parece un socavón. Por
  // ciclo, todos sus meses cerrados salen en positivo. El mes natural se queda
  // disponible porque los trimestres de Hacienda sí son naturales.
  const ciclo = req.query.ciclo === '1' || req.query.ciclo === 'true';
  const ahora = new Date();
  const vigente = new Date(
    Date.UTC(ahora.getUTCFullYear(), ahora.getUTCMonth() - (ciclo && ahora.getUTCDate() < CICLO_DIA ? 1 : 0), 1),
  )
    .toISOString()
    .slice(0, 7);
  const mes = /^\d{4}-(0[1-9]|1[0-2])$/.test(String(req.query.mes ?? '')) ? String(req.query.mes) : vigente;
  const [anio, m] = mes.split('-').map(Number);

  // El ciclo se nombra por el mes en que ARRANCA, que es cuando entra el cobro
  const inicio = new Date(Date.UTC(anio, m - 1, ciclo ? CICLO_DIA : 1));
  const fin = ciclo ? new Date(Date.UTC(anio, m, CICLO_DIA - 1)) : new Date(Date.UTC(anio, m, 0));
  const desde = inicio.toISOString().slice(0, 10);
  const hasta = fin.toISOString().slice(0, 10);
  const totalDias = Math.round((fin.getTime() - inicio.getTime()) / 86400000) + 1;

  const cuentas = await db
    .select({
      id: bankAccounts.id,
      nombre: bankAccounts.name,
      alias: bankAccounts.alias,
      iban: bankAccounts.ibanTail,
      moneda: bankAccounts.currency,
      saldo: bankAccounts.balance,
      saldoAt: bankAccounts.balanceAt,
      escrow: bankAccounts.escrow,
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
  // Cuatro tramos repartidos por el periodo, sea del 1 al 31 o del 24 al 23
  const corte = (i: number) => Math.floor((i * totalDias) / 4);
  const diaDelPeriodo = (offset: number) => {
    const d = new Date(inicio.getTime() + offset * 86400000);
    return d.getUTCDate();
  };
  const semanas = [0, 1, 2, 3].map((i) => ({
    etiqueta: `${diaDelPeriodo(corte(i))}–${diaDelPeriodo(i === 3 ? totalDias - 1 : corte(i + 1) - 1)}`,
    entra: 0,
    sale: 0,
  }));
  const tramoDe = (offset: number) => {
    let i = 3;
    while (i > 0 && offset < corte(i)) i -= 1;
    return i;
  };

  // Serie día a día del periodo: es lo que dibuja la gráfica. Se rellenan TODOS
  // los días, también los vacíos, porque una línea con huecos miente sobre el
  // ritmo al que entra y sale el dinero.
  const dias = Array.from({ length: totalDias }, (_, i) => ({
    fecha: new Date(inicio.getTime() + i * 86400000).toISOString().slice(0, 10),
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

    const offset = Math.max(
      0,
      Math.min(totalDias - 1, Math.round((new Date(f.fecha ?? desde).getTime() - inicio.getTime()) / 86400000)),
    );
    const hueco = semanas[tramoDe(offset)];
    if (f.direccion === 'CRDT') {
      hueco.entra += c;
      dias[offset].entra += c;
    } else {
      hueco.sale += c;
      dias[offset].sale += c;
    }
  }

  const [primero] = await db
    .select({ fecha: sql<string | null>`min(${bankTransactions.bookingDate})` })
    .from(bankTransactions)
    .where(eq(bankTransactions.userId, req.userId!));

  // El primer periodo con datos, para no dejar navegar hacia un vacío
  let primerMes = mes;
  if (primero?.fecha) {
    const p = new Date(String(primero.fecha));
    primerMes = ciclo
      ? new Date(Date.UTC(p.getUTCFullYear(), p.getUTCMonth() - (p.getUTCDate() < CICLO_DIA ? 1 : 0), 1))
          .toISOString()
          .slice(0, 7)
      : String(primero.fecha).slice(0, 7);
  }

  res.json({
    mes,
    // el periodo en curso, para que la pantalla sepa hasta dónde puede avanzar
    vigente,
    ciclo,
    desde,
    hasta,
    primerMes,
    saldo: {
      // El total es lo que es SUYO. El pocket de Hacienda guarda el IVA de cada
      // factura: es dinero que debe, no que tiene, y sumarlo sería mentir.
      total: euros(
        cuentas.filter((c) => !c.escrow).reduce((a, c) => a + (c.saldo ? cent(c.saldo) : 0), 0),
      ),
      ajeno: euros(cuentas.filter((c) => c.escrow).reduce((a, c) => a + (c.saldo ? cent(c.saldo) : 0), 0)),
      cuentasAjenas: cuentas.filter((c) => c.escrow).map((c) => c.alias ?? c.nombre),
      propias: cuentas.filter((c) => !c.escrow).length,
      at: cuentas.map((c) => c.saldoAt).filter(Boolean).sort().pop() ?? null,
      cuentas: cuentas.map((c) => ({
        id: c.id,
        banco: c.banco,
        nombre: c.alias ?? c.nombre,
        iban: c.iban,
        moneda: c.moneda,
        saldo: c.saldo ? Number(c.saldo) : null,
        ajena: c.escrow,
      })),
    },
    movimientos: filas.length,
    entra: euros(entra),
    sale: euros(sale),
    queda: euros(entra - sale),
    traspasos: { n: nTraspasos, importe: euros(traspasos) },
    semanas: semanas.map((s) => ({ ...s, entra: euros(s.entra), sale: euros(s.sale) })),
    dias: dias.map((d) => ({ ...d, entra: euros(d.entra), sale: euros(d.sale) })),
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
    // ?que=details pregunta QUÉ es esta cuenta (producto, tipo, uso). Es lo que
    // dice si el banco expone tarjetas de crédito como cuenta o solo la
    // corriente.
    if (String(req.query.que ?? '') === 'details') {
      return res.json({ cuenta: cuenta.name, detalles: await crudo(`/accounts/${uid}/details`) });
    }
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

/**
 * DELETE /cuentas/:id — quitar UNA cuenta, no el banco entero.
 *
 * Existe porque una autorización trae todas las cuentas que el banco enseña, y
 * entre ellas puede colarse una que no pinta nada aquí —una cuenta conjunta,
 * por ejemplo—. Desconectar el banco entero para librarse de una era matar
 * moscas a cañonazos.
 *
 * Aquí sí se BORRAN sus movimientos: si la cuenta no debía estar, su histórico
 * tampoco, y más si es compartida con otra persona. Por eso la pantalla dice
 * cuántos son antes de preguntar.
 */
bancoRouter.delete('/cuentas/:id(\\d+)', ah(async (req: AuthedRequest, res) => {
  const id = Number(req.params.id);
  const [cuenta] = await db
    .select()
    .from(bankAccounts)
    .where(and(eq(bankAccounts.id, id), eq(bankAccounts.userId, req.userId!)));
  if (!cuenta) return res.status(404).json({ error: 'No existe esa cuenta' });

  const [movs] = await db
    .delete(bankTransactions)
    .where(and(eq(bankTransactions.accountId, id), eq(bankTransactions.userId, req.userId!)));
  await db.delete(bankAccounts).where(and(eq(bankAccounts.id, id), eq(bankAccounts.userId, req.userId!)));

  // Si el banco se queda sin ninguna cuenta, esa conexión ya no sirve: dejarla
  // activa solo consigue que alguien le dé a sincronizar y gaste cupo.
  const [{ n }] = await db
    .select({ n: sql<number>`count(*)` })
    .from(bankAccounts)
    .where(and(eq(bankAccounts.connectionId, cuenta.connectionId), isNull(bankAccounts.archivedAt)));
  if (Number(n) === 0) {
    await db
      .update(bankConnections)
      .set({ status: 'revocada', sessionId: null })
      .where(eq(bankConnections.id, cuenta.connectionId));
  }

  res.json({ ok: true, movimientos: movs.affectedRows });
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
