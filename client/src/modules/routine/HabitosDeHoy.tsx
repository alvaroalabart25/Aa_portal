import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { checksApi, type DailyCheck } from '../health/api';

/**
 * Los hábitos de hoy, en la portada del mes.
 *
 * Aquí NO puede haber una lista: es la pantalla a la que se entra veinte veces
 * al día y una retahíla de cosas pendientes la arruina. Así que van como
 * pastillas, se marcan desde aquí mismo y, si son muchas, solo se enseñan las
 * que faltan —lo hecho ya no pide nada— con la cuenta al lado.
 */
const TOPE = 6;

function vibrar(patron: number | number[]) {
  try {
    navigator.vibrate?.(patron);
  } catch {
    /* si el navegador no deja, da igual */
  }
}

export default function HabitosDeHoy() {
  const [checks, setChecks] = useState<DailyCheck[]>([]);
  const [listo, setListo] = useState(false);

  const cargar = useCallback(async () => {
    const r = await checksApi.list().catch(() => null);
    if (r) setChecks(r.checks);
    setListo(true);
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  if (!listo || checks.length === 0) return null;

  // Cumplido, no marcado hoy: un hábito de dos veces por semana con las dos
  // hechas no pide nada aunque hoy no lo hayas tocado.
  const hechos = checks.filter((c) => c.cumplido).length;
  const total = checks.length;
  const completo = hechos === total;

  async function marcar(c: DailyCheck) {
    if (c.kind === 'peso') return;
    const done = !c.done;
    setChecks((l) =>
      l.map((x) => {
        if (x.id !== c.id) return x;
        const semana = Math.max(0, x.estaSemana + (done ? 1 : -1));
        return { ...x, done, estaSemana: semana, cumplido: x.objetivoSemanal ? semana >= x.objetivoSemanal : done };
      }),
    );
    if (done) vibrar(18);
    await checksApi.toggle(c.id, done).catch(() => cargar());
  }

  // Delante lo que falta: lo hecho ya no pide nada, pero se queda a la vista
  // porque ver lo hecho es media gracia de esto.
  const orden = [...checks].sort((a, b) => Number(a.cumplido) - Number(b.cumplido));
  const visibles = orden.slice(0, TOPE);
  const resto = orden.length - visibles.length;

  return (
    <div className="mc-col">
      <div className="mc-col-t">
        <span>✅ Hábitos</span>
        <Link to="/rutina" className="mc-col-mas">
          {hechos}/{total}
        </Link>
      </div>

      {/* En tarjeta blanca, como la formación y el gimnasio: dentro de
          Constancia las tres cosas se leen igual o no se leen como lo mismo. */}
      <div className={`hh claro${completo ? ' completo' : ''}`}>
        {visibles.map((c) => (
          <button key={c.id} className={`hh-p${c.cumplido ? ' hecho' : ''}`} onClick={() => marcar(c)}>
            <span aria-hidden="true">{c.emoji}</span>
            {c.title}
            {/* En los semanales, la cuenta va dentro: «1/2» dice más que el
                nombre solo, y sin ella no se sabe si falta o no. */}
            {c.objetivoSemanal && (
              <em>
                {c.estaSemana}/{c.objetivoSemanal}
              </em>
            )}
          </button>
        ))}
        {resto > 0 && (
          <Link to="/rutina" className="hh-mas">
            +{resto}
          </Link>
        )}
      </div>
    </div>
  );
}
