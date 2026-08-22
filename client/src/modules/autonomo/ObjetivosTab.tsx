import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { obligacionesApi, type Objetivo, type Obligaciones } from './api';
import { useDinero } from './dinero';

/**
 * Objetivos: hacia dónde va el dinero que no se gasta.
 *
 * El progreso no es un número declarado que haya que ir manteniendo: es el
 * SALDO de la cuenta que sostiene cada objetivo, leído del banco. Si un mes
 * sacas dinero del colchón, el objetivo retrocede solo — que es exactamente lo
 * que tiene que pasar para que sirva de algo.
 *
 * Y la deuda es un objetivo más: llegar a cero. Su detalle operativo —si la has
 * pagado este ciclo— vive en Obligaciones; aquí está el recorrido.
 *
 * ESTA es la pestaña que un día se cruzará con Metas: los objetivos de dinero y
 * los de vida son la misma pregunta contada de dos maneras.
 */
export default function ObjetivosTab() {
  const { eur } = useDinero();
  const [objetivos, setObjetivos] = useState<Objetivo[] | null>(null);
  const [deudas, setDeudas] = useState<Obligaciones['deudas']>([]);

  useEffect(() => {
    obligacionesApi
      .objetivos()
      .then(setObjetivos)
      .catch(() => setObjetivos([]));
    // La deuda también es un objetivo —llegar a cero—, aunque su detalle
    // operativo (si la has pagado este ciclo) viva en Obligaciones.
    obligacionesApi
      .ver()
      .then((o) => setDeudas(o.deudas))
      .catch(() => setDeudas([]));
  }, []);

  if (!objetivos) return <p className="muted">Cargando…</p>;

  return (
    <>
      {objetivos.length === 0 && (
        <section className="section mc-bloque">
          <p className="muted mc-vacio">Todavía no hay ningún objetivo.</p>
        </section>
      )}

      {objetivos.map((o, i) => (
        <section key={o.id} className={`section mc-bloque${i === 0 ? ' oscuro' : ''}`}>
          <div className="mc-head">
            <h2>{o.nombre}</h2>
            {o.termina && (
              <span className="ob-cuando">
                lleno en{' '}
                {new Date(`${o.termina}-01`).toLocaleDateString('es-ES', { month: 'long', year: 'numeric' })}
              </span>
            )}
          </div>

          <span className="wg-etiqueta" style={{ marginTop: 16 }}>
            {o.porcentaje}% · faltan {eur(o.falta)} €
          </span>
          <b className="wg-grande">{eur(o.ahora)} €</b>
          <span className="wg-pie">
            de {eur(o.meta)} €{o.cuenta && ` · en ${o.cuenta}`}
          </span>

          <div className="ob-barra" aria-hidden style={{ marginTop: 16 }}>
            <div style={{ width: `${o.porcentaje}%` }} />
          </div>

          <p className="wg-nota">
            {o.mensual > 0
              ? `A ${eur(o.mensual)} €/ciclo${o.ciclos ? `, ${o.ciclos} ciclos por delante.` : '.'}`
              : 'Sin aportación fijada: no se puede estimar cuándo se llena.'}
          </p>
        </section>
      ))}

      {deudas.map((d) => (
        <section key={d.id} className="section mc-bloque">
          <div className="mc-head">
            <h2>Quitarte la deuda · {d.nombre}</h2>
            {d.termina && (
              <span className="ob-cuando">
                libre en{' '}
                {new Date(`${d.termina}-01`).toLocaleDateString('es-ES', { month: 'long', year: 'numeric' })}
              </span>
            )}
          </div>

          <span className="wg-etiqueta" style={{ marginTop: 16 }}>
            {d.porcentaje}% · quedan {eur(d.queda)} €
          </span>
          <b className="wg-grande">{eur(d.pagado)} €</b>
          <span className="wg-pie">devueltos de {eur(d.total)} €</span>

          <div className="ob-barra" aria-hidden style={{ marginTop: 16 }}>
            <div style={{ width: `${d.porcentaje}%` }} />
          </div>

          <p className="wg-nota">
            A {eur(d.mensual)} €/mes.{' '}
            <Link to={`/autonomo/obligaciones/deuda/${d.id}`} className="ob-mas-en">
              Ver el cuadro y probar otras cuotas →
            </Link>
          </p>
        </section>
      ))}
    </>
  );
}
