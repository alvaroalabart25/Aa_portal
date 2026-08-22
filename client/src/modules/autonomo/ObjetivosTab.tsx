import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { obligacionesApi, type Objetivo } from './api';
import { useDinero } from './dinero';

/**
 * Objetivos: hacia dónde va el dinero que no se gasta.
 *
 * El progreso no es un número declarado que haya que ir manteniendo: es el
 * SALDO de la cuenta que sostiene cada objetivo, leído del banco. Si un mes
 * sacas dinero del colchón, el objetivo retrocede solo — que es exactamente lo
 * que tiene que pasar para que sirva de algo.
 */
export default function ObjetivosTab() {
  const { eur } = useDinero();
  const [objetivos, setObjetivos] = useState<Objetivo[] | null>(null);

  useEffect(() => {
    obligacionesApi
      .objetivos()
      .then(setObjetivos)
      .catch(() => setObjetivos([]));
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

      <section className="section mc-bloque">
        <div className="mc-head">
          <h2>Deuda</h2>
        </div>
        <p className="wg-nota" style={{ marginTop: 8 }}>
          Lo que debes vive en su pantalla, con su cuadro de amortización.{' '}
          <Link to="/autonomo/obligaciones" className="ob-mas-en">
            Ver Obligaciones y Deuda →
          </Link>
        </p>
      </section>
    </>
  );
}
