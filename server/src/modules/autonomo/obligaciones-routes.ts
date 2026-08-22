import { Router } from 'express';
import { and, desc, eq, gte, inArray, isNull, lte, sql } from 'drizzle-orm';
import { ah } from '../../lib/async';
import { db } from '../../db';
import {
  bankAccounts,
  bankConnections,
  bankTransactions,
  financialCommitments,
  invoices,
} from '../../db/schema';
import type { AuthedRequest } from '../../core/auth/middleware';
import { cicloDe, trimestreDe } from './ciclo';
import { detectarFijos } from './fijos';

/**
 * Obligaciones: lo que debes, cuándo se paga y si tienes con qué.
 *
 * Contesta a una pregunta que hoy solo se puede responder reconstruyéndola a
 * mano: **¿voy al día?**. No es una lista de gastos: es una lista de
 * compromisos, y cada uno se compara contra DINERO REAL leído del banco. Eso es
 * lo que la separa de una hoja de cálculo, que solo sabe lo que deberías tener.
 *
 * La línea que más valor tiene es la más tonta: «la cuota sale el 31 y en esa
 * cuenta hay 2,13 €». Esa información existe hoy en dos sitios distintos —el
 * calendario del recibo y el saldo del banco— y nadie los junta.
 */
export const obligacionesRouter = Router();

const cent = (s: string | number) => Math.round(Number(s) * 100);
const euros = (c: number) => Number((c / 100).toFixed(2));
const hoyIso = () => new Date().toISOString().slice(0, 10);

/** Cuánto queda para una fecha, en días. Negativo si ya pasó. */
const faltanDias = (iso: string) =>
  Math.ceil((new Date(iso).getTime() - new Date(hoyIso()).getTime()) / 86400000);

/**
 * Lo que el banco deja deducir del IVA cuando faltan facturas por registrar.
 *
 * Un cobro suyo de 1.590 € es base 1.500 + 21% de IVA − 15% de IRPF, o sea
 * base × 1,06. Deshaciendo esa cuenta se saca el IVA que lleva dentro. Es una
 * estimación y la pantalla lo dice: el IVA se declara por fecha de FACTURA, no
 * de cobro.
 */
function ivaSegunCobros(importes: number[], ivaPct: number, irpfPct: number): number {
  const factor = 1 + ivaPct / 100 - irpfPct / 100;
  // en CÉNTIMOS, como todo lo demás de este fichero
  return importes.reduce((total, importe) => total + Math.round((importe / factor) * (ivaPct / 100) * 100), 0);
}

obligacionesRouter.get('/', ah(async (req: AuthedRequest, res) => {
  const userId = req.userId!;
  const ciclo = cicloDe();
  const trimestre = trimestreDe();

  // ---------------------------------------------------------------- cuentas
  const cuentas = await db
    .select({
      id: bankAccounts.id,
      nombre: sql<string | null>`coalesce(${bankAccounts.alias}, ${bankAccounts.name})`,
      saldo: bankAccounts.balance,
      escrow: bankAccounts.escrow,
      banco: bankConnections.aspspName,
    })
    .from(bankAccounts)
    .innerJoin(bankConnections, eq(bankAccounts.connectionId, bankConnections.id))
    .where(and(eq(bankAccounts.userId, userId), isNull(bankAccounts.archivedAt)));

  const apartado = cuentas
    .filter((c) => c.escrow)
    .reduce((a, c) => a + (c.saldo ? cent(c.saldo) : 0), 0);

  // -------------------------------------------------------------------- IVA
  const facturas = await db
    .select({ kind: invoices.kind, iva: invoices.vatAmount, vatPct: invoices.vatPct, irpfPct: invoices.irpfPct })
    .from(invoices)
    .where(
      and(
        eq(invoices.userId, userId),
        isNull(invoices.archivedAt),
        gte(invoices.issueDate, trimestre.desde),
        lte(invoices.issueDate, trimestre.hasta),
      ),
    );

  const repercutido = facturas.filter((f) => f.kind === 'income').reduce((a, f) => a + cent(f.iva), 0);
  const soportado = facturas.filter((f) => f.kind === 'expense').reduce((a, f) => a + cent(f.iva), 0);

  // Los tipos que usa de verdad, de su última factura emitida
  const [ultima] = await db
    .select({ vatPct: invoices.vatPct, irpfPct: invoices.irpfPct })
    .from(invoices)
    .where(and(eq(invoices.userId, userId), eq(invoices.kind, 'income'), isNull(invoices.archivedAt)))
    .orderBy(desc(invoices.issueDate))
    .limit(1);
  const ivaPct = Number(ultima?.vatPct ?? 21);
  const irpfPct = Number(ultima?.irpfPct ?? 15);

  // Cobros de clientes vistos en el banco dentro del trimestre: sirven para
  // avisar de que faltan facturas por registrar, no para declarar.
  const cobros = await db
    .select({ importe: bankTransactions.amount })
    .from(bankTransactions)
    .where(
      and(
        eq(bankTransactions.userId, userId),
        eq(bankTransactions.direction, 'CRDT'),
        sql`${bankTransactions.tipo} in ('transferencia','otro')`,
        sql`${bankTransactions.amount} >= 300`,
        gte(bankTransactions.bookingDate, trimestre.desde),
        lte(bankTransactions.bookingDate, trimestre.hasta),
      ),
    );
  const repercutidoBanco = ivaSegunCobros(cobros.map((c) => Number(c.importe)), ivaPct, irpfPct);

  const aPagarFacturas = repercutido - soportado;
  const aPagarBanco = repercutidoBanco - soportado;
  // Se cuenta con lo peor de los dos: si el banco ve cobros que no tienen
  // factura registrada, la factura acabará existiendo y el IVA también.
  const aPagar = Math.max(aPagarFacturas, aPagarBanco);
  const faltanFacturas = repercutidoBanco > repercutido;

  // ------------------------------------------------------------------ fijos
  const movimientos = await db
    .select({
      fecha: bankTransactions.bookingDate,
      importe: bankTransactions.amount,
      concepto: bankTransactions.concept,
      cuenta: sql<string | null>`coalesce(${bankAccounts.alias}, ${bankAccounts.name})`,
      saldoCuenta: bankAccounts.balance,
    })
    .from(bankTransactions)
    .innerJoin(bankAccounts, eq(bankTransactions.accountId, bankAccounts.id))
    .where(
      and(
        eq(bankTransactions.userId, userId),
        eq(bankTransactions.direction, 'DBIT'),
        sql`${bankTransactions.tipo} <> 'traspaso'`,
      ),
    );

  const detectados = detectarFijos(
    movimientos.map((m) => ({ fecha: m.fecha ?? '', importe: Number(m.importe), concepto: m.concepto })),
  ).map((f) => {
    // ¿Ha caído ya en este ciclo?
    const enCiclo = movimientos.filter(
      (m) =>
        m.fecha &&
        m.fecha >= ciclo.desde &&
        m.fecha <= ciclo.hasta &&
        Math.abs(Number(m.importe) - f.importe) / f.importe <= 0.15 &&
        (m.concepto ?? '').toUpperCase().includes(f.llave.split(' ')[0]),
    );
    const ultimoMov = movimientos.find((m) => m.fecha === f.ultimo);
    // La fecha prevista dentro del ciclo, con el día en que suele caer
    const [anio, mes] = ciclo.desde.split('-').map(Number);
    const enEsteMes = f.dia >= 24;
    const prevista = new Date(Date.UTC(anio, mes - 1 + (enEsteMes ? 0 : 1), f.dia)).toISOString().slice(0, 10);
    return {
      nombre: f.nombre,
      importe: f.importe,
      cadencia: f.cadencia,
      cuenta: ultimoMov?.cuenta ?? null,
      saldoCuenta: ultimoMov?.saldoCuenta ? Number(ultimoMov.saldoCuenta) : null,
      pagado: enCiclo.length > 0,
      fecha: enCiclo[0]?.fecha ?? prevista,
      faltanDias: enCiclo.length > 0 ? null : faltanDias(prevista),
      // Uno que lleva demasiado sin aparecer probablemente ya no existe (le
      // pasó con nomadesim al volver de Bali): se sigue enseñando, pero dicho.
      dormido: faltanDias(f.ultimo) < (f.cadencia === 'mensual' ? -45 : -21),
      ultimo: f.ultimo,
      nota: null as string | null,
      // apartar el IVA sale de la cuenta, pero no es un gasto: es dinero que
      // devuelves. No puede sumar en el total de costes.
      provision: false,
    };
  });

  // Uno que dejó de cargarse NO es un fijo del ciclo: nomadesim se murió en
  // junio al volver de Bali y no pinta nada en una lista de lo que va a salir.
  const fijos = detectados.filter((f) => !f.dormido);

  // ------------------------------------------------- apartar el IVA
  // Es el primer fijo del ciclo, aunque no sea un recibo: el día que entra el
  // cobro, su IVA deja de ser tuyo. Se compara contra los traspasos que hayan
  // entrado de verdad en las cuentas marcadas como ajenas.
  const cobrosDelCiclo = await db
    .select({ importe: bankTransactions.amount, fecha: bankTransactions.bookingDate })
    .from(bankTransactions)
    .where(
      and(
        eq(bankTransactions.userId, userId),
        eq(bankTransactions.direction, 'CRDT'),
        sql`${bankTransactions.tipo} in ('transferencia','otro')`,
        sql`${bankTransactions.amount} >= 300`,
        gte(bankTransactions.bookingDate, ciclo.desde),
        lte(bankTransactions.bookingDate, ciclo.hasta),
      ),
    );

  const [ultimoCobro] = await db
    .select({ importe: bankTransactions.amount })
    .from(bankTransactions)
    .where(
      and(
        eq(bankTransactions.userId, userId),
        eq(bankTransactions.direction, 'CRDT'),
        sql`${bankTransactions.tipo} in ('transferencia','otro')`,
        sql`${bankTransactions.amount} >= 300`,
      ),
    )
    .orderBy(desc(bankTransactions.bookingDate))
    .limit(1);

  // Si el cobro del ciclo aún no ha entrado, se enseña lo que tocará según el
  // último: es una previsión, pero es la cifra con la que hay que contar.
  const aApartar = cobrosDelCiclo.length
    ? ivaSegunCobros(cobrosDelCiclo.map((c) => Number(c.importe)), ivaPct, irpfPct)
    : ivaSegunCobros(ultimoCobro ? [Number(ultimoCobro.importe)] : [], ivaPct, irpfPct);

  const cuentasAjenas = cuentas.filter((c) => c.escrow).map((c) => c.id);
  const apartadoEnCiclo = cuentasAjenas.length
    ? (
        await db
          .select({ importe: bankTransactions.amount })
          .from(bankTransactions)
          .where(
            and(
              eq(bankTransactions.userId, userId),
              eq(bankTransactions.direction, 'CRDT'),
              inArray(bankTransactions.accountId, cuentasAjenas),
              gte(bankTransactions.bookingDate, ciclo.desde),
              lte(bankTransactions.bookingDate, ciclo.hasta),
            ),
          )
      ).reduce((a, m) => a + cent(m.importe), 0)
    : 0;

  if (aApartar > 0) {
    const hecho = apartadoEnCiclo >= aApartar;
    fijos.unshift({
      nombre: 'Apartar el IVA',
      importe: euros(aApartar),
      cadencia: 'mensual' as const,
      cuenta: cuentas.find((c) => c.escrow)?.nombre ?? null,
      saldoCuenta: cuentas.find((c) => c.escrow)?.saldo ? Number(cuentas.find((c) => c.escrow)!.saldo) : null,
      pagado: hecho,
      fecha: cobrosDelCiclo[0]?.fecha ?? ciclo.desde,
      faltanDias: hecho ? null : 0,
      dormido: false,
      ultimo: ciclo.desde,
      nota: hecho
        ? `apartado ${euros(apartadoEnCiclo)} € este ciclo`
        : cobrosDelCiclo.length
          ? 'el cobro ya entró: esto es lo primero que sale'
          : 'cuando entre el cobro, antes que nada',
      provision: true,
    });
  }

  // ----------------------------------------------------------------- deudas
  const compromisos = await db
    .select()
    .from(financialCommitments)
    .where(and(eq(financialCommitments.userId, userId), isNull(financialCommitments.archivedAt)));

  const deudas = compromisos.map((d) => {
    const pagos = movimientos.filter(
      (m) =>
        d.matcher &&
        m.fecha &&
        m.fecha > d.declaredOn &&
        (m.concepto ?? '').toUpperCase().includes(d.matcher.toUpperCase()),
    );
    const pagadoDespues = pagos.reduce((a, m) => a + cent(m.importe), 0);
    const pagado = cent(d.paidBefore) + pagadoDespues;
    const queda = Math.max(0, cent(d.total) - pagado);
    const mensual = cent(d.monthly);
    const mesesQueQuedan = mensual > 0 ? Math.ceil(queda / mensual) : 0;
    const fin = new Date();
    fin.setUTCDate(1);
    fin.setUTCMonth(fin.getUTCMonth() + mesesQueQuedan);

    const esteCiclo = pagos.filter((m) => m.fecha! >= ciclo.desde && m.fecha! <= ciclo.hasta);
    return {
      id: d.id,
      nombre: d.name,
      total: euros(cent(d.total)),
      pagado: euros(pagado),
      queda: euros(queda),
      porcentaje: Math.round((100 * pagado) / cent(d.total)),
      mensual: euros(mensual),
      desde: d.startedOn,
      termina: queda > 0 ? fin.toISOString().slice(0, 7) : null,
      esteCiclo: {
        pagado: esteCiclo.length > 0,
        importe: euros(esteCiclo.reduce((a, m) => a + cent(m.importe), 0)),
      },
    };
  });

  res.json({
    ciclo,
    deudas,
    iva: {
      trimestre: `${trimestre.id} ${trimestre.anio}`,
      desde: trimestre.desde,
      hasta: trimestre.hasta,
      presenta: trimestre.presenta,
      cobra: trimestre.cobra,
      faltanDias: faltanDias(trimestre.presenta),
      // Mientras el trimestre siga abierto, lo generado NO es lo que se pagará:
      // faltan las facturas de los meses que quedan.
      cerrado: hoyIso() > trimestre.hasta,
      repercutido: euros(repercutido),
      soportado: euros(soportado),
      aPagar: euros(Math.max(0, aPagar)),
      segunBanco: euros(Math.max(0, aPagarBanco)),
      faltanFacturas,
      apartado: euros(apartado),
      faltan: euros(Math.max(0, aPagar - apartado)),
      donde: cuentas.filter((c) => c.escrow).map((c) => c.nombre),
    },
    fijos,
  });
}));
