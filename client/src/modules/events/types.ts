export type EventRecurrence = 'none' | 'monthly' | 'yearly';
export type EventScope = 'autonomo' | 'space';

export interface ImportantEvent {
  id: number;
  title: string;
  eventDate: string;
  recurrence: EventRecurrence;
  scope: EventScope;
  spaceId: number | null;
  spaceName: string | null;
  spaceColor: string | null;
}

export const RECURRENCE_LABEL: Record<EventRecurrence, string> = {
  none: 'No se repite',
  monthly: 'Cada mes',
  yearly: 'Cada año',
};

function isoLocal(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function todayIso(): string {
  return isoLocal(new Date());
}

// Próxima ocurrencia del evento (>= hoy). Los recurrentes ruedan solos al
// día siguiente de pasar; los puntuales devuelven su fecha aunque haya pasado.
export function nextOccurrence(ev: ImportantEvent): string {
  const today = todayIso();
  if (ev.recurrence === 'none' || ev.eventDate >= today) return ev.eventDate;

  const [, m, d] = ev.eventDate.split('-').map(Number);
  const now = new Date();
  if (ev.recurrence === 'yearly') {
    let candidate = new Date(now.getFullYear(), m - 1, d);
    if (isoLocal(candidate) < today) candidate = new Date(now.getFullYear() + 1, m - 1, d);
    return isoLocal(candidate);
  }
  // monthly
  let candidate = new Date(now.getFullYear(), now.getMonth(), d);
  if (isoLocal(candidate) < today) candidate = new Date(now.getFullYear(), now.getMonth() + 1, d);
  return isoLocal(candidate);
}

export function daysUntil(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number);
  const target = new Date(y, m - 1, d);
  const now = new Date();
  const base = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((target.getTime() - base.getTime()) / 86_400_000);
}

// Hitos del radar: 1 mes, 15, 7, 3, 2 días, víspera y el mismo día.
export function milestoneLabel(days: number): string | null {
  if (days === 0) return 'HOY';
  if (days === 1) return 'Mañana';
  if (days === 2) return 'En 2 días';
  if (days === 3) return 'En 3 días';
  if (days === 7) return 'En 7 días';
  if (days === 15) return 'En 15 días';
  if (days === 30) return 'En 1 mes';
  return null;
}

export function eventColor(ev: ImportantEvent): string {
  return ev.scope === 'autonomo' ? '#0a0a0a' : (ev.spaceColor ?? '#0a0a0a');
}

export function eventPlace(ev: ImportantEvent): string {
  return ev.scope === 'autonomo' ? 'Autónomo' : (ev.spaceName ?? 'Espacio');
}

export const fmtEventDate = (iso: string) => {
  const d = new Date(`${iso}T12:00:00`);
  const s = d.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' });
  return s.charAt(0).toUpperCase() + s.slice(1);
};
