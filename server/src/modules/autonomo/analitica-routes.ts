import { Router } from 'express';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { ah } from '../../lib/async';
import { db } from '../../db';
import { bankAccounts, bankBalanceDaily, bankConnections, bankTransactions } from '../../db/schema';
import type { AuthedRequest } from '../../core/auth/middleware';
import { cicloDe, cicloPorId } from './ciclo';
import { CATEGORIAS, NOMBRE_CATEGORIA, NO_ES_GASTO, esCategoria } from './categorias';

/**
 * Analíticas: ¿el patrimonio crece o no?
 *
 * Es la única pregunta que importa aquí, y tiene truco: el portal guarda el
 * saldo de HOY y lo pisa en cada sincronización, así que no hay histórico que
 * dibujar.
 *
 * Pero no hace falta guardarlo para saberlo: **el saldo de un día pasado es el
 * de hoy menos todo lo que se movió después**. Con los saldos actuales y los
 * movimientos guardados se reconstruye la curva entera hacia atrás, sin haber
 * anotado nada en su momento.
 *
 * Dos avisos que la reconstrucción lleva dentro:
 *
 * - Solo llega hasta donde llegan los movimientos (90 días, lo que da PSD2).
 * - Los traspasos entre cuentas propias no afectan al total —lo que sale de una
 *   entra en otra—, así que se pueden ignorar... salvo que falte un lado. Por
 *   eso se cuentan TODOS los movimientos y no solo los que no son traspasos:
 *   el saldo total es el saldo total.
 */
export const analiticaRouter = Router();

const cent = (s: string | number) => Math.round(Number(s) * 100);

const llano = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim();

/**
 * De quién viene un ingreso.
 *
 * Cada banco lo esconde en un sitio: Revolut lo manda aparte, Santander lo mete
 * dentro del concepto detrás de «TRANSFERENCIA DE» o «BIZUM DE». Y hay que
 * normalizar la puntuación, que el mismo cliente aparece como «CSO DIGITAL SL.»
 * y como «CSO DIGITAL S.L.» y son dos filas distintas si no se limpia.
 */
function quienPaga(concepto: string | null, contraparte: string | null): string {
  if (contraparte) return normaliza(contraparte);
  const t = llano(concepto ?? '');
  const m =
    /^TRANSFERENCIA (?:INMEDIATA )?(?:DE|A FAVOR DE) ([^,]+)/.exec(t) ??
    /^BIZUM DE ([^,]+?)(?: CONCEPTO.*)?$/.exec(t) ??
    /^(?:ABONO|INGRESO) (?:DE )?([^,]+)/.exec(t);
  if (m) return normaliza(m[1]);
  if (/VENTA .*AC\./.test(t) || /ABONO (PRIMA|RENDIMIENTOS|DIVIDENDO)/.test(t)) return 'Venta de acciones';
  return normaliza(t.slice(0, 30)) || 'Sin identificar';
}

/**
 * En qué se va el dinero: el nombre del comercio.
 *
 * Está escondido en un sitio distinto en cada banco. Revolut lo manda limpio;
 * Santander lo mete detrás de «PAGO MOVIL EN» o «COMPRA»; Ibercaja detrás de
 * «TARJETA VISA». Con estos patrones sale de los 179 movimientos que no son
 * traspasos, y **27 comercios se repiten y cubren el 54%**: por eso agrupar por
 * comercio dice algo, en vez de ser una lista de 109 filas sueltas.
 */
function enQueGasto(concepto: string | null, contraparte: string | null): string {
  if (contraparte) return normaliza(contraparte);
  const t = llano(concepto ?? '');
  const m =
    /^PAGO MOVIL EN ([^,]+)/.exec(t) ??
    /^COMPRA ([^,]+)/.exec(t) ??
    /^TARJETA (?:VISA|MASTERCARD|DEBITO|CREDITO) (.+)/.exec(t) ??
    /^RECIBO ([^,]+)/.exec(t) ??
    /^BIZUM A FAVOR DE ([^,]+?)(?: CONCEPTO.*)?$/.exec(t) ??
    /^TRANSFERENCIA (?:INMEDIATA )?A FAVOR DE ([^,]+)/.exec(t);
  if (m) return normaliza(m[1]);
  if (/^LIQUIDACION DE LAS TARJETAS/.test(t)) return 'Tarjeta de crédito';
  if (/^DOMICILIACION IMPUESTO/.test(t)) return 'Hacienda';
  return normaliza(t.slice(0, 30)) || 'Sin identificar';
}

/** Quita puntos y sobrantes para que un mismo pagador sea una sola fila. */
function normaliza(nombre: string): string {
  return llano(nombre)
    .replace(/[.,]/g, '')
    .replace(/\b(S ?L|SL|SLU|SA|SOCIMI)\b/g, 'SL')
    .replace(/\s+/g, ' ')
    .trim();
}
const euros = (c: number) => Number((c / 100).toFixed(2));

analiticaRouter.get('/', ah(async (req: AuthedRequest, res) => {
  const userId = req.userId!;
  // El periodo se puede pedir de dos maneras: por días hacia atrás (lo rápido)
  // o por un rango concreto —un ciclo, un mes— que es lo que se compara de
  // verdad. El rango manda si viene.
  const esFecha = (v: unknown) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
  const rango = esFecha(req.query.desde) && esFecha(req.query.hasta)
    ? { desde: String(req.query.desde), hasta: String(req.query.hasta) }
    : null;
  const dias = rango
    ? Math.max(1, Math.round((new Date(rango.hasta).getTime() - new Date(rango.desde).getTime()) / 86400000) + 1)
    : Math.min(Math.max(Number(req.query.dias ?? 90), 30), 400);

  const cuentas = await db
    .select({
      id: bankAccounts.id,
      // el nombre del BANCO, no el del titular: el aviso de abajo dice a quién
      // hay que pedirle los apuntes que faltan
      nombre: bankConnections.aspspName,
      saldo: bankAccounts.balance,
      escrow: bankAccounts.escrow,
    })
    .from(bankAccounts)
    .innerJoin(bankConnections, eq(bankAccounts.connectionId, bankConnections.id))
    .where(and(eq(bankAccounts.userId, userId), isNull(bankAccounts.archivedAt)));

  const hoyTotal = cuentas.filter((c) => !c.escrow).reduce((a, c) => a + (c.saldo ? cent(c.saldo) : 0), 0);
  // lo que está en las cuentas pero no es suyo: el pocket de Hacienda
  const apartado = cuentas.filter((c) => c.escrow).reduce((a, c) => a + (c.saldo ? cent(c.saldo) : 0), 0);

  const movimientos = await db
    .select({
      cuentaId: bankTransactions.accountId,
      fecha: bankTransactions.bookingDate,
      importe: bankTransactions.amount,
      direccion: bankTransactions.direction,
      tipo: bankTransactions.tipo,
      concepto: bankTransactions.concept,
      contraparte: bankTransactions.counterparty,
      categoria: bankTransactions.category,
      escrow: bankAccounts.escrow,
    })
    .from(bankTransactions)
    .innerJoin(bankAccounts, eq(bankTransactions.accountId, bankAccounts.id))
    .where(eq(bankTransactions.userId, userId));

  const hoy = new Date(new Date().toISOString().slice(0, 10));
  // La curva se reconstruye SIEMPRE desde hoy hacia atrás —es la única forma,
  // partiendo del saldo actual—, y luego se recorta al rango pedido.
  const desde = rango ? new Date(rango.desde) : new Date(hoy.getTime() - dias * 86400000);
  const hasta = rango ? new Date(rango.hasta) : hoy;

  // El movimiento de un día cambia el saldo DE ESE DÍA, así que para saber el
  // saldo al cierre de un día hay que quitar lo de los días posteriores. Y se
  // hace CUENTA A CUENTA, no sobre el total: es lo único que permite darse
  // cuenta de que la reconstrucción se ha roto (ver más abajo).
  const porCuenta = new Map<number, Map<string, number>>();
  for (const m of movimientos) {
    if (!m.fecha || m.escrow) continue; // el pocket de Hacienda no es patrimonio
    const dias = porCuenta.get(m.cuentaId) ?? porCuenta.set(m.cuentaId, new Map()).get(m.cuentaId)!;
    dias.set(m.fecha, (dias.get(m.fecha) ?? 0) + cent(m.importe) * (m.direccion === 'CRDT' ? 1 : -1));
  }

  // Las fotos guardadas mandan sobre lo reconstruido: son el dato, no un cálculo
  const fotos = new Map(
    (
      await db
        .select({ fecha: bankBalanceDaily.onDate, total: bankBalanceDaily.total })
        .from(bankBalanceDaily)
        .where(eq(bankBalanceDaily.userId, userId))
    ).map((f) => [f.fecha, cent(f.total)]),
  );

  /**
   * Hasta dónde se puede reconstruir sin mentir.
   *
   * La reconstrucción da por hecho que TODOS los movimientos están guardados. Y
   * no siempre lo están: Santander e Ibercaja devuelven noventa días de apuntes
   * pero un saldo de hoy que no cuadra con ellos, así que al ir hacia atrás sus
   * cuentas acaban en números imposibles —el Santander llegaba a −315 €—, y el
   * total de arriba salía de restar eso.
   *
   * **Una cuenta corriente en negativo es la prueba de que faltan apuntes**, y
   * es una prueba que está dentro de los propios datos. Así que en cuanto una
   * cuenta se va por debajo de cero, se corta: de ahí hacia atrás no se dibuja
   * nada. Media curva de verdad vale más que una entera inventada.
   *
   * Un día con foto guardada nunca se corta: eso no es un cálculo, es el dato.
   */
  const TOLERANCIA = -100; // un euro de margen por redondeos del banco
  const saldos = new Map(
    cuentas.filter((c) => !c.escrow).map((c) => [c.id, c.saldo ? cent(c.saldo) : 0]),
  );

  const curva: { fecha: string; total: number; real: boolean }[] = [];
  let cortado: string | null = null;
  let cortadoPor: string[] = [];
  for (let t = hoy.getTime(); t >= desde.getTime(); t -= 86400000) {
    const fecha = new Date(t).toISOString().slice(0, 10);
    const foto = fotos.get(fecha);

    const imposibles = [...saldos].filter(([, v]) => v < TOLERANCIA);
    if (foto === undefined && imposibles.length) {
      cortado = fecha;
      // decir QUÉ cuenta rompe la reconstrucción: es lo que hace que el aviso
      // sirva para algo en vez de ser una disculpa genérica
      cortadoPor = [...new Set(imposibles.map(([id]) => cuentas.find((c) => c.id === id)?.nombre ?? 'una cuenta'))];
      break;
    }
    const total = [...saldos.values()].reduce((a, v) => a + v, 0);
    // fuera lo posterior al rango: se ha recorrido para llegar hasta aquí
    if (t <= hasta.getTime()) curva.unshift({ fecha, total: euros(foto ?? total), real: foto !== undefined });

    // deshaciendo el día, cuenta por cuenta, para llegar al anterior
    for (const [id, dias] of porCuenta) {
      if (!saldos.has(id)) continue;
      saldos.set(id, saldos.get(id)! - (dias.get(fecha) ?? 0));
    }
  }

  // Por ciclo: lo que de verdad contesta «¿crezco?». Los traspasos no cuentan.
  const cicloActual = cicloDe();
  const ciclos: {
    id: string;
    desde: string;
    hasta: string;
    entra: number;
    sale: number;
    diferencia: number;
    aHacienda: number;
    patrimonio: number;
    completo: boolean;
  }[] = [];
  for (let i = 5; i >= 0; i -= 1) {
    const [anio, mes] = cicloActual.id.split('-').map(Number);
    const c = cicloPorId(new Date(Date.UTC(anio, mes - 1 - i, 1)).toISOString().slice(0, 7));
    let entra = 0;
    let sale = 0;
    let aHacienda = 0;
    let patrimonio = 0;
    for (const m of movimientos) {
      if (!m.fecha || m.fecha < c.desde || m.fecha > c.hasta) continue;
      const importe = cent(m.importe);
      if (m.escrow) {
        // lo que entra en el pocket de Hacienda sale de su bolsillo aunque no
        // sea un gasto: es dinero que debe
        if (m.direccion === 'CRDT') aHacienda += importe;
        continue;
      }
      // El patrimonio se mueve con TODO lo que pasa por sus cuentas, traspasos
      // incluidos: si el dinero se va a un sitio que no leemos, se ha ido.
      patrimonio += m.direccion === 'CRDT' ? importe : -importe;
      if (m.tipo === 'traspaso') continue;
      if (m.direccion === 'CRDT') entra += importe;
      else sale += importe;
    }
    if (entra === 0 && sale === 0 && patrimonio === 0) continue;
    ciclos.push({
      ...c,
      // Un ciclo anterior al corte se calcula con apuntes que sabemos
      // incompletos: se enseña, pero diciendo que le falta histórico.
      completo: cortado === null || c.desde > cortado,
      entra: euros(entra),
      sale: euros(sale),
      diferencia: euros(entra - sale),
      aHacienda: euros(aHacienda),
      // lo que de verdad cambió tu bolsillo: es lo que tiene que cuadrar con la
      // curva de arriba, y no coincide con entra − sale
      patrimonio: euros(patrimonio),
    });
  }

  // De dónde viene el dinero, en la ventana pedida
  const desdeIso = desde.toISOString().slice(0, 10);
  const hastaIso = hasta.toISOString().slice(0, 10);
  const origenes = new Map<string, { n: number; importe: number; tipos: Map<string, number> }>();
  for (const m of movimientos) {
    if (!m.fecha || m.fecha < desdeIso || m.fecha > hastaIso || m.direccion !== 'CRDT' || m.tipo === 'traspaso') continue;
    const quien = quienPaga(m.concepto, m.contraparte);
    const x = origenes.get(quien) ?? { n: 0, importe: 0, tipos: new Map<string, number>() };
    x.n += 1;
    x.importe += cent(m.importe);
    x.tipos.set(m.tipo ?? 'otro', (x.tipos.get(m.tipo ?? 'otro') ?? 0) + 1);
    origenes.set(quien, x);
  }
  const dominante = (tipos: Map<string, number>) =>
    [...tipos].sort((a, z) => z[1] - a[1])[0]?.[0] ?? 'otro';
  const ingresos = [...origenes]
    .map(([nombre, x]) => ({ nombre, n: x.n, importe: euros(x.importe), tipo: dominante(x.tipos) }))
    .sort((a, z) => z.importe - a.importe);
  const totalIngresos = ingresos.reduce((a, i) => a + i.importe, 0);

  // Y en qué se va
  const destinos = new Map<string, { n: number; importe: number; tipos: Map<string, number> }>();
  for (const m of movimientos) {
    if (!m.fecha || m.fecha < desdeIso || m.fecha > hastaIso || m.direccion !== 'DBIT' || m.tipo === 'traspaso') continue;
    const donde = enQueGasto(m.concepto, m.contraparte);
    const x = destinos.get(donde) ?? { n: 0, importe: 0, tipos: new Map<string, number>() };
    x.n += 1;
    x.importe += cent(m.importe);
    x.tipos.set(m.tipo ?? 'otro', (x.tipos.get(m.tipo ?? 'otro') ?? 0) + 1);
    destinos.set(donde, x);
  }
  const gastos = [...destinos]
    .map(([nombre, x]) => ({ nombre, n: x.n, importe: euros(x.importe), tipo: dominante(x.tipos) }))
    .sort((a, z) => z.importe - a.importe);
  const totalGastos = gastos.reduce((a, g) => a + g.importe, 0);

  /**
   * Lo mismo, pero por CATEGORÍA: 91 comercios no se leen, nueve categorías sí.
   *
   * Lo que no se reconoce sale como «Sin categoría» y con su importe delante,
   * a la vista. Es el único sitio del portal donde un hueco es información:
   * dice cuánto de lo que gastas no sabemos todavía en qué se fue.
   */
  const porCategoria = new Map<string, { n: number; importe: number }>();
  for (const m of movimientos) {
    if (!m.fecha || m.fecha < desdeIso || m.fecha > hastaIso || m.direccion !== 'DBIT' || m.tipo === 'traspaso') continue;
    const k = m.categoria && esCategoria(m.categoria) ? m.categoria : 'sin';
    const x = porCategoria.get(k) ?? { n: 0, importe: 0 };
    x.n += 1;
    x.importe += cent(m.importe);
    porCategoria.set(k, x);
  }
  const categorias = [
    ...CATEGORIAS.map((c) => ({
      categoria: c as string,
      nombre: NOMBRE_CATEGORIA[c],
      n: porCategoria.get(c)?.n ?? 0,
      importe: euros(porCategoria.get(c)?.importe ?? 0),
      // guardar no es gastar: se enseña, pero aparte
      gasto: !NO_ES_GASTO.includes(c),
    })),
    {
      categoria: 'sin',
      nombre: 'Sin categoría',
      n: porCategoria.get('sin')?.n ?? 0,
      importe: euros(porCategoria.get('sin')?.importe ?? 0),
      gasto: true,
    },
  ].filter((c) => c.n > 0);
  // Lo guardado sale de la cuenta pero no desaparece: separarlo es la
  // diferencia entre «este mes he gastado 900» y «he gastado 700 y guardado 200»
  const guardado = categorias.filter((c) => !c.gasto).reduce((a, c) => a + c.importe, 0);

  const primero = curva[0]?.total ?? 0;
  const ultimo = curva[curva.length - 1]?.total ?? 0;

  res.json({
    dias,
    periodo: { desde: desdeIso, hasta: hastaIso },
    categorias,
    guardado,
    // Lo que tienes HOY: la suma de tus cuentas sin el pocket de Hacienda. Es un
    // dato leído, no un cálculo, y por eso va antes que nada.
    hoy: euros(hoyTotal),
    apartado: euros(apartado),
    curva,
    // Desde cuándo la curva es creíble, y qué cuenta impide llegar más atrás
    fiableDesde: curva[0]?.fecha ?? null,
    cortado,
    cortadoPor,
    // cuántos puntos son foto guardada y cuántos reconstrucción
    fotos: curva.filter((p) => p.real).length,
    // hasta dónde se puede mirar de verdad: no hay histórico anterior al banco
    desdeQueHay: movimientos.reduce<string | null>(
      (min, m) => (m.fecha && (!min || m.fecha < min) ? m.fecha : min),
      null,
    ),
    cambio: { desde: primero, hasta: ultimo, diferencia: euros(cent(ultimo) - cent(primero)) },
    ciclos,
    ingresos: ingresos.map((i) => ({ ...i, porcentaje: Math.round((100 * i.importe) / (totalIngresos || 1)) })),
    totalIngresos: Number(totalIngresos.toFixed(2)),
    gastos: gastos.map((g) => ({ ...g, porcentaje: Math.round((100 * g.importe) / (totalGastos || 1)) })),
    totalGastos: Number(totalGastos.toFixed(2)),
  });
}));
