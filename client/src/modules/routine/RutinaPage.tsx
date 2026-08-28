import HabitosTab from './HabitosTab';

/**
 * Rutina: los microhábitos que hacen tu día.
 *
 * Antes esto era un plan —plantilla semanal, franjas, checks por hora— y era
 * demasiado trabajo para lo que devolvía. Ahora es lo que de verdad se sostiene:
 * beber agua, escribir, pasear. Sin horas y sin planificar; solo «hoy he hecho
 * esto y esto».
 *
 * El trabajo de decidir QUIÉN quieres ser —y qué hábitos salen de ahí— llegará.
 * Primero, el hábito de mapear los hábitos y marcarlos.
 */
export default function RutinaPage() {
  return (
    <div>
      <div className="page-head">
        <h1>Hábitos</h1>
      </div>
      <p className="page-sub">
        Lo pequeño que sostiene el día. Sin horas y sin plan: solo lo que has hecho hoy.
      </p>

      <HabitosTab />
    </div>
  );
}
