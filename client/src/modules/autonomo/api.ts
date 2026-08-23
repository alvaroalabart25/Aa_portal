import { del, get, openBlob, patch, post } from '../../lib/api';
import type { AutonomoProfile, Invoice, InvoiceClient, QuarterSummary } from './types';

export const autonomoApi = {
  profile: () => get<AutonomoProfile | null>('/autonomo/profile'),
  clients: () => get<InvoiceClient[]>('/autonomo/clients'),
  createClient: (data: Partial<InvoiceClient>) => post<InvoiceClient>('/autonomo/clients', data),
  updateClient: (id: number, data: Partial<InvoiceClient>) => patch<InvoiceClient>(`/autonomo/clients/${id}`, data),

  invoices: (params: { year?: number; kind?: string } = {}) => {
    const q = new URLSearchParams();
    if (params.year) q.set('year', String(params.year));
    if (params.kind) q.set('kind', params.kind);
    return get<Invoice[]>(`/autonomo/invoices?${q}`);
  },
  nextNumber: (year: number) => get<{ number: string }>(`/autonomo/invoices/next-number?year=${year}`),
  createInvoice: (data: Record<string, unknown>) => post<Invoice>('/autonomo/invoices', data),
  updateInvoice: (id: number, data: Record<string, unknown>) => patch<Invoice>(`/autonomo/invoices/${id}`, data),
  archiveInvoice: (id: number) => del<{ archived: boolean }>(`/autonomo/invoices/${id}`),
  approveInvoice: (id: number) => post<Invoice>(`/autonomo/invoices/${id}/approve`, {}),
  sendInvoice: (id: number, data: { to: string; subject: string; message: string }) =>
    post<Invoice>(`/autonomo/invoices/${id}/send`, data),
  openPdf: (id: number) => openBlob(`/autonomo/invoices/${id}/pdf`),

  summary: (year: number) => get<{ year: number; quarters: QuarterSummary[] }>(`/autonomo/summary?year=${year}`),
};

// ---------- El banco (lectura vía Enable Banking) ----------
export interface CuentaBanco {
  id: number;
  nombre: string | null;
  iban: string | null;
  moneda: string;
  saldo: string | null;
  saldoAt: string | null;
  ajena: boolean;
}

export interface ConexionBanco {
  id: number;
  banco: string;
  pais: string;
  estado: 'pendiente' | 'activa' | 'caducada' | 'revocada';
  validoHasta: string | null;
  ultimaSync: string | null;
  error: string | null;
  /** el banco no acepta más consultas hasta esta hora (PSD2 limita el número) */
  reintentarDesde: string | null;
  cuentas: CuentaBanco[];
}

export interface PaginaMovimientos {
  total: number;
  pagina: number;
  limite: number;
  movimientos: MovimientoBanco[];
  bancos: string[];
  tipos: { tipo: string; nombre: string; n: number }[];
  /** todas las categorías, con cuántos gastos tiene cada una; «sin» es una más */
  categorias: { categoria: string; nombre: string; n: number }[];
}

export interface FiltroMovimientos {
  banco?: string;
  /** 1 = incluir los traspasos entre cuentas propias, que por defecto se ocultan */
  traspasos?: 1;
  tipo?: string;
  /** una categoría, o 'sin' para ver lo que falta por categorizar */
  categoria?: string;
  q?: string;
  orden?: 'fecha' | 'importe';
  dir?: 'asc' | 'desc';
  limite?: number;
  pagina?: number;
}

export interface MovimientoBanco {
  id: number;
  fecha: string | null;
  importe: string;
  moneda: string;
  direccion: 'CRDT' | 'DBIT';
  contraparte: string | null;
  concepto: string | null;
  estado: string;
  cuenta: string | null;
  cuentaIban: string | null;
  banco: string;
  tipo: string | null;
  tipoNombre: string | null;
  categoria: string | null;
  categoriaNombre: string | null;
}

/** El mes de verdad: lo que entra y sale sin contar traspasos entre cuentas. */
export interface ResumenMes {
  mes: string;
  vigente: string;
  /** true = periodo por ciclo de cobro (del 24 al 23); false = mes natural */
  ciclo: boolean;
  desde: string;
  hasta: string;
  primerMes: string;
  saldo: {
    /** lo que es SUYO: no incluye lo que solo guarda (el IVA) */
    total: number;
    ajeno: number;
    cuentasAjenas: (string | null)[];
    propias: number;
    at: string | null;
    cuentas: {
      id: number;
      banco: string;
      nombre: string | null;
      iban: string | null;
      moneda: string;
      saldo: number | null;
      ajena: boolean;
    }[];
  };
  movimientos: number;
  entra: number;
  sale: number;
  queda: number;
  traspasos: { n: number; importe: number };
  semanas: { etiqueta: string; entra: number; sale: number }[];
  dias: { fecha: string; entra: number; sale: number }[];
  tipos: { tipo: string; nombre: string; n: number; entra: number; sale: number }[];
}

/** Obligaciones: lo que debes, cuándo se paga y si tienes con qué. */
export interface Obligaciones {
  ciclo: { id: string; desde: string; hasta: string };
  iva: {
    trimestre: string;
    desde: string;
    hasta: string;
    presenta: string;
    cobra: string;
    faltanDias: number;
    cerrado: boolean;
    repercutido: number;
    soportado: number;
    aPagar: number;
    segunBanco: number;
    faltanFacturas: boolean;
    apartado: number;
    faltan: number;
    donde: (string | null)[];
  };
  fijos: {
    nombre: string;
    importe: number;
    cadencia: 'mensual' | 'semanal';
    cuenta: string | null;
    saldoCuenta: number | null;
    pagado: boolean;
    fecha: string;
    faltanDias: number | null;
    dormido: boolean;
    ultimo: string;
    /** cuándo vuelve a cargarse */
    proxima: string;
    nota: string | null;
    /** apartar el IVA sale de la cuenta, pero no es un gasto */
    provision: boolean;
  }[];
  deudas: {
    id: number;
    nombre: string;
    total: number;
    pagado: number;
    queda: number;
    porcentaje: number;
    mensual: number;
    desde: string;
    termina: string | null;
    esteCiclo: { pagado: boolean; importe: number };
  }[];
}

/** La ficha de una deuda: lo que el portal sabe, para poder amortizarla. */
export interface DeudaFicha {
  id: number;
  nombre: string;
  total: number;
  mensual: number;
  desde: string;
  declarado: { hasta: string; importe: number };
  pagos: {
    id: number;
    fecha: string;
    /** lo que salió del banco */
    importe: number;
    /** lo que de eso amortiza deuda: por defecto todo, salvo que él lo acote */
    aDeuda: number;
    declarado: boolean;
    nota: string | null;
    concepto: string | null;
    tipo: string | null;
    cuenta: string | null;
    banco: string | null;
  }[];
}

export interface Objetivo {
  id: number;
  nombre: string;
  meta: number;
  ahora: number;
  falta: number;
  porcentaje: number;
  mensual: number;
  cuenta: string | null;
  ciclos: number | null;
  termina: string | null;
}

/** El reparto del ciclo: qué entra y a dónde va cada euro. */
export interface Plan {
  ciclo: { id: string; desde: string; hasta: string };
  ingreso: number;
  llegado: boolean;
  cuadra: boolean;
  tramos: {
    id: string;
    titulo: string;
    detalle: string;
    importe: number;
    porcentaje: number;
    editable: boolean;
  }[];
}

export const obligacionesApi = {
  ver: () => get<Obligaciones>('/autonomo/obligaciones'),
  deuda: (id: number) => get<DeudaFicha>(`/autonomo/obligaciones/deudas/${id}`),
  objetivos: () => get<Objetivo[]>('/autonomo/obligaciones/objetivos'),
  plan: () => get<Plan>('/autonomo/obligaciones/plan'),
  cambiarObjetivo: (id: number, cambios: { mensual?: number; meta?: number }) =>
    patch<{ ok: boolean }>(`/autonomo/obligaciones/objetivos/${id}`, cambios),
  /** Cuánto de ese pago era deuda. `null` = cuenta entero, como venía. */
  parteDeuda: (deudaId: number, pagoId: number, importe: number | null) =>
    patch<{ ok: boolean; aDeuda: number; declarado: boolean }>(
      `/autonomo/obligaciones/deudas/${deudaId}/pagos/${pagoId}`,
      { importe },
    ),
};

/** Analíticas: ¿crece el patrimonio, de dónde entra y en qué se va? */
export interface Analitica {
  dias: number;
  periodo: { desde: string; hasta: string };
  curva: { fecha: string; total: number; real: boolean }[];
  fotos: number;
  desdeQueHay: string | null;
  cambio: { desde: number; hasta: number; diferencia: number };
  ciclos: {
    id: string;
    desde: string;
    hasta: string;
    entra: number;
    sale: number;
    diferencia: number;
    aHacienda: number;
    /** lo que de verdad cambió tu bolsillo: cuadra con la curva, entra−sale no */
    patrimonio: number;
  }[];
  ingresos: { nombre: string; n: number; importe: number; porcentaje: number; tipo: string }[];
  totalIngresos: number;
  gastos: { nombre: string; n: number; importe: number; porcentaje: number; tipo: string }[];
  totalGastos: number;
  /** en qué se va, agrupado: nueve cajones en vez de noventa comercios */
  categorias: { categoria: string; nombre: string; n: number; importe: number; gasto: boolean }[];
  /** lo que salió de la cuenta pero no se gastó: cambió de sitio */
  guardado: number;
}

export const analiticaApi = {
  /** por días hacia atrás, o por un rango concreto (un ciclo, un mes) */
  ver: (p: { dias?: number; desde?: string; hasta?: string } = {}) => {
    const q = new URLSearchParams();
    if (p.desde && p.hasta) {
      q.set('desde', p.desde);
      q.set('hasta', p.hasta);
    } else q.set('dias', String(p.dias ?? 90));
    return get<Analitica>(`/autonomo/analitica?${q}`);
  },
};

export const bancoApi = {
  estado: () => get<{ configurado: boolean; conexiones: ConexionBanco[] }>('/autonomo/banco/estado'),
  bancos: (pais = 'ES') =>
    get<{ nombre: string; pais: string; logo: string | null }[]>(`/autonomo/banco/bancos?pais=${pais}`),
  conectar: (banco: string, pais = 'ES') =>
    post<{ url: string; conexionId: number }>('/autonomo/banco/conectar', { banco, pais }),
  vuelta: (code: string, state: string) =>
    post<{ ok: boolean; cuentas: number }>('/autonomo/banco/vuelta', { code, state }),
  // `dias` fuerza el historial entero (90 como mucho): hace falta cuando cambia
  // la forma de clasificar y hay que repasar lo que ya estaba guardado.
  sincronizar: (id: number, dias?: number) =>
    post<{ ok: boolean; nuevos: number; traspasos: number }>(
      `/autonomo/banco/sincronizar/${id}${dias ? `?dias=${dias}` : ''}`,
      {},
    ),
  resumen: (mes?: string, ciclo = true) =>
    get<ResumenMes>(`/autonomo/banco/resumen?ciclo=${ciclo ? 1 : 0}${mes ? `&mes=${mes}` : ''}`),
  reclasificar: () =>
    post<{ ok: boolean; movimientos: number; traspasos: number; sinClasificar: number }>(
      '/autonomo/banco/reclasificar',
      {},
    ),
  /**
   * Corregir en qué se fue el dinero. Por defecto arrastra a todos los del
   * mismo comercio y lo deja guardado como regla: corregir dos veces lo mismo
   * es lo que hace que nadie mantenga sus categorías.
   */
  categorizar: (id: number, categoria: string | null, todos = true) =>
    patch<{ ok: boolean; regla: string | null; categorizados?: number; sinCategoria?: number }>(
      `/autonomo/banco/movimientos/${id}/categoria`,
      { categoria, todos },
    ),
  movimientos: (f: FiltroMovimientos = {}) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(f)) if (v !== undefined && v !== '') q.set(k, String(v));
    return get<PaginaMovimientos>(`/autonomo/banco/movimientos?${q}`);
  },
  desconectar: (id: number) => del<{ ok: boolean }>(`/autonomo/banco/conexiones/${id}`),
};
