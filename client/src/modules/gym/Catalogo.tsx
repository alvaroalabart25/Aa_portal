import { useCallback, useEffect, useMemo, useState } from 'react';
import Modal from '../../components/Modal';
import { usePerfil } from '../../lib/perfil';
import { gymApi, kg, MUSCULOS, nombreMusculo, type CatalogoItem, type FichaCatalogo, type Parte } from './api';

/**
 * El catálogo de ejercicios.
 *
 * La lista común es el vocabulario: existe para que añadir un ejercicio sea
 * elegirlo, no rellenar un formulario, y para que dos cuentas hablen del mismo
 * ejercicio. Lo que cada uno crea es solo suyo, y los números que se ven al
 * lado (PR, última vez) son SIEMPRE los tuyos.
 */

/** El bloque muscular de un ejercicio sale de su primera parte. */
function bloqueDe(item: { parts: string }, partes: Parte[]): string {
  const primera = item.parts.split(',')[0]?.trim();
  return partes.find((p) => p.id === primera)?.muscle ?? 'otros';
}

function fmtHace(iso: string | null): string {
  if (!iso) return '';
  const dias = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  if (dias <= 0) return 'hoy';
  if (dias === 1) return 'ayer';
  if (dias < 60) return `hace ${dias} días`;
  return `hace ${Math.round(dias / 30)} meses`;
}

/** El chivato gris del listado: tu PR y cuándo fue la última vez. */
function Chivato({ e }: { e: CatalogoItem }) {
  if (!e.sets) return null;
  return (
    <span className="cat-chivato">
      {e.pr ? `PR ${kg(e.pr)}` : `${e.sets} series`}
      {e.lastDone ? ` · ${fmtHace(e.lastDone)}` : ''}
    </span>
  );
}

// ---------------------------------------------------------------- la pestaña

export function CatalogoTab() {
  const [lista, setLista] = useState<CatalogoItem[]>([]);
  const [partes, setPartes] = useState<Parte[]>([]);
  const [filtro, setFiltro] = useState('');
  const [abierto, setAbierto] = useState<number | null>(null);

  const cargar = useCallback(async () => setLista(await gymApi.catalogo()), []);
  useEffect(() => {
    void cargar();
    gymApi.partes().then(setPartes).catch(() => {});
  }, [cargar]);

  const grupos = useMemo(() => {
    const q = filtro.trim().toLowerCase();
    const visibles = q ? lista.filter((e) => e.name.toLowerCase().includes(q)) : lista;
    const porBloque = new Map<string, CatalogoItem[]>();
    for (const e of visibles) {
      const b = bloqueDe(e, partes);
      if (!porBloque.has(b)) porBloque.set(b, []);
      porBloque.get(b)!.push(e);
    }
    // en el orden de los bloques del portal (pecho arriba, gemelo abajo)
    const orden = (b: string) => { const i = MUSCULOS.findIndex((m) => m.id === b); return i === -1 ? 99 : i; };
    return [...porBloque.entries()].sort((a, b) => orden(a[0]) - orden(b[0]));
  }, [lista, partes, filtro]);

  return (
    <div>
      <section className="section">
        <div className="mc-head">
          <h2>Ejercicios</h2>
          <span className="muted" style={{ fontSize: 12.5 }}>
            {lista.length} en tu lista
          </span>
        </div>
        <p className="muted cp-nota">
          Los de la lista común los ve todo el mundo; los que crees tú, solo tú. El PR y el historial son siempre los
          tuyos.
        </p>
        <input
          value={filtro}
          onChange={(e) => setFiltro(e.target.value)}
          placeholder="Buscar ejercicio…"
          style={{ width: '100%', marginTop: 12 }}
          aria-label="Buscar en el catálogo"
        />
      </section>

      {grupos.map(([bloque, items]) => (
        <section key={bloque} className="section cat-bloque">
          <h2 className="cat-bloque-t">{nombreMusculo(bloque)}</h2>
          <div className="cat-lista">
            {items.map((e) => (
              <button key={e.id} className="cat-fila" onClick={() => setAbierto(e.id)}>
                <span className="cat-fila-nombre">
                  {e.name}
                  {e.mine && <span className="us-tag suave">tuyo</span>}
                  {e.inRoutine && <span className="cat-en-rutina">en rutina</span>}
                  {e.hasNote && <span className="cat-nota-punto" title="Tienes una nota">✎</span>}
                </span>
                <Chivato e={e} />
              </button>
            ))}
          </div>
        </section>
      ))}

      {abierto != null && <FichaModal id={abierto} onClose={() => setAbierto(null)} onCambio={cargar} />}
    </div>
  );
}

// ---------------------------------------------------------------- la ficha

function FichaModal({ id, onClose, onCambio }: { id: number; onClose: () => void; onCambio: () => void }) {
  const { perfil } = usePerfil();
  const [ficha, setFicha] = useState<FichaCatalogo | null>(null);
  const [nota, setNota] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [editandoExpl, setEditandoExpl] = useState(false);
  const [expl, setExpl] = useState('');

  useEffect(() => {
    gymApi.fichaCatalogo(id).then((f) => {
      setFicha(f);
      setNota(f.note ?? '');
      setExpl(f.explain ?? '');
    });
  }, [id]);

  if (!ficha) return null;
  const puedeExplicar = ficha.mine || perfil?.role === 'admin';

  return (
    <Modal title={ficha.name} onClose={onClose}>
      <p className="muted" style={{ fontSize: 12.5, marginTop: -4 }}>
        {ficha.parts
          .split(',')
          .filter(Boolean)
          .map((p) => p.replace(/_/g, ' '))
          .join(' · ')}
      </p>

      {(ficha.explain || editandoExpl) &&
        (editandoExpl ? (
          <div style={{ marginTop: 10 }}>
            <textarea value={expl} onChange={(e) => setExpl(e.target.value)} rows={3} style={{ width: '100%' }} />
            <button
              className="btn sm"
              style={{ marginTop: 8 }}
              onClick={async () => {
                await gymApi.explicarEjercicio(id, expl.trim() || null);
                setFicha({ ...ficha, explain: expl.trim() || null });
                setEditandoExpl(false);
              }}
            >
              Guardar explicación
            </button>
          </div>
        ) : (
          <p style={{ fontSize: 13.5, lineHeight: 1.6 }}>{ficha.explain}</p>
        ))}
      {puedeExplicar && !editandoExpl && (
        <button className="login-link" onClick={() => setEditandoExpl(true)}>
          {ficha.explain ? 'Editar la explicación' : 'Añadir una explicación (la ve todo el mundo)'}
        </button>
      )}

      <h3 className="cat-h3">Tu nota</h3>
      <p className="muted" style={{ fontSize: 12, marginTop: 2 }}>
        Solo tuya, y sobrevive a la rutina: «lo dejé por el hombro» seguirá aquí cuando vuelvas.
      </p>
      <textarea
        value={nota}
        onChange={(e) => setNota(e.target.value)}
        rows={3}
        placeholder="Por qué lo haces, por qué lo dejaste, qué te funciona…"
        style={{ width: '100%', marginTop: 8 }}
      />
      {nota.trim() !== (ficha.note ?? '').trim() && (
        <button
          className="btn sm"
          style={{ marginTop: 8 }}
          disabled={guardando}
          onClick={async () => {
            setGuardando(true);
            try {
              await gymApi.notaDeEjercicio(id, nota);
              setFicha({ ...ficha, note: nota.trim() || null });
              onCambio();
            } finally {
              setGuardando(false);
            }
          }}
        >
          {guardando ? 'Guardando…' : 'Guardar la nota'}
        </button>
      )}

      <h3 className="cat-h3">Tu historial</h3>
      {ficha.history.length === 0 ? (
        <p className="muted" style={{ fontSize: 13 }}>Todavía no lo has entrenado.</p>
      ) : (
        <div className="cat-hist">
          {ficha.history.map((h) => (
            <div key={h.fecha} className="cat-hist-fila">
              <span>{new Date(`${h.fecha}T12:00:00`).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: '2-digit' })}</span>
              <span className="muted">
                {h.sets} {h.sets === 1 ? 'serie' : 'series'}
                {h.mejorPeso != null ? ` · mejor ${kg(String(h.mejorPeso))}${h.mejorReps ? ` × ${h.mejorReps}` : ''}` : ''}
                {h.mejorSegs != null ? ` · ${h.mejorSegs}s` : ''}
              </span>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}

// ---------------------------------------------------------------- el selector

/**
 * Elegir un ejercicio de la lista: el camino normal para añadir.
 *
 * El crear a mano sigue existiendo, pero al final y en pequeño: es la salida
 * rara. Si escribes algo que no existe, la propia búsqueda te ofrece crearlo.
 */
export function ElegirEjercicio({
  titulo,
  onPick,
  onClose,
  bloques,
}: {
  titulo: string;
  onPick: (e: { catalogId: number; name: string }) => Promise<void> | void;
  onClose: () => void;
  /** Los bloques musculares de la sesión: el listado se abre filtrado por
   *  ellos. Se DERIVAN de los ejercicios que ya hay, no se rellenan a mano. */
  bloques?: string[];
}) {
  const [lista, setLista] = useState<CatalogoItem[]>([]);
  const [partes, setPartes] = useState<Parte[]>([]);
  const [filtro, setFiltro] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [verTodos, setVerTodos] = useState(!bloques || bloques.length === 0);

  useEffect(() => {
    gymApi.catalogo().then(setLista).catch(() => {});
    gymApi.partes().then(setPartes).catch(() => {});
  }, []);

  const q = filtro.trim().toLowerCase();
  // Buscar por texto salta el filtro de bloques: si escribes «face pull» en un
  // día de pierna es porque lo quieres de verdad.
  const visibles = q ? lista.filter((e) => e.name.toLowerCase().includes(q)) : lista;
  const grupos = useMemo(() => {
    const m = new Map<string, CatalogoItem[]>();
    for (const e of visibles) {
      const b = bloqueDe(e, partes);
      if (!q && !verTodos && bloques?.length && !bloques.includes(b)) continue;
      if (!m.has(b)) m.set(b, []);
      m.get(b)!.push(e);
    }
    const orden = (x: string) => { const i = MUSCULOS.findIndex((m) => m.id === x); return i === -1 ? 99 : i; };
    const todos = [...m.entries()].sort((a, b) => orden(a[0]) - orden(b[0]));
    // los bloques de la sesión, delante
    if (bloques?.length) todos.sort((a, b) => (bloques.includes(b[0]) ? 1 : 0) - (bloques.includes(a[0]) ? 1 : 0));
    return todos;
  }, [visibles, partes, q, verTodos, bloques]);

  const sinResultado = q.length >= 3 && visibles.length === 0;

  async function elegir(e: CatalogoItem) {
    if (ocupado) return;
    setOcupado(true);
    try {
      await onPick({ catalogId: e.id, name: e.name });
      onClose();
    } finally {
      setOcupado(false);
    }
  }

  async function crearManual() {
    if (ocupado || q.length < 3) return;
    setOcupado(true);
    try {
      const creado = await gymApi.crearEnCatalogo({ name: filtro.trim() });
      await onPick({ catalogId: creado.id, name: creado.name });
      onClose();
    } finally {
      setOcupado(false);
    }
  }

  return (
    <Modal title={titulo} onClose={onClose}>
      <input
        autoFocus
        value={filtro}
        onChange={(e) => setFiltro(e.target.value)}
        placeholder="Buscar…"
        style={{ width: '100%' }}
        aria-label="Buscar ejercicio"
      />
      <div className="cat-picker">
        {grupos.map(([bloque, items]) => (
          <div key={bloque}>
            <span className="cat-picker-bloque">{nombreMusculo(bloque)}</span>
            {items.map((e) => (
              <button key={e.id} className="cat-fila" disabled={ocupado} onClick={() => elegir(e)}>
                <span className="cat-fila-nombre">
                  {e.name}
                  {e.mine && <span className="us-tag suave">tuyo</span>}
                </span>
                <Chivato e={e} />
              </button>
            ))}
          </div>
        ))}
        {sinResultado && (
          <p className="muted" style={{ fontSize: 13, padding: '10px 0' }}>
            No hay nada con ese nombre.
          </p>
        )}
      </div>
      {!q && !verTodos && bloques != null && bloques.length > 0 && (
        <button className="login-link" onClick={() => setVerTodos(true)}>
          Filtrado por lo que trabaja esta sesión · ver todos los bloques
        </button>
      )}
      {/* el caso raro: crearlo tal cual lo has escrito, como ejercicio TUYO */}
      {q.length >= 3 && (
        <button className="cat-crear" disabled={ocupado} onClick={crearManual}>
          + Crear «{filtro.trim()}» (solo lo verás tú)
        </button>
      )}
    </Modal>
  );
}
