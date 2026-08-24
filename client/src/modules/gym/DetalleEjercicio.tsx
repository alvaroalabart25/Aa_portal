import { useEffect, useState } from 'react';
import Modal from '../../components/Modal';
import { ElegirEjercicio } from './Catalogo';
import { gymApi, listaMusculos, nombreMusculo, numTxt, type DiaRutina, type Ejercicio } from './api';
import { laBarra, pesoReal } from './peso';

/** Los bloques que la sesión ya trabaja, derivados de sus ejercicios. */
const bloquesDe = (dia: DiaRutina) => [...new Set(dia.exercises.flatMap((e) => listaMusculos(e.muscles)))];

/**
 * La ficha de un ejercicio dentro de una sesión de la rutina.
 *
 * Sustituye al formulario grande: el QUÉ es el ejercicio ya vive en el
 * catálogo (nombre, zona, cómo se hace), así que aquí solo queda lo que es de
 * esta sesión: el objetivo (series × repes), el peso esperado, el descanso, la
 * superserie y quitarlo del día.
 */
export default function DetalleEjercicio({
  ejercicio,
  dia,
  onClose,
  onCambio,
}: {
  ejercicio: Ejercicio;
  dia: DiaRutina;
  onClose: () => void;
  onCambio: () => void;
}) {
  const [series, setSeries] = useState(String(ejercicio.targetSets));
  const [repes, setRepes] = useState(ejercicio.targetReps);
  const [peso, setPeso] = useState(numTxt(ejercicio.targetWeight));
  const [descanso, setDescanso] = useState(ejercicio.restSeconds != null ? String(ejercicio.restSeconds) : '');
  // La barra: con valor, el peso de este ejercicio se apunta por un lado. Es
  // editable porque no todas pesan igual —la de curl pesa menos que la
  // olímpica— y porque el gimnasio de al lado tiene otras.
  const [barra, setBarra] = useState(numTxt(ejercicio.barKg));
  const [explica, setExplica] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [eligiendoSS, setEligiendoSS] = useState(false);
  const [sustituyendo, setSustituyendo] = useState(false);

  // el cómo-se-hace vive en el catálogo; se trae solo si existe
  useEffect(() => {
    if (ejercicio.catalogId) {
      gymApi.fichaCatalogo(ejercicio.catalogId).then((f) => setExplica(f.explain)).catch(() => {});
    }
  }, [ejercicio.catalogId]);

  const companeros = dia.exercises.filter(
    (e) => e.id !== ejercicio.id && ejercicio.supersetId != null && e.supersetId === ejercicio.supersetId,
  );
  const vinculables = dia.exercises.filter((e) => e.id !== ejercicio.id && e.supersetId == null);

  const cambiado =
    Number(series) !== ejercicio.targetSets ||
    repes.trim() !== ejercicio.targetReps ||
    peso.trim() !== numTxt(ejercicio.targetWeight) ||
    barra.trim() !== numTxt(ejercicio.barKg) ||
    descanso.trim() !== (ejercicio.restSeconds != null ? String(ejercicio.restSeconds) : '');

  async function guardar() {
    setGuardando(true);
    try {
      await gymApi.editarEjercicio(ejercicio.id, {
        targetSets: Math.max(1, Number(series) || ejercicio.targetSets),
        targetReps: repes.trim() || ejercicio.targetReps,
        targetWeight: peso.trim() === '' ? null : Number(peso.replace(',', '.')),
        barKg: barra.trim() === '' ? null : Number(barra.replace(',', '.')),
        restSeconds: descanso.trim() === '' ? null : Number(descanso),
      });
      onCambio();
      onClose();
    } finally {
      setGuardando(false);
    }
  }

  return (
    <Modal title={ejercicio.name} onClose={onClose}>
      {listaMusculos(ejercicio.muscles).length > 0 && (
        <p className="muted" style={{ fontSize: 12.5, marginTop: -4 }}>
          {listaMusculos(ejercicio.muscles).map(nombreMusculo).join(' · ')}
        </p>
      )}
      {explica && <p style={{ fontSize: 13, lineHeight: 1.6 }}>{explica}</p>}

      <div className="de-campos">
        <label>
          <span>Series</span>
          <input inputMode="numeric" value={series} onChange={(e) => setSeries(e.target.value)} />
        </label>
        <label>
          <span>Repes</span>
          <input value={repes} onChange={(e) => setRepes(e.target.value)} placeholder="8-10, al fallo…" />
        </label>
        <label>
          <span>{laBarra(barra) !== null ? 'Peso por lado' : 'Peso (kg)'}</span>
          <input inputMode="decimal" value={peso} onChange={(e) => setPeso(e.target.value)} placeholder="tú decides" />
        </label>
        <label>
          <span>Descanso (s)</span>
          <input inputMode="numeric" value={descanso} onChange={(e) => setDescanso(e.target.value)} placeholder="auto" />
        </label>
        <label>
          <span>Barra (kg)</span>
          <input inputMode="decimal" value={barra} onChange={(e) => setBarra(e.target.value)} placeholder="sin barra" />
        </label>
      </div>
      <p className="muted" style={{ fontSize: 12.5, margin: '10px 0 0' }}>
        {laBarra(barra) !== null
          ? peso.trim() !== ''
            ? `Con barra, el peso se apunta de UN lado: ${numTxt(peso)} × 2 + ${numTxt(barra)} de barra = ${numTxt(pesoReal(peso.replace(',', '.'), barra.replace(',', '.')))} kg.`
            : 'Con barra, el peso se apunta de un lado y el portal suma el otro más la barra.'
          : 'Pon los kilos de la barra si este ejercicio se carga por los dos extremos: entonces el peso se apunta de un lado.'}
      </p>

      {/* la superserie: dos ejercicios independientes que se hacen alternados */}
      <h3 className="cat-h3">Superserie</h3>
      {companeros.length > 0 ? (
        <div className="de-ss">
          <p style={{ fontSize: 13, margin: '6px 0 8px' }}>
            Con <b>{companeros.map((c) => c.name).join(' + ')}</b>: se hacen alternados, serie a serie.
          </p>
          <button
            className="btn ghost sm"
            onClick={async () => {
              await gymApi.superserie(ejercicio.id, null);
              onCambio();
              onClose();
            }}
          >
            Deshacer la superserie
          </button>
        </div>
      ) : (
        <div className="de-ss">
          <p className="muted" style={{ fontSize: 12.5, margin: '4px 0 8px' }}>
            Vincúlalo con otro ejercicio y en el entrenamiento se alternarán: uno de este, uno del otro.
          </p>
          {vinculables.length > 0 && (
            <select
              defaultValue=""
              onChange={async (e) => {
                if (!e.target.value) return;
                await gymApi.superserie(ejercicio.id, Number(e.target.value));
                onCambio();
                onClose();
              }}
              aria-label="Vincular en superserie con"
              style={{ maxWidth: '100%' }}
            >
              <option value="">Vincular con uno de esta sesión…</option>
              {vinculables.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
            </select>
          )}
          <button className="login-link" style={{ display: 'block', marginTop: 8 }} onClick={() => setEligiendoSS(true)}>
            O con uno nuevo de la lista de ejercicios
          </button>
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, marginTop: 20, flexWrap: 'wrap' }}>
        <button className="btn sm" disabled={!cambiado || guardando} onClick={guardar}>
          {guardando ? 'Guardando…' : 'Guardar'}
        </button>
        <button className="btn ghost sm" onClick={() => setSustituyendo(true)}>
          Sustituir por otro
        </button>
        <button
          className="btn danger sm"
          onClick={async () => {
            if (!confirm(`¿Quitar «${ejercicio.name}» de ${dia.name}? Lo que ya entrenaste se queda en el histórico.`)) return;
            await gymApi.borrarEjercicio(ejercicio.id);
            onCambio();
            onClose();
          }}
        >
          Quitar de la sesión
        </button>
      </div>

      {sustituyendo && (
        <ElegirEjercicio
          titulo={`Sustituir ${ejercicio.name} por…`}
          bloques={bloquesDe(dia)}
          onClose={() => setSustituyendo(false)}
          onPick={async (e) => {
            // el nuevo hereda el sitio y la superserie; el histórico del viejo no se toca
            await gymApi.sustituir(ejercicio.id, { catalogId: e.catalogId, name: e.name });
            onCambio();
            onClose();
          }}
        />
      )}

      {eligiendoSS && (
        <ElegirEjercicio
          titulo="Superserie con…"
          bloques={bloquesDe(dia)}
          onClose={() => setEligiendoSS(false)}
          onPick={async (e) => {
            // entra en la sesión y queda vinculado del tirón
            const nuevo = await gymApi.crearEjercicio({ dayId: dia.id, catalogId: e.catalogId, name: e.name });
            await gymApi.superserie(ejercicio.id, nuevo.id);
            onCambio();
            onClose();
          }}
        />
      )}
    </Modal>
  );
}
