import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { gymApi, kg, listaMusculos, nombreMusculo, numTxt, type EjercicioEnSesion, type SesionDetalle } from './api';

/**
 * Seguir el entrenamiento, serie a serie.
 *
 * Cada serie se guarda en cuanto se marca, no al final: si el móvil se apaga a
 * mitad de sesión no se pierde nada. Y cada una llega con lo que hiciste la vez
 * anterior ya escrito, porque lo normal es repetir o subir un poco, no empezar
 * de cero cada día.
 */
export default function SesionPage() {
  const { id } = useParams();
  const sesionId = Number(id);
  const navigate = useNavigate();
  const [datos, setDatos] = useState<SesionDetalle | null>(null);
  const [cerrando, setCerrando] = useState(false);

  const cargar = useCallback(async () => setDatos(await gymApi.sesion(sesionId)), [sesionId]);
  useEffect(() => {
    cargar();
  }, [cargar]);

  if (!datos) return <p className="muted">Cargando…</p>;

  const total = datos.exercises.reduce((n, e) => n + e.targetSets, 0);
  const hechas = datos.exercises.reduce((n, e) => n + e.done.length, 0);
  const cerrada = datos.session.endedAt != null;

  async function terminar() {
    if (hechas === 0) {
      if (!confirm('No has marcado ninguna serie. ¿Tiro esta sesión a la basura?')) return;
      await gymApi.tirar(sesionId);
      navigate('/gimnasio');
      return;
    }
    setCerrando(true);
    try {
      await gymApi.cerrar(sesionId);
      navigate('/gimnasio');
    } finally {
      setCerrando(false);
    }
  }

  return (
    <div>
      <div className="tk-crumbs">
        <Link to="/gimnasio" className="btn ghost sm tk-back">
          ‹ Gimnasio
        </Link>
        <span className="tk-path">{new Date(`${datos.session.sessionDate}T12:00:00`).toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' })}</span>
      </div>

      <div className="page-head">
        <h1>{datos.day?.name ?? 'Entrenamiento'}</h1>
        <div className="head-acciones">
          <span className="gy-marcador">
            {hechas}/{total}
          </span>
        </div>
      </div>

      {datos.exercises.map((e) => (
        <BloqueEjercicio key={e.id} ejercicio={e} sesionId={sesionId} onCambio={cargar} bloqueado={cerrada} />
      ))}

      {!cerrada && (
        <button className="btn gy-terminar" disabled={cerrando} onClick={terminar}>
          {cerrando ? 'Guardando…' : hechas === 0 ? 'Tirar la sesión' : 'Terminar entrenamiento'}
        </button>
      )}
      {cerrada && <p className="muted mc-vacio">Sesión cerrada. Lo que ves es lo que quedó registrado.</p>}
    </div>
  );
}

function BloqueEjercicio({
  ejercicio,
  sesionId,
  onCambio,
  bloqueado,
}: {
  ejercicio: EjercicioEnSesion;
  sesionId: number;
  onCambio: () => void;
  bloqueado: boolean;
}) {
  const series = Array.from({ length: ejercicio.targetSets }, (_, i) => i + 1);
  const completo = ejercicio.done.length >= ejercicio.targetSets;

  return (
    <section className={`gy-bloque${completo ? ' hecho' : ''}`}>
      <div className="gy-bloque-head">
        <div>
          <h2 className="gy-bloque-n">{ejercicio.name}</h2>
          <p className="gy-bloque-obj">
            {ejercicio.targetSets} × {ejercicio.targetReps}
            {ejercicio.targetWeight ? ` · objetivo ${kg(ejercicio.targetWeight)}` : ''}
            {ejercicio.restSeconds ? ` · ${ejercicio.restSeconds}s de descanso` : ''}
          </p>
          {listaMusculos(ejercicio.muscles).length > 0 && (
            <p className="gy-ej-m">{listaMusculos(ejercicio.muscles).map(nombreMusculo).join(' · ')}</p>
          )}
        </div>
        {completo && <span className="gy-tic">✓</span>}
      </div>

      {ejercicio.notes && <p className="gy-bloque-nota">{ejercicio.notes}</p>}

      <div className="gy-series">
        {series.map((n) => (
          <FilaSerie
            key={n}
            n={n}
            ejercicio={ejercicio}
            sesionId={sesionId}
            onCambio={onCambio}
            bloqueado={bloqueado}
          />
        ))}
      </div>
    </section>
  );
}

function FilaSerie({
  n,
  ejercicio,
  sesionId,
  onCambio,
  bloqueado,
}: {
  n: number;
  ejercicio: EjercicioEnSesion;
  sesionId: number;
  onCambio: () => void;
  bloqueado: boolean;
}) {
  const hecha = ejercicio.done.find((d) => d.setNumber === n);
  const antes = ejercicio.previous.sets.find((s) => s.setNumber === n);
  const porTiempo = ejercicio.kind === 'tiempo';

  // De salida, lo de la vez anterior: lo normal es repetir o subir un poco
  const [peso, setPeso] = useState(numTxt(hecha?.weight ?? antes?.weight ?? ejercicio.targetWeight));
  const [medida, setMedida] = useState(
    String(
      (porTiempo ? (hecha?.seconds ?? antes?.seconds) : (hecha?.reps ?? antes?.reps)) ?? '',
    ),
  );
  const [busy, setBusy] = useState(false);

  async function marcar() {
    if (bloqueado) return;
    setBusy(true);
    try {
      if (hecha) {
        await gymApi.borrarSerie(sesionId, hecha.id);
      } else {
        const v = medida.trim() === '' ? null : Number(medida.replace(',', '.'));
        await gymApi.marcarSerie(sesionId, {
          exerciseId: ejercicio.id,
          setNumber: n,
          reps: porTiempo ? null : v,
          seconds: porTiempo ? v : null,
          weight: peso === '' ? null : Number(String(peso).replace(',', '.')),
        });
      }
      onCambio();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={`gy-serie${hecha ? ' puesta' : ''}`}>
      <span className="gy-serie-n">{n}</span>

      <label className="gy-campo">
        <span>kg</span>
        <input
          inputMode="decimal"
          value={peso}
          disabled={bloqueado || !!hecha}
          onChange={(e) => setPeso(e.target.value)}
        />
      </label>

      <label className="gy-campo">
        <span>{porTiempo ? 'seg' : 'repes'}</span>
        <input
          inputMode="numeric"
          value={medida}
          disabled={bloqueado || !!hecha}
          onChange={(e) => setMedida(e.target.value)}
        />
      </label>

      {/* lo de la vez anterior, en gris: es la referencia, no un dato editable.
          Si no hay vez anterior no se pinta: un guion suelto solo ocupa sitio. */}
      {antes && (
        <span className="gy-antes">
          la última: {antes.weight ? `${numTxt(antes.weight)} × ` : ''}
          {porTiempo ? `${antes.seconds}s` : antes.reps}
        </span>
      )}

      <button
        className={`gy-check${hecha ? ' puesto' : ''}`}
        disabled={busy || bloqueado}
        aria-label={hecha ? `Desmarcar la serie ${n}` : `Marcar la serie ${n}`}
        onClick={marcar}
      >
        ✓
      </button>
    </div>
  );
}
