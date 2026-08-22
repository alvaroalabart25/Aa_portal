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
  tipo: string | null;
  tipoNombre: string | null;
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

export const obligacionesApi = {
  ver: () => get<Obligaciones>('/autonomo/obligaciones'),
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
  movimientos: (limite = 100) => get<MovimientoBanco[]>(`/autonomo/banco/movimientos?limite=${limite}`),
  desconectar: (id: number) => del<{ ok: boolean }>(`/autonomo/banco/conexiones/${id}`),
};
