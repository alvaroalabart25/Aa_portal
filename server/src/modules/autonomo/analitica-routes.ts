import { Router } from 'express';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { ah } from '../../lib/async';
import { db } from '../../db';
import { bankAccounts, bankBalanceDaily, bankTransactions } from '../../db/schema';
import type { AuthedRequest } from '../../core/auth/middleware';
import { cicloDe, cicloPorId } from './ciclo';

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
    .select({ saldo: bankAccounts.balance, escrow: bankAccounts.escrow })
    .from(bankAccounts)
    .where(and(eq(bankAccounts.userId, userId), isNull(bankAccounts.archivedAt)));

  const hoyTotal = cuentas.filter((c) => !c.escrow).reduce((a, c) => a + (c.saldo ? cent(c.saldo) : 0), 0);

  const movimientos = await db
    .select({
      fecha: bankTransactions.bookingDate,
      importe: bankTransactions.amount,
      direccion: bankTransactions.direction,
      tipo: bankTransactions.tipo,
      concepto: bankTransactions.concept,
      contraparte: bankTransactions.counterparty,
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
  // saldo al cierre de un día hay que quitar lo de los días posteriores.
  const porDia = new Map<string, number>();
  for (const m of movimientos) {
    if (!m.fecha || m.escrow) continue; // el pocket de Hacienda no es patrimonio
    const c = cent(m.importe) * (m.direccion === 'CRDT' ? 1 : -1);
    porDia.set(m.fecha, (porDia.get(m.fecha) ?? 0) + c);
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

  const curva: { fecha: string; total: number; real: boolean }[] = [];
  let saldo = hoyTotal;
  for (let t = hoy.getTime(); t >= desde.getTime(); t -= 86400000) {
    const fecha = new Date(t).toISOString().slice(0, 10);
    const foto = fotos.get(fecha);
    // fuera lo posterior al rango: se ha recorrido para llegar hasta aquí
    if (t <= hasta.getTime()) curva.unshift({ fecha, total: euros(foto ?? saldo), real: foto !== undefined });
    saldo -= porDia.get(fecha) ?? 0; // deshaciendo el día para llegar al anterior
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
  const origenes = new Map<string, { n: number; importe: number }>();
  for (const m of movimientos) {
    if (!m.fecha || m.fecha < desdeIso || m.fecha > hastaIso || m.direccion !== 'CRDT' || m.tipo === 'traspaso') continue;
    const quien = quienPaga(m.concepto, m.contraparte);
    const x = origenes.get(quien) ?? { n: 0, importe: 0 };
    x.n += 1;
    x.importe += cent(m.importe);
    origenes.set(quien, x);
  }
  const ingresos = [...origenes]
    .map(([nombre, x]) => ({ nombre, n: x.n, importe: euros(x.importe) }))
    .sort((a, z) => z.importe - a.importe);
  const totalIngresos = ingresos.reduce((a, i) => a + i.importe, 0);

  // Y en qué se va
  const destinos = new Map<string, { n: number; importe: number }>();
  for (const m of movimientos) {
    if (!m.fecha || m.fecha < desdeIso || m.fecha > hastaIso || m.direccion !== 'DBIT' || m.tipo === 'traspaso') continue;
    const donde = enQueGasto(m.concepto, m.contraparte);
    const x = destinos.get(donde) ?? { n: 0, importe: 0 };
    x.n += 1;
    x.importe += cent(m.importe);
    destinos.set(donde, x);
  }
  const gastos = [...destinos]
    .map(([nombre, x]) => ({ nombre, n: x.n, importe: euros(x.importe) }))
    .sort((a, z) => z.importe - a.importe);
  const totalGastos = gastos.reduce((a, g) => a + g.importe, 0);

  const primero = curva[0]?.total ?? 0;
  const ultimo = curva[curva.length - 1]?.total ?? 0;

  res.json({
    dias,
    periodo: { desde: desdeIso, hasta: hastaIso },
    curva,
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
