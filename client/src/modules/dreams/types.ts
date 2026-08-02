export type DreamKind = 'macro' | 'micro';
export type DreamStatus = 'sonando' | 'en_marcha' | 'cumplido' | 'aparcado';

export interface Categoria {
  id: number;
  name: string;
  color: string;
  sortOrder: number;
}

export interface DreamCard {
  id: number;
  kind: DreamKind;
  parentId: number | null;
  parentTitle: string | null;
  categoryId: number | null;
  title: string;
  description: string | null;
  status: DreamStatus;
  targetDate: string | null;
  achievedAt: string | null;
  costEstimated: string | null;
  costSaved: string | null;
  sortOrder: number;
  coverUrl: string | null;
  steps: { done: number; total: number };
  micros: { done: number; total: number } | null; // solo en macros
}

export interface DreamStep {
  id: number;
  title: string;
  done: number;
  sortOrder: number;
}

export interface DreamLink {
  id: number;
  label: string;
  url: string;
  note: string | null;
}

export interface DreamImage {
  id: number;
  mime: string;
  sortOrder: number;
  thumbUrl: string;
  fullUrl: string;
}

export interface DreamDetail extends Omit<DreamCard, 'coverUrl' | 'steps' | 'micros' | 'parentTitle'> {
  steps: DreamStep[];
  links: DreamLink[];
  images: DreamImage[];
  children: { id: number; title: string; status: DreamStatus; targetDate: string | null }[];
  macros: { id: number; title: string }[];
}

export interface Deseo {
  id: number;
  title: string;
  price: string | null;
  url: string | null;
  categoryId: number | null;
  sortOrder: number;
  boughtAt: string | null;
}

export interface Plantilla {
  id: string;
  title: string;
  emoji: string;
  steps: number;
}

export const ESTADOS: { value: DreamStatus; label: string; emoji: string }[] = [
  { value: 'sonando', label: 'Soñando', emoji: '💭' },
  { value: 'en_marcha', label: 'En marcha', emoji: '🚀' },
  { value: 'cumplido', label: 'Cumplido', emoji: '✅' },
  { value: 'aparcado', label: 'Aparcado', emoji: '🅿️' },
];

export function nombreEstado(s: DreamStatus): string {
  return ESTADOS.find((e) => e.value === s)?.label ?? s;
}
