/**
 * De qué CLASE es cada movimiento del banco.
 *
 * Esto es el cimiento de Finanzas, no una pantalla: mientras cada movimiento
 * sea una fecha, un importe y una frase, ninguna cuenta se puede fiar. El tipo
 * es el CÓMO (bizum, recibo, compra con tarjeta), nunca el EN QUÉ (cena,
 * gasolina): la categoría de comercio viene VACÍA en los tres bancos, así que
 * no se puede deducir y no se finge.
 *
 * Medido con datos reales (Santander, Ibercaja y Revolut, 90 días):
 *
 * - Revolut manda `bank_transaction_code` en el 100% de los movimientos, con
 *   valores limpios. Cuando está, se usa: no hay nada más fiable.
 * - Santander e Ibercaja no lo mandan NUNCA, y tampoco el nombre de la otra
 *   parte: el quién va dentro del concepto. Pero ese texto es muy regular —21
 *   arranques distintos en 69 movimientos—, así que se clasifica por cómo
 *   empieza.
 */

export const TIPOS = [
  'traspaso', // el dinero solo cambia de bolsillo: no es ingreso ni gasto
  'tarjeta',
  'movil',
  'bizum',
  'transferencia',
  'recibo',
  'liquidacion',
  'comision',
  'intereses',
  'cambio',
  'recarga',
  'devolucion',
  'inversion',
  'otro',
] as const;

export type Tipo = (typeof TIPOS)[number];

/** Cómo se llama cada tipo en pantalla. */
export const NOMBRE_TIPO: Record<Tipo, string> = {
  traspaso: 'Entre tus cuentas',
  tarjeta: 'Compra con tarjeta',
  movil: 'Pago con móvil',
  bizum: 'Bizum',
  transferencia: 'Transferencia',
  recibo: 'Recibo domiciliado',
  liquidacion: 'Liquidación de tarjeta',
  comision: 'Comisión',
  intereses: 'Intereses',
  cambio: 'Cambio de divisa',
  recarga: 'Recarga',
  devolucion: 'Devolución',
  inversion: 'Inversión',
  otro: 'Sin clasificar',
};

/** Sin acentos y en minúsculas: los bancos escriben como les da la gana. */
function llano(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** Lo que manda el banco cuando se digna a mandarlo (Revolut, siempre). */
const POR_CODIGO: Record<string, Tipo> = {
  CARD_PAYMENT: 'tarjeta',
  TOPUP: 'recarga',
  EXCHANGE: 'cambio',
  FEE: 'comision',
  INTEREST: 'intereses',
  REFUND: 'devolucion',
  DIRECT_DEBIT: 'recibo',
};

/**
 * Por cómo empieza el concepto. El orden IMPORTA: «liquidacion intereses» es
 * de Ibercaja y no tiene nada que ver con la liquidación de tarjetas del
 * Santander, así que va antes.
 */
const POR_TEXTO: [RegExp, Tipo][] = [
  [/^(to eur|traspaso|entre cuentas|enviada desde revolut)/, 'traspaso'],
  [/^bizum/, 'bizum'],
  [/^pago movil/, 'movil'],
  [/^(liquidacion|abono) intereses/, 'intereses'],
  [/^liquidacion/, 'liquidacion'],
  [/^comision/, 'comision'],
  [/^(recibo|adeudo|domiciliacion)/, 'recibo'],
  [/^transferencia/, 'transferencia'],
  [/^(compra|tarjeta (visa|mastercard|debito|credito)|pago en)/, 'tarjeta'],
  [/^(gestion devoluciones|devolucion|abono por devolucion)/, 'devolucion'],
  [/^(top-up|recarga)/, 'recarga'],
  // Rastro de inversión que pasa por la cuenta corriente: venta de acciones,
  // rendimientos, primas. Eran los 5 únicos que se resistían en Santander.
  [/^(venta|compra) \d/, 'inversion'],
  [/^abono (prima emision|rendimientos|dividendo)/, 'inversion'],
  // mover dinero a su propia tarjeta no es un gasto
  [/^ingreso en tarjeta desde cuenta/, 'traspaso'],
  [/^(nomina|pago de nomina)/, 'transferencia'],
];

/**
 * El tipo de un movimiento. Nunca falla: lo que no se reconoce es 'otro', que
 * la pantalla enseña como «sin clasificar» en vez de esconderlo.
 */
export function tipoDeMovimiento(m: { bankCode?: string | null; concept?: string | null }): Tipo {
  const texto = llano(m.concept ?? '');

  // Un TRANSFER de Revolut puede ser a un tercero o a su propio bolsillo: lo
  // dice el concepto, no el código.
  const codigo = (m.bankCode ?? '').toUpperCase();
  if (codigo === 'TRANSFER') return /^(to |from )/.test(texto) ? 'traspaso' : 'transferencia';
  if (POR_CODIGO[codigo]) return POR_CODIGO[codigo];

  for (const [patron, tipo] of POR_TEXTO) if (patron.test(texto)) return tipo;
  return 'otro';
}

// ---------------------------------------------------------------------------
// Traspasos entre bancos distintos
// ---------------------------------------------------------------------------

export interface FilaEmparejable {
  id: number;
  accountId: number;
  amount: string;
  direction: 'CRDT' | 'DBIT';
  bookingDate: string | null;
  bankCode?: string | null;
  concept?: string | null;
}

/** Céntimos, que con decimales en coma flotante 0,1 + 0,2 no es 0,3. */
const centimos = (s: string) => Math.round(Number(s) * 100);

const dias = (a: string, b: string) => Math.abs(new Date(a).getTime() - new Date(b).getTime()) / 86400000;

/**
 * ¿Alguno de los dos lados TIENE PINTA de traspaso?
 *
 * Sin esta condición, dos pagos de 50 € el mismo día en bancos distintos se
 * emparejarían y desaparecerían los dos. Se exige que al menos uno lo diga:
 * el código de Revolut, o el concepto nombrando al otro banco.
 */
function pintaDeTraspaso(f: FilaEmparejable): boolean {
  const codigo = (f.bankCode ?? '').toUpperCase();
  if (codigo === 'TOPUP' || codigo === 'TRANSFER' || codigo === 'EXCHANGE') return true;
  return /revolut|traspaso|entre cuentas|mismo titular|a mi favor/.test(llano(f.concept ?? ''));
}

/**
 * Las parejas de traspaso propio: mismo importe, cuentas distintas, sentidos
 * contrarios y como mucho tres días de separación (los bancos no contabilizan
 * a la vez). Devuelve pares de ids; cada movimiento se empareja UNA sola vez.
 */
export function emparejarTraspasos(filas: FilaEmparejable[]): [number, number][] {
  const salidas = filas.filter((f) => f.direction === 'DBIT' && f.bookingDate);
  const entradas = filas.filter((f) => f.direction === 'CRDT' && f.bookingDate);

  const porImporte = new Map<number, FilaEmparejable[]>();
  for (const s of salidas) {
    const k = centimos(s.amount);
    (porImporte.get(k) ?? porImporte.set(k, []).get(k)!).push(s);
  }

  const usados = new Set<number>();
  const parejas: [number, number][] = [];

  // Por fecha, para que el resultado no dependa del orden en que llegó nada
  for (const entrada of entradas.sort((a, z) => (a.bookingDate! < z.bookingDate! ? -1 : 1))) {
    const candidatas = (porImporte.get(centimos(entrada.amount)) ?? [])
      .filter(
        (s) =>
          !usados.has(s.id) &&
          s.accountId !== entrada.accountId &&
          dias(s.bookingDate!, entrada.bookingDate!) <= 3 &&
          (pintaDeTraspaso(s) || pintaDeTraspaso(entrada)),
      )
      .sort((a, z) => dias(a.bookingDate!, entrada.bookingDate!) - dias(z.bookingDate!, entrada.bookingDate!));

    const pareja = candidatas[0];
    if (!pareja) continue;
    usados.add(pareja.id);
    usados.add(entrada.id);
    parejas.push([pareja.id, entrada.id]);
  }

  return parejas;
}
