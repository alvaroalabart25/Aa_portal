import { useEffect, useState } from 'react';
import { analiticaApi, type Analitica } from './api';
import Grafica from './Grafica';
import { useDinero } from './dinero';

/**
 * Analíticas: tres preguntas y nada más.
 *
 *   ¿Crece mi patrimonio?  ·  ¿De dónde entra?  ·  ¿En qué se va?
 *
 * La primera tiene truco: el portal guarda el saldo de hoy y lo pisa en cada
 * sincronización, así que no había histórico. La curva se **reconstruye hacia
 * atrás** —el saldo de un día pasado es el de hoy menos lo que se movió
 * después—, y desde ahora además se guarda una foto diaria, que no caduca.
 */

const dm = (iso: string) => new Date(iso).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });

export default function AnaliticasTab() {
  const { eur, corto } = useDinero();
  const [a, setA] = useState<Analitica | null>(null);
  const [dias, setDias] = useState(90);

  useEffect(() => {
    analiticaApi
      .ver(dias)
      .then(setA)
      .catch(() => setA(null));
  }, [dias]);

  if (!a) return <p className="muted">Calculando…</p>;

  const crece = a.cambio.diferencia >= 0;

  return (
    <>
      <section className="section mc-bloque oscuro">
        <span className="wg-etiqueta">{crece ? 'Tu patrimonio ha crecido' : 'Tu patrimonio ha bajado'}</span>
        <b className="wg-grande">
          {crece ? '+' : '−'}
          {eur(Math.abs(a.cambio.diferencia))} €
        </b>
        <span className="wg-pie">
          de {eur(a.cambio.desde)} € a {eur(a.cambio.hasta)} € en {a.dias} días
        </span>

        <Grafica
          series={[{ nombre: 'Patrimonio', puntos: a.curva.map((p) => p.total) }]}
          etiquetas={[dm(a.curva[0]?.fecha ?? ''), dm(a.curva[a.curva.length - 1]?.fecha ?? '')]}
          formato={corto}
        />

        <div className="an-rango">
          {[30, 90, 180].map((d) => (
            <button key={d} className={d === dias ? 'active' : ''} onClick={() => setDias(d)}>
              {d} días
            </button>
          ))}
        </div>

        {a.fotos === 0 && (
          <p className="wg-nota">
            Reconstruido a partir de tus movimientos. Desde hoy se guarda una foto diaria, así que a partir de aquí
            será histórico de verdad.
          </p>
        )}
      </section>

      <section className="section mc-bloque">
        <div className="mc-head">
          <h2>Ciclo a ciclo</h2>
        </div>
        <div className="an-ciclos">
          {a.ciclos.map((c) => (
            <div key={c.id} className="an-ciclo">
              <span className="an-ciclo-f">
                {dm(c.desde)} → {dm(c.hasta)}
              </span>
              <span className={`an-ciclo-r${c.patrimonio < 0 ? ' mal' : ''}`}>
                {c.patrimonio < 0 ? '−' : '+'}
                {eur(Math.abs(c.patrimonio))}
              </span>
              <span className="an-ciclo-d">
                entra {eur(c.entra)} · sale {eur(c.sale)}
                {c.aHacienda > 0 && ` · ${eur(c.aHacienda)} apartados`}
              </span>
            </div>
          ))}
        </div>
        <p className="wg-nota">
          La cifra grande es lo que cambió tu patrimonio, no la resta de arriba: el dinero que apartas para Hacienda
          sale de tu bolsillo sin ser un gasto, y lo que mandas a inversión tampoco se puede leer.
        </p>
      </section>

      {/* Enfrentadas: entra a la izquierda, sale a la derecha. En móvil se
          apilan solas, que en 375 px dos columnas no se leen. */}
      <div className="an-dos">
        <section className="section mc-bloque">
          <div className="mc-head">
            <h2>De dónde entra</h2>
            <span className="ob-cuando">{eur(a.totalIngresos)} €</span>
          </div>
          <Reparto filas={a.ingresos} />
        </section>

        <section className="section mc-bloque">
          <div className="mc-head">
            <h2>En qué se va</h2>
            <span className="ob-cuando">{eur(a.totalGastos)} €</span>
          </div>
          <Reparto filas={a.gastos} />
        </section>
      </div>
    </>
  );
}

/** Una lista con barra: se lee el peso de cada cosa sin leer los números. */
function Reparto({ filas }: { filas: { nombre: string; n: number; importe: number; porcentaje: number }[] }) {
  const { eur } = useDinero();
  const [todo, setTodo] = useState(false);
  const visibles = todo ? filas : filas.slice(0, 8);
  const resto = filas.slice(8);
  const sumaResto = resto.reduce((a, f) => a + f.importe, 0);

  return (
    <>
      <div className="an-reparto">
        {visibles.map((f) => (
          <div key={f.nombre} className="an-fila">
            <span className="an-fila-n">{f.nombre.toLowerCase()}</span>
            <span className="an-fila-i">{eur(f.importe)}</span>
            <div className="an-fila-b" aria-hidden>
              <div style={{ width: `${Math.max(2, f.porcentaje)}%` }} />
            </div>
          </div>
        ))}
      </div>
      {resto.length > 0 && (
        <button className="mv-modo" onClick={() => setTodo(!todo)}>
          {todo ? 'ver solo los mayores' : `ver ${resto.length} más (${eur(sumaResto)} €)`}
        </button>
      )}
    </>
  );
}
