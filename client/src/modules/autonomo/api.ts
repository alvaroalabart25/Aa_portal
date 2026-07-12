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
  openPdf: (id: number) => openBlob(`/autonomo/invoices/${id}/pdf`),

  summary: (year: number) => get<{ year: number; quarters: QuarterSummary[] }>(`/autonomo/summary?year=${year}`),
};
