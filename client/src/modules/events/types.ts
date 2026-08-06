export type EventRecurrence = 'none' | 'daily' | 'monthly' | 'yearly';
export type EventScope = 'autonomo' | 'space';

export interface ImportantEvent {
  id: number;
  title: string;
  emoji: string;
  eventDate: string;
  eventTime: string | null; // HH:MM opcional (se pinta en el Diario)
  recurrence: EventRecurrence;
  scope: EventScope;
  spaceId: number | null;
  spaceName: string | null;
  spaceColor: string | null;
}

export const RECURRENCE_LABEL: Record<EventRecurrence, string> = {
  none: 'No se repite',
  daily: 'Cada día',
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

  // el diario ocurre hoy, siempre: no hay que buscar candidato
  if (ev.recurrence === 'daily') return today;

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

// ¿El evento ocurre en esta fecha concreta? (para pintarlo en el Diario)
export function occursOn(ev: ImportantEvent, iso: string): boolean {
  if (ev.recurrence === 'none' || iso <= ev.eventDate) return ev.eventDate === iso;
  if (ev.recurrence === 'daily') return true; // aquí ya sabemos que iso > eventDate
  const [, em, ed] = ev.eventDate.split('-').map(Number);
  const [, m, d] = iso.split('-').map(Number);
  if (ev.recurrence === 'yearly') return m === em && d === ed;
  return d === ed; // monthly
}

export function daysUntil(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number);
  const target = new Date(y, m - 1, d);
  const now = new Date();
  const base = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((target.getTime() - base.getTime()) / 86_400_000);
}

/**
 * Ventanas del radar (la franja de arriba).
 *
 * Por defecto, la semana: un aviso a 24 días no es información, es ruido que
 * ocupa la parte de arriba de la pantalla antes de ver una sola tarea.
 * En la pestaña Agenda basta con lo inmediato, porque la semana completa ya
 * está en Macro y repetirla dos veces solo quita sitio a las tareas del día.
 * La excepción son los plazos de Hacienda, que sí interesan con antelación.
 * El listado de la Agenda (sección Próximas) sigue llegando a 4 meses.
 */
export const RADAR_DIAS = 7;
export const RADAR_DIAS_AGENDA = 3;
export const RADAR_DIAS_FISCAL = 30;
export const LIST_WINDOW_DAYS = 120;

export function whenLabel(days: number): string {
  if (days === 0) return 'HOY';
  if (days === 1) return 'Mañana';
  if (days < 30) return `En ${days} días`;
  const months = Math.floor(days / 30);
  return months === 1 ? 'En 1 mes' : `En ${months} meses`;
}

export function eventColor(ev: ImportantEvent): string {
  return ev.scope === 'autonomo' ? '#0a0a0a' : (ev.spaceColor ?? '#0a0a0a');
}

export function eventPlace(ev: ImportantEvent): string {
  return ev.scope === 'autonomo' ? 'Finanzas' : (ev.spaceName ?? 'Espacio');
}

export const fmtEventDate = (iso: string) => {
  const d = new Date(`${iso}T12:00:00`);
  const s = d.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' });
  return s.charAt(0).toUpperCase() + s.slice(1);
};
