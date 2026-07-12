export type InvoiceKind = 'income' | 'expense';

export interface AutonomoProfile {
  id: number;
  fullName: string;
  taxId: string;
  addressLine: string | null;
  cityLine: string | null;
  iban: string | null;
  defaultVatPct: string;
  defaultIrpfPct: string;
}

export interface InvoiceClient {
  id: number;
  name: string;
  taxId: string | null;
  addressLine: string | null;
  cityLine: string | null;
  phone: string | null;
  email: string | null;
}

export interface Invoice {
  id: number;
  kind: InvoiceKind;
  clientId: number | null;
  origin: string;
  number: string;
  issueDate: string;
  concept: string | null;
  base: string;
  vatPct: string;
  irpfPct: string;
  vatAmount: string;
  irpfAmount: string;
  total: string;
}

export interface QuarterSummary {
  incomeBase: number;
  incomeVat: number;
  incomeIrpf: number;
  expenseBase: number;
  expenseVat: number;
  vatResult: number;
}

export const fmtEur = (n: number) =>
  new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(n);

export const fmtPct = (v: string | number) => {
  const n = Number(v);
  return `${Number.isInteger(n) ? n : n.toFixed(2).replace('.', ',')}%`;
};

export const monthName = (iso: string) => {
  const s = new Date(`${iso}T12:00:00`).toLocaleDateString('es-ES', { month: 'long' });
  return s.charAt(0).toUpperCase() + s.slice(1);
};

export const fmtDate = (iso: string) => {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y.slice(2)}`;
};
