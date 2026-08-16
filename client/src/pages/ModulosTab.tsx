import { useEffect, useState } from 'react';
import { patch } from '../lib/api';
import { usePerfil } from '../lib/perfil';
import { MODULOS_ACTIVABLES } from '../shell/modules';

// La misma frase que en el alta: un módulo se describe por lo que ves dentro,
// no por su nombre.
const QUE_ES: Record<string, string> = {
  agenda: 'Lo que tienes que hacer hoy, la semana y el mes de un vistazo.',
  org: 'Proyectos y tareas, agrupados por espacios.',
  salud: 'Diario de peso y ánimo, rutinas diarias y gimnasio.',
  suenos: 'Metas grandes, metas pequeñas y lista de deseos.',
  autonomo: 'Facturas y cuentas.',
  roadmap: 'Las mejoras pendientes del propio portal.',
};

/**
 * Qué módulos ve esta cuenta.
 *
 * Apagar NO borra nada: los datos siguen donde estaban y vuelven en cuanto se
 * enciende otra vez. Se dice en pantalla, porque el interruptor solo se toca
 * con confianza si sabes que no destruye lo de dentro.
 */
export default function ModulosTab() {
  const { perfil, recargar } = usePerfil();
  const [puestos, setPuestos] = useState<string[]>([]);
  const [guardando, setGuardando] = useState(false);
  const [aviso, setAviso] = useState('');

  useEffect(() => {
    if (perfil) setPuestos(perfil.modules);
  }, [perfil]);

  if (!perfil) return null;

  const cambiado =
    puestos.length !== perfil.modules.length || puestos.some((m) => !perfil.modules.includes(m));

  async function guardar() {
    setGuardando(true);
    setAviso('');
    try {
      await patch('/auth/me', { modules: puestos });
      await recargar();
      setAviso('Guardado. El menú ya está cambiado.');
    } catch (e) {
      setAviso((e as Error).message || 'No se ha podido guardar');
    } finally {
      setGuardando(false);
    }
  }

  return (
    <section className="section">
      <h2>Módulos</h2>
      <p className="muted" style={{ fontSize: 13, lineHeight: 1.6, marginTop: -4 }}>
        Enciende solo lo que uses. Apagar un módulo lo quita del menú, <b>no borra nada</b>: lo que tengas dentro
        sigue ahí y vuelve a aparecer si lo enciendes otra vez.
      </p>

      <div className="inv-modulos" style={{ marginTop: 14 }}>
        {/* solo lo DISPONIBLE para esta cuenta: lo que el admin no ha puesto a
            su alcance ni se enseña — un interruptor que no funciona confunde.
            (?? por si la API aún no manda la lista a mitad de despliegue) */}
        {MODULOS_ACTIVABLES.filter((m) => (perfil.modulesAllowed ?? MODULOS_ACTIVABLES.map((x) => x.id)).includes(m.id)).map((m) => {
          const on = puestos.includes(m.id);
          return (
            <button
              key={m.id}
              type="button"
              className={`inv-mod${on ? ' on' : ''}`}
              aria-pressed={on}
              onClick={() => setPuestos((p) => (on ? p.filter((x) => x !== m.id) : [...p, m.id]))}
            >
              <span className="inv-mod-ico">{m.icon}</span>
              <span className="inv-mod-txt">
                <b>{m.title}</b>
                <span>{QUE_ES[m.id] ?? ''}</span>
              </span>
              <span className="inv-mod-check" aria-hidden>
                {on ? '✓' : ''}
              </span>
            </button>
          );
        })}
      </div>

      {puestos.length === 0 && (
        <p className="inv-pista" style={{ marginTop: 10 }}>
          Deja al menos uno encendido: con todo apagado no quedaría portal que enseñar.
        </p>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 14, flexWrap: 'wrap' }}>
        <button className="btn sm" disabled={!cambiado || !puestos.length || guardando} onClick={guardar}>
          {guardando ? 'Guardando…' : 'Guardar'}
        </button>
        {cambiado && (
          <button className="btn ghost sm" onClick={() => setPuestos(perfil.modules)}>
            Deshacer
          </button>
        )}
        {aviso && <span className="muted" style={{ fontSize: 12.5 }}>{aviso}</span>}
      </div>
    </section>
  );
}
