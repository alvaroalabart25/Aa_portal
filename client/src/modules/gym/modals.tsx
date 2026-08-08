import { useState, type FormEvent } from 'react';
import Modal from '../../components/Modal';
import { useEffect } from 'react';
import {
  gymApi,
  listaMusculos,
  MUSCULOS,
  nombreMusculo,
  type Condicionante,
  type Ejercicio,
  type MetaGym,
  type Parte,
  type TipoMeta,
} from './api';

const num = (v: string) => (v.trim() === '' ? null : Number(v.replace(',', '.')));

/** Alta y edición de un ejercicio de la rutina. */
export function EjercicioModal({
  dayId,
  ejercicio,
  onClose,
  onGuardado,
}: {
  dayId: number;
  ejercicio?: Ejercicio;
  onClose: () => void;
  onGuardado: () => void;
}) {
  const [name, setName] = useState(ejercicio?.name ?? '');
  const [partes, setPartes] = useState<Parte[]>([]);
  const [elegidas, setElegidas] = useState<string[]>(listaMusculos(ejercicio?.parts ?? ''));
  const [kind, setKind] = useState<'repes' | 'tiempo'>(ejercicio?.kind ?? 'repes');
  const [targetSets, setTargetSets] = useState(String(ejercicio?.targetSets ?? 3));
  const [targetReps, setTargetReps] = useState(ejercicio?.targetReps ?? '8-10');
  const [targetWeight, setTargetWeight] = useState(ejercicio?.targetWeight ?? '');
  const [restSeconds, setRestSeconds] = useState(ejercicio?.restSeconds ? String(ejercicio.restSeconds) : '');
  const [notes, setNotes] = useState(ejercicio?.notes ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    gymApi.partes().then(setPartes).catch(() => {});
  }, []);

  function alternar(id: string) {
    setElegidas((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    setError('');
    const datos = {
      name: name.trim(),
      parts: elegidas.join(','),
      kind,
      targetSets: Number(targetSets) || 3,
      targetReps: targetReps.trim() || (kind === 'tiempo' ? '60s' : '8-10'),
      targetWeight: num(targetWeight),
      restSeconds: restSeconds.trim() === '' ? null : Number(restSeconds),
      notes: notes.trim() || null,
    };
    try {
      if (ejercicio) await gymApi.editarEjercicio(ejercicio.id, datos);
      else await gymApi.crearEjercicio({ ...datos, dayId });
      onGuardado();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo guardar');
    } finally {
      setBusy(false);
    }
  }

  async function borrar() {
    if (!ejercicio || !confirm(`¿Quitar «${ejercicio.name}» de la rutina? El histórico de lo levantado se conserva.`))
      return;
    await gymApi.borrarEjercicio(ejercicio.id);
    onGuardado();
  }

  return (
    <Modal title={ejercicio ? 'Ejercicio' : 'Nuevo ejercicio'} onClose={onClose}>
      <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div className="field">
          <label htmlFor="gy-n">Ejercicio</label>
          <input id="gy-n" value={name} onChange={(e) => setName(e.target.value)} autoFocus placeholder="Sentadilla con barra" />
        </div>

        <div className="field">
          <label>Qué trabaja</label>
          {/* por PARTE y no por bloque: es lo que permite decir después que del
              hombro solo estás tocando el anterior */}
          {MUSCULOS.map((bloque) => {
            const suyas = partes.filter((p) => p.muscle === bloque.id);
            if (suyas.length === 0) return null;
            return (
              <div key={bloque.id} className="gy-picker-zona">
                <span className="gy-picker-t">{bloque.label}</span>
                <div className="gy-mus-picker">
                  {suyas.map((parte) => (
                    <button
                      type="button"
                      key={parte.id}
                      className={`gy-mus-op${elegidas.includes(parte.id) ? ' puesto' : ''}`}
                      onClick={() => alternar(parte.id)}
                    >
                      {parte.label.includes('·') ? parte.label.split('·')[1].trim() : parte.label}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>

        <div className="form-grid">
          <div>
            <label htmlFor="gy-k">Se mide en</label>
            <select id="gy-k" value={kind} onChange={(e) => setKind(e.target.value as 'repes' | 'tiempo')}>
              <option value="repes">Repeticiones</option>
              <option value="tiempo">Tiempo</option>
            </select>
          </div>
          <div>
            <label htmlFor="gy-s">Series</label>
            <input id="gy-s" type="number" min={1} max={20} value={targetSets} onChange={(e) => setTargetSets(e.target.value)} />
          </div>
          <div>
            <label htmlFor="gy-r">{kind === 'tiempo' ? 'Tiempo objetivo' : 'Repes objetivo'}</label>
            <input
              id="gy-r"
              value={targetReps}
              onChange={(e) => setTargetReps(e.target.value)}
              placeholder={kind === 'tiempo' ? '1:15 por lado' : '8-10'}
            />
          </div>
          <div>
            <label htmlFor="gy-w">Peso objetivo (kg)</label>
            <input id="gy-w" inputMode="decimal" value={targetWeight} onChange={(e) => setTargetWeight(e.target.value)} />
          </div>
          <div>
            <label htmlFor="gy-d">Descanso (s)</label>
            <input id="gy-d" type="number" min={0} max={900} value={restSeconds} onChange={(e) => setRestSeconds(e.target.value)} />
          </div>
        </div>

        <div className="field">
          <label htmlFor="gy-no">Notas y técnica</label>
          <textarea
            id="gy-no"
            rows={3}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Codos pegados. Banco a 30°. Escalera 20 · 25 · 35."
          />
        </div>

        {error && <div className="error-msg">{error}</div>}
        <div className="modal-actions">
          {ejercicio && (
            <button type="button" className="btn ghost danger" onClick={borrar}>
              Quitar
            </button>
          )}
          <button type="button" className="btn ghost" onClick={onClose}>
            Cancelar
          </button>
          <button className="btn" disabled={busy || !name.trim()}>
            {busy ? 'Guardando…' : 'Guardar'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

const TIPOS: [TipoMeta, string, string][] = [
  ['fase', 'Fase', 'En qué estás: hipertrofia, fuerza, definición…'],
  ['peso', 'Peso corporal', 'El de hoy se lee de Salud · Diario, no se apunta aquí'],
  ['ejercicio', 'Marca en un ejercicio', 'El de hoy sale del máximo que hayas levantado'],
  ['libre', 'Otro', 'Sin número: una nota de a dónde vas'],
];

/** Alta y edición de un objetivo del gimnasio. */
export function MetaModal({
  meta,
  ejercicios,
  onClose,
  onGuardado,
}: {
  meta?: MetaGym;
  ejercicios: Ejercicio[];
  onClose: () => void;
  onGuardado: () => void;
}) {
  const [kind, setKind] = useState<TipoMeta>(meta?.kind ?? 'peso');
  const [title, setTitle] = useState(meta?.title ?? '');
  const [exerciseId, setExerciseId] = useState<number | ''>(meta?.exerciseId ?? '');
  const [startValue, setStartValue] = useState(meta?.startValue ?? '');
  const [targetValue, setTargetValue] = useState(meta?.targetValue ?? '');
  const [deadline, setDeadline] = useState(meta?.deadline ?? '');
  const [notes, setNotes] = useState(meta?.notes ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const conNumero = kind === 'peso' || kind === 'ejercicio';

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setBusy(true);
    setError('');
    const datos = {
      kind,
      title: title.trim(),
      exerciseId: kind === 'ejercicio' && exerciseId ? Number(exerciseId) : null,
      startValue: conNumero ? num(startValue) : null,
      targetValue: conNumero ? num(targetValue) : null,
      unit: conNumero ? 'kg' : null,
      deadline: deadline || null,
      notes: notes.trim() || null,
    };
    try {
      if (meta) await gymApi.editarObjetivo(meta.id, datos);
      else await gymApi.crearObjetivo(datos);
      onGuardado();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo guardar');
    } finally {
      setBusy(false);
    }
  }

  async function marcar(status: 'logrado' | 'activo') {
    if (!meta) return;
    await gymApi.editarObjetivo(meta.id, { status });
    onGuardado();
  }

  async function borrar() {
    if (!meta || !confirm(`¿Borrar el objetivo «${meta.title}»?`)) return;
    await gymApi.borrarObjetivo(meta.id);
    onGuardado();
  }

  return (
    <Modal title={meta ? 'Objetivo' : 'Nuevo objetivo'} onClose={onClose}>
      <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div className="field">
          <label htmlFor="gm-k">Tipo</label>
          <select id="gm-k" value={kind} onChange={(e) => setKind(e.target.value as TipoMeta)}>
            {TIPOS.map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
          <span className="muted" style={{ fontSize: 12.5, marginTop: 4 }}>
            {TIPOS.find(([id]) => id === kind)?.[2]}
          </span>
        </div>

        <div className="field">
          <label htmlFor="gm-t">Objetivo</label>
          <input
            id="gm-t"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            autoFocus
            placeholder={kind === 'fase' ? 'Hipertrofia' : kind === 'peso' ? 'Llegar a 80 kg' : 'Sentadilla a 50 kg'}
          />
        </div>

        {kind === 'ejercicio' && (
          <div className="field">
            <label htmlFor="gm-e">¿En qué ejercicio?</label>
            <select id="gm-e" value={exerciseId} onChange={(e) => setExerciseId(e.target.value ? Number(e.target.value) : '')}>
              <option value="">Elige uno…</option>
              {ejercicios.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
            </select>
          </div>
        )}

        {conNumero && (
          <div className="form-grid">
            <div>
              <label htmlFor="gm-s">Punto de salida (kg)</label>
              <input id="gm-s" inputMode="decimal" value={startValue} onChange={(e) => setStartValue(e.target.value)} />
            </div>
            <div>
              <label htmlFor="gm-o">Objetivo (kg)</label>
              <input id="gm-o" inputMode="decimal" value={targetValue} onChange={(e) => setTargetValue(e.target.value)} />
            </div>
            <div>
              <label htmlFor="gm-f">Para cuándo</label>
              <input id="gm-f" type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
            </div>
          </div>
        )}

        <div className="field">
          <label htmlFor="gm-n">Notas</label>
          <textarea id="gm-n" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>

        {error && <div className="error-msg">{error}</div>}
        <div className="modal-actions">
          {meta && (
            <button type="button" className="btn ghost danger" onClick={borrar}>
              Borrar
            </button>
          )}
          {meta && meta.status === 'activo' && (
            <button type="button" className="btn ghost" onClick={() => marcar('logrado')}>
              Conseguido
            </button>
          )}
          {meta && meta.status === 'logrado' && (
            <button type="button" className="btn ghost" onClick={() => marcar('activo')}>
              Reabrir
            </button>
          )}
          <button className="btn" disabled={busy || !title.trim()}>
            {busy ? 'Guardando…' : 'Guardar'}
          </button>
        </div>
      </form>
    </Modal>
  );
}


const LADOS: [Condicionante['side'], string][] = [
  ['na', 'Sin lado'],
  ['izquierdo', 'Izquierdo'],
  ['derecho', 'Derecho'],
  ['ambos', 'Ambos'],
];

/** Una lesión o limitación con la que se entrena. */
export function CondicionanteModal({
  condicionante,
  onClose,
  onGuardado,
}: {
  condicionante?: Condicionante;
  onClose: () => void;
  onGuardado: () => void;
}) {
  const [title, setTitle] = useState(condicionante?.title ?? '');
  const [side, setSide] = useState<Condicionante['side']>(condicionante?.side ?? 'na');
  const [muscles, setMuscles] = useState<string[]>(listaMusculos(condicionante?.muscles ?? ''));
  const [severity, setSeverity] = useState<Condicionante['severity']>(condicionante?.severity ?? 'cuidado');
  const [advice, setAdvice] = useState(condicionante?.advice ?? '');
  const [notes, setNotes] = useState(condicionante?.notes ?? '');
  const [since, setSince] = useState(condicionante?.since ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setBusy(true);
    setError('');
    const datos = {
      title: title.trim(),
      side,
      muscles: muscles.join(','),
      severity,
      advice: advice.trim() || null,
      notes: notes.trim() || null,
      since: since || null,
    };
    try {
      if (condicionante) await gymApi.editarCondicionante(condicionante.id, datos);
      else await gymApi.crearCondicionante(datos);
      onGuardado();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo guardar');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={condicionante ? 'Condicionante' : 'Nuevo condicionante'} onClose={onClose}>
      <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div className="field">
          <label htmlFor="gc-t">Qué es</label>
          <input
            id="gc-t"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            autoFocus
            placeholder="Lesión SLAP en el hombro"
          />
        </div>

        <div className="form-grid">
          <div>
            <label htmlFor="gc-l">Lado</label>
            <select id="gc-l" value={side} onChange={(e) => setSide(e.target.value as Condicionante['side'])}>
              {LADOS.map(([id, label]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="gc-s">Cómo condiciona</label>
            <select
              id="gc-s"
              value={severity}
              onChange={(e) => setSeverity(e.target.value as Condicionante['severity'])}
            >
              <option value="cuidado">Con cuidado</option>
              <option value="evitar">Evitar</option>
            </select>
          </div>
          <div>
            <label htmlFor="gc-d">Desde</label>
            <input id="gc-d" type="date" value={since} onChange={(e) => setSince(e.target.value)} />
          </div>
        </div>

        <div className="field">
          <label>Zonas afectadas</label>
          {/* por bloque entero y no por parte: una lesión no distingue tanto */}
          <div className="gy-mus-picker">
            {MUSCULOS.map((m) => (
              <button
                type="button"
                key={m.id}
                className={`gy-mus-op${muscles.includes(m.id) ? ' puesto' : ''}`}
                onClick={() => setMuscles((p) => (p.includes(m.id) ? p.filter((x) => x !== m.id) : [...p, m.id]))}
              >
                {nombreMusculo(m.id)}
              </button>
            ))}
          </div>
        </div>

        <div className="field">
          <label htmlFor="gc-a">Qué hago con esto</label>
          <input
            id="gc-a"
            value={advice}
            onChange={(e) => setAdvice(e.target.value)}
            placeholder="Nada por encima de la cabeza con carga. Agarre neutro."
          />
        </div>

        <div className="field">
          <label htmlFor="gc-n">Notas</label>
          <textarea id="gc-n" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>

        {error && <div className="error-msg">{error}</div>}
        <div className="modal-actions">
          {condicionante && (
            <button
              type="button"
              className="btn ghost danger"
              onClick={async () => {
                if (!confirm(`¿Borrar «${condicionante.title}»?`)) return;
                await gymApi.borrarCondicionante(condicionante.id);
                onGuardado();
              }}
            >
              Borrar
            </button>
          )}
          {condicionante && (
            <button
              type="button"
              className="btn ghost"
              onClick={async () => {
                await gymApi.editarCondicionante(condicionante.id, {
                  status: condicionante.status === 'activo' ? 'superado' : 'activo',
                });
                onGuardado();
              }}
            >
              {condicionante.status === 'activo' ? 'Ya superado' : 'Reabrir'}
            </button>
          )}
          <button className="btn" disabled={busy || !title.trim()}>
            {busy ? 'Guardando…' : 'Guardar'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
