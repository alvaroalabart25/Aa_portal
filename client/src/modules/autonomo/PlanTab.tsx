import { useEffect, useState } from 'react';
import { obligacionesApi, type Plan } from './api';
import { useDinero } from './dinero';

/**
 * El plan del ciclo: a dónde va cada euro de lo que entra.
 *
 * No es un presupuesto inventado. Cada tramo sale de algo real: el IVA de lo
 * que cobras, los costes fijos de lo que se repite en tu banco, la deuda y los
 * objetivos de lo que declaraste.
 *
 * Y **para vivir es lo que sobra**, no una partida más. Esa es la idea entera
 * del reparto: primero se cubre lo que no se negocia y lo que quieres guardar,
 * y con el resto se vive. Al revés no funciona, porque siempre se gasta lo que
 * hay.
 */

export default function PlanTab() {
  const { eur } = useDinero();
  const [plan, setPlan] = useState<Plan | null>(null);
  const [editando, setEditando] = useState<string | null>(null);
  const [valor, setValor] = useState('');

  const cargar = () => obligacionesApi.plan().then(setPlan).catch(() => setPlan(null));
  useEffect(() => {
    void cargar();
  }, []);

  if (!plan) return <p className="muted">Calculando el reparto…</p>;

  async function guardar(idTramo: string) {
    const id = Number(idTramo.replace('objetivo-', ''));
    const mensual = Number(valor.replace(',', '.'));
    setEditando(null);
    if (!Number.isFinite(mensual) || mensual < 0) return;
    await obligacionesApi.cambiarObjetivo(id, { mensual });
    await cargar();
  }

  const mayor = Math.max(...plan.tramos.map((t) => t.importe), 1);

  return (
    <>
      <section className="section mc-bloque oscuro">
        <span className="wg-etiqueta">{plan.llegado ? 'Ha entrado este ciclo' : 'Entrará este ciclo'}</span>
        <b className="wg-grande">{eur(plan.ingreso)} €</b>
        <span className="wg-pie">
          {plan.llegado
            ? 'Reparte esto en cuanto puedas: el IVA primero.'
            : 'Previsión según tu último cobro.'}
        </span>
      </section>

      <section className="section mc-bloque">
        <div className="mc-head">
          <h2>A dónde va</h2>
        </div>

        <div className="pl-tramos">
          {plan.tramos.map((t) => (
            <div key={t.id} className={`pl-tramo${t.id === 'dia' ? ' vivir' : ''}`}>
              <span className="pl-t">
                <b>{t.titulo}</b>
                <span className="pl-d">{t.detalle}</span>
              </span>

              <span className="pl-pct">{t.porcentaje}%</span>

              {editando === t.id ? (
                <input
                  className="pl-input"
                  autoFocus
                  value={valor}
                  inputMode="decimal"
                  onChange={(e) => setValor(e.target.value)}
                  onBlur={() => void guardar(t.id)}
                  onKeyDown={(e) => e.key === 'Enter' && void guardar(t.id)}
                />
              ) : (
                <button
                  className={`pl-i${t.editable ? ' editable' : ''}`}
                  disabled={!t.editable}
                  onClick={() => {
                    setValor(String(t.importe));
                    setEditando(t.id);
                  }}
                >
                  {eur(t.importe)}
                </button>
              )}

              <div className="pl-barra" aria-hidden>
                <div style={{ width: `${Math.max(1, (100 * t.importe) / mayor)}%` }} />
              </div>
            </div>
          ))}
        </div>

        {!plan.cuadra && (
          <p className="wg-nota">
            El reparto no cabe: sumando todo te pasas de lo que entra. Baja algún objetivo o el plan no se puede
            cumplir.
          </p>
        )}
      </section>

      <section className="section mc-bloque">
        <div className="mc-head">
          <h2>El orden importa</h2>
        </div>
        <p className="wg-nota" style={{ marginTop: 10 }}>
          El día que entra el cobro: primero el IVA, que no es tuyo. Después lo que necesitan los recibos del ciclo.
          Luego lo que hayas decidido guardar. Y lo que queda es para vivir — nunca al revés, porque siempre se gasta
          lo que hay delante.
        </p>
      </section>
    </>
  );
}
