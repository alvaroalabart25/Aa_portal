import EventosTab from './EventosTab';

/**
 * Eventos importantes, en su propia página dentro de Organización.
 *
 * Antes era una pestaña de Agenda, pero ahí competía con lo que de verdad se
 * mira a diario: los eventos que importan ya salen en Macro (la semana o el
 * mes) y en la Agenda. Aquí se viene a darlos de alta o a corregirlos.
 */
export default function EventosPage() {
  return (
    <div>
      <div className="page-head">
        <h1>Eventos</h1>
      </div>
      <p className="muted" style={{ fontSize: 13, marginTop: 4, lineHeight: 1.6, maxWidth: 620 }}>
        Fechas clave que no son tareas: un viaje, una reunión, un plazo. Se editan solo aquí; en Macro y en la Agenda
        aparecen para verlos, no para tocarlos.
      </p>
      <EventosTab />
    </div>
  );
}
