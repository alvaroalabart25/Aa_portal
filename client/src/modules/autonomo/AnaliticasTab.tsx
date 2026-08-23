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

/** Los últimos meses naturales, para el selector. */
function mesesRecientes(cuantos: number) {
  const hoy = new Date();
  return Array.from({ length: cuantos }, (_, i) => {
    const d = new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth() - i, 1));
    const fin = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0));
    return {
      id: `mes-${d.toISOString().slice(0, 7)}`,
      titulo: d.toLocaleDateString('es-ES', { month: 'long', year: 'numeric' }),
      desde: d.toISOString().slice(0, 10),
      hasta: fin.toISOString().slice(0, 10),
    };
  });
}

export default function AnaliticasTab() {
  const { eur, corto } = useDinero();
  const [a, setA] = useState<Analitica | null>(null);
  // «90» es días hacia atrás; cualquier otra cosa es un rango concreto
  const [periodo, setPeriodo] = useState<string>('90');

  useEffect(() => {
    const meses = mesesRecientes(6);
    const mes = meses.find((m) => m.id === periodo);
    const ciclo = a?.ciclos.find((c) => `ciclo-${c.id}` === periodo);
    const rango = mes ?? ciclo;
    analiticaApi
      .ver(rango ? { desde: rango.desde, hasta: rango.hasta } : { dias: Number(periodo) })
      .then(setA)
      .catch(() => setA(null));
    // `a` no entra en las dependencias a propósito: solo se usa para resolver
    // el ciclo elegido, y meterlo provocaría una recarga por cada respuesta.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [periodo]);

  if (!a) return <p className="muted">Calculando…</p>;

  const crece = a.cambio.diferencia >= 0;
  const dl = (iso: string) => new Date(iso).toLocaleDateString('es-ES', { day: 'numeric', month: 'long' });
  // Las fechas del texto son las de la CURVA, no las que se pidieron: si la
  // reconstrucción se cortó, decir «desde el 25 de mayo» sería mentir.
  const desdeCurva = a.curva[0]?.fecha ?? a.periodo.desde;
  const hastaCurva = a.curva[a.curva.length - 1]?.fecha ?? a.periodo.hasta;

  return (
    <>
      <div className="an-periodo">
        <select value={periodo} onChange={(e) => setPeriodo(e.target.value)}>
          <optgroup label="Hacia atrás">
            <option value="30">Últimos 30 días</option>
            <option value="90">Últimos 90 días</option>
            <option value="180">Últimos 180 días</option>
          </optgroup>
          <optgroup label="Por ciclo de cobro">
            {[...a.ciclos].reverse().map((c) => (
            <option key={c.id} value={`ciclo-${c.id}`}>
              {dm(c.desde)} → {dm(c.hasta)}
            </option>
            ))}
          </optgroup>
          <optgroup label="Por mes natural">
            {mesesRecientes(6).map((m) => (
            <option key={m.id} value={m.id}>
              {m.titulo}
            </option>
            ))}
          </optgroup>
        </select>
      </div>

      {/* Lo grande es lo que TIENES, que es un dato leído del banco. El cambio
          es un cálculo y va debajo: puestos al revés, la cifra que se queda en
          la cabeza es la que no se puede comprobar. */}
      <section className="section mc-bloque oscuro">
        <span className="wg-etiqueta">Lo que tienes hoy</span>
        <b className="wg-grande">{eur(a.hoy)} €</b>
        <span className="wg-pie">
          en tus cuentas
          {a.apartado > 0 && `, sin contar los ${eur(a.apartado)} € que guardas para Hacienda`}
        </span>

        <Grafica
          series={[{ nombre: 'Patrimonio', puntos: a.curva.map((p) => p.total) }]}
          etiquetas={[dm(a.curva[0]?.fecha ?? ''), dm(a.curva[a.curva.length - 1]?.fecha ?? '')]}
          fechas={a.curva.map((p) => p.fecha)}
          formato={corto}
        />

        <p className="wg-nota">
          Del {dl(desdeCurva)} al {dl(hastaCurva)}
          {crece ? ' has ganado ' : ' has perdido '}
          <b>{eur(Math.abs(a.cambio.diferencia))} €</b> · de {eur(a.cambio.desde)} € a {eur(a.cambio.hasta)} €.
        </p>

        {a.cortado && (
          <p className="wg-nota">
            No se puede mirar más atrás del {dl(desdeCurva)}: {a.cortadoPor.join(' y ')}{' '}
            {a.cortadoPor.length > 1 ? 'no devuelven' : 'no devuelve'} todos los apuntes, y la reconstrucción daba
            saldos imposibles. Antes de enseñarte un número inventado, se corta.
          </p>
        )}

        {a.fotos <= 1 && (
          <p className="wg-nota">
            Desde ahora se guarda una foto diaria del saldo, así que esto deja de depender de reconstruir nada.
          </p>
        )}
      </section>

      <section className="section mc-bloque">
        <div className="mc-head">
          <h2>Cuánto creciste cada ciclo</h2>
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
                {!c.completo && <em className="an-ciclo-duda">le falta histórico</em>}
              </span>
            </div>
          ))}
        </div>
        <p className="wg-nota">
          La cifra de la derecha es lo que cambió tu patrimonio, no la resta: el dinero que apartas para Hacienda sale
          de tu bolsillo sin ser un gasto, y lo que mandas a un sitio que el portal no lee tampoco se puede seguir.
          Los ciclos marcados se calculan con apuntes que el banco no devuelve enteros.
        </p>
      </section>

      <section className="section mc-bloque">
        <div className="mc-head">
          <h2>En qué se va</h2>
          <span className="ob-cuando">
            {eur(a.totalGastos)} € · {dm(a.periodo.desde)} → {dm(a.periodo.hasta)}
          </span>
        </div>
        <PorCategoria categorias={a.categorias} total={a.totalGastos} />
        <p className="ob-nota">
          {a.guardado > 0
            ? `De esos, ${eur(a.guardado)} € no se gastaron: se guardaron. Salieron de la cuenta pero siguen siendo tuyos.`
            : 'Ningún euro fue a ahorro en este periodo.'}
        </p>
      </section>

      {/* Enfrentadas: entra a la izquierda, sale a la derecha. En móvil se
          apilan solas, que en 375 px dos columnas no se leen. */}
      <div className="an-dos">
        <section className="section mc-bloque">
          <div className="mc-head">
            <h2>De dónde entra</h2>
            <span className="ob-cuando">
              {eur(a.totalIngresos)} € · {dm(a.periodo.desde)} → {dm(a.periodo.hasta)}
            </span>
          </div>
          <Reparto filas={a.ingresos} />
        </section>

        <section className="section mc-bloque">
          <div className="mc-head">
            <h2>En qué comercios</h2>
            <span className="ob-cuando">{a.gastos.length} sitios</span>
          </div>
          <Reparto filas={a.gastos} />
        </section>
      </div>
    </>
  );
}

/**
 * El gasto por categoría, de mayor a menor.
 *
 * «Sin categoría» va con los demás y con su importe delante, no escondido al
 * final: es el único hueco del portal que es información, porque dice cuánto de
 * lo que gastas todavía no sabemos en qué se fue. Se arregla en Movimientos.
 */
function PorCategoria({
  categorias,
  total,
}: {
  categorias: { categoria: string; nombre: string; n: number; importe: number; gasto: boolean }[];
  total: number;
}) {
  const { eur } = useDinero();
  const filas = [...categorias].sort((a, z) => z.importe - a.importe);
  if (!filas.length) return <p className="muted mc-vacio">Ningún gasto en este periodo.</p>;

  return (
    <div className="an-reparto">
      {filas.map((c) => (
        <div key={c.categoria} className={`an-fila cat${c.categoria === 'sin' ? ' pendiente' : ''}`}>
          <span className="an-fila-n">
            {c.nombre}
            {!c.gasto && <em className="an-fila-tag">no es gasto</em>}
          </span>
          <span className="an-fila-i">{eur(c.importe)}</span>
          <div className="an-fila-b" aria-hidden>
            <div style={{ width: `${Math.max(2, total > 0 ? Math.round((100 * c.importe) / total) : 0)}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Una lista con barra: se lee el peso de cada cosa sin leer los números. */
function Reparto({ filas }: { filas: { nombre: string; n: number; importe: number; porcentaje: number; tipo: string }[] }) {
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
