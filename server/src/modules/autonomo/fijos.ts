/**
 * Qué gastos se repiten de verdad.
 *
 * La regla ingenua —«el mismo concepto dos veces»— no sirve: con 90 días de sus
 * datos daba 29 candidatos de los que solo 4 eran suscripciones reales. El resto
 * eran bizums, traspasos y cafés que casualmente se repetían.
 *
 * Lo que sí distingue un compromiso de un gasto repetido son TRES señales a la
 * vez: mismo emisor, **importe estable** y **cadencia regular**. Con esas tres,
 * los cuatro reales aparecen limpios (ManageWP 1,21/1,23 cada 29-30 días,
 * Apple 9,99 clavado cada 30, la cuota de autónomos, nomadesim cada 7) y no
 * cuela ninguno de los otros veinticinco.
 */

export interface MovimientoFijo {
  fecha: string; // YYYY-MM-DD
  importe: number;
  concepto: string | null;
}

export interface Fijo {
  llave: string;
  nombre: string;
  importe: number;
  cadencia: 'mensual' | 'semanal';
  dia: number; // día del mes en que suele caer
  veces: number;
  ultimo: string;
}

/** Cuánto puede bailar el importe y seguir siendo el mismo recibo. */
const TOLERANCIA = 0.12;

const llano = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/\d{3,}/g, '#')
    .replace(/[^A-Z# ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** El emisor: las primeras palabras, que es donde va el nombre. */
const llaveDe = (concepto: string | null) => llano(concepto ?? '').split(' ').slice(0, 4).join(' ');

/** Lo que sobra delante del nombre en cada banco. */
const RUIDO = /^(RECIBO|COMPRA|PAGO MOVIL EN|TARJETA (VISA|MASTERCARD|DEBITO|CREDITO)|ADEUDO|DOMICILIACION)\s+/;

function bonito(llave: string): string {
  const limpio = llave.replace(RUIDO, '').trim() || llave;
  return limpio
    .split(' ')
    .filter((p) => p && p !== '#')
    // sin vocales es una sigla (TGSS), y una sigla en minúsculas no se lee
    .map((p) => (/[AEIOU]/.test(p) ? p[0] + p.slice(1).toLowerCase() : p))
    .join(' ');
}

const dias = (a: string, b: string) => Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86400000);

/** La mediana, que no se deja arrastrar por un mes raro. */
function mediana(xs: number[]): number {
  const o = [...xs].sort((a, b) => a - b);
  return o[Math.floor(o.length / 2)];
}

export function detectarFijos(movimientos: MovimientoFijo[]): Fijo[] {
  const grupos = new Map<string, MovimientoFijo[]>();
  for (const m of movimientos) {
    if (!m.fecha) continue;
    const k = llaveDe(m.concepto);
    if (!k) continue;
    const lista = grupos.get(k) ?? [];
    lista.push(m);
    grupos.set(k, lista);
  }

  const fijos: Fijo[] = [];
  for (const [llave, lista] of grupos) {
    if (lista.length < 2) continue;
    const ordenados = [...lista].sort((a, b) => (a.fecha < b.fecha ? -1 : 1));

    const importes = ordenados.map((m) => m.importe);
    const media = importes.reduce((a, b) => a + b, 0) / importes.length;
    if (media <= 0) continue;
    const desviacion = Math.max(...importes.map((x) => Math.abs(x - media))) / media;
    if (desviacion > TOLERANCIA) continue;

    const huecos = ordenados.slice(1).map((m, i) => dias(ordenados[i].fecha, m.fecha));
    const mensual = huecos.every((d) => d >= 25 && d <= 35);
    const semanal = huecos.every((d) => d >= 6 && d <= 8);
    if (!mensual && !semanal) continue;
    // Dos cargos mensuales abarcan un mes entero: es indicio suficiente. Dos
    // semanales abarcan siete días, y eso no es una suscripción, es haber ido
    // dos viernes al mismo sitio —así se colaba un restaurante de Bali—.
    if (semanal && ordenados.length < 3) continue;

    fijos.push({
      llave,
      nombre: bonito(llave),
      importe: Number(media.toFixed(2)),
      cadencia: mensual ? 'mensual' : 'semanal',
      dia: mediana(ordenados.map((m) => Number(m.fecha.slice(8, 10)))),
      veces: ordenados.length,
      ultimo: ordenados[ordenados.length - 1].fecha,
    });
  }

  return fijos.sort((a, z) => z.importe - a.importe);
}
