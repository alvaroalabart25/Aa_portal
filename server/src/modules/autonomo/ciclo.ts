/**
 * Su mes NO es el del calendario.
 *
 * Cobra entre el 24 y el 30, así que un mes natural mirado un día 21 enseña
 * tres semanas de gasto y ningún ingreso: agosto salía en −859 € cuando el
 * ciclo cerrado estaba en +342. El ciclo va del 24 al 23 y se nombra por el mes
 * en que ARRANCA, que es cuando entra el cobro.
 *
 * Si algún día cobra en otras fechas, esto es lo único que hay que cambiar.
 */
export const CICLO_DIA = 24;

export interface Ciclo {
  /** el mes que le da nombre, YYYY-MM */
  id: string;
  desde: string;
  hasta: string;
}

/** El ciclo al que pertenece una fecha. */
export function cicloDe(fecha: Date = new Date()): Ciclo {
  const base = new Date(
    Date.UTC(fecha.getUTCFullYear(), fecha.getUTCMonth() - (fecha.getUTCDate() < CICLO_DIA ? 1 : 0), 1),
  );
  return cicloPorId(base.toISOString().slice(0, 7));
}

/** El ciclo que arranca en un mes dado (YYYY-MM). */
export function cicloPorId(id: string): Ciclo {
  const [anio, mes] = id.split('-').map(Number);
  return {
    id,
    desde: new Date(Date.UTC(anio, mes - 1, CICLO_DIA)).toISOString().slice(0, 10),
    hasta: new Date(Date.UTC(anio, mes, CICLO_DIA - 1)).toISOString().slice(0, 10),
  };
}

/** El trimestre fiscal de una fecha: lo que se declara y cuándo se paga. */
export function trimestreDe(fecha: Date = new Date()) {
  const anio = fecha.getUTCFullYear();
  const t = Math.floor(fecha.getUTCMonth() / 3) + 1; // 1..4
  const primerMes = (t - 1) * 3;
  // El 4T se presenta hasta el 30 de enero; los demás, hasta el 20 del mes
  // siguiente al cierre. Con domiciliación el importe se fija cinco días antes.
  const cierre = new Date(Date.UTC(anio, primerMes + 3, 0));
  const presenta =
    t === 4 ? new Date(Date.UTC(anio + 1, 0, 25)) : new Date(Date.UTC(anio, primerMes + 3, 15));
  const cobra = t === 4 ? new Date(Date.UTC(anio + 1, 0, 30)) : new Date(Date.UTC(anio, primerMes + 3, 20));
  return {
    id: `${t}T`,
    anio,
    desde: new Date(Date.UTC(anio, primerMes, 1)).toISOString().slice(0, 10),
    hasta: cierre.toISOString().slice(0, 10),
    presenta: presenta.toISOString().slice(0, 10),
    cobra: cobra.toISOString().slice(0, 10),
  };
}
