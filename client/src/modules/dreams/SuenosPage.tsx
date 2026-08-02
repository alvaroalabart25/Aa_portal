import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import Modal from '../../components/Modal';
import { dreamsApi, imgUrl } from './api';
import { useArrastre } from './reorder';
import type { Categoria, Deseo, DreamCard, DreamKind, Plantilla } from './types';

type Tab = 'macro' | 'micro' | 'deseos';
type Orden = 'prioridad' | 'fecha' | 'categoria';

const euros = (v: string | null) =>
  v == null ? null : `${Number(v).toLocaleString('es-ES', { minimumFractionDigits: 0, maximumFractionDigits: 2 })} €`;

function fechaCorta(iso: string): string {
  return new Date(`${iso}T12:00:00`).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' });
}

/**
 * Sueños: tres tableros que comparten categorías.
 *  - Macro: sueños de vida.
 *  - Micro: concretos; pueden colgar de un macro o ir sueltos.
 *  - Lista de deseos: cosas que solo te separa el dinero.
 *
 * La pestaña viaja en la URL (?tab=) para poder enlazar directamente a una.
 */
export default function SuenosPage() {
  const [params, setParams] = useSearchParams();
  const pedida = params.get('tab');
  const tab: Tab = pedida === 'macro' || pedida === 'deseos' ? pedida : 'micro';

  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [gestionando, setGestionando] = useState(false);
  const [creando, setCreando] = useState(false);

  const cargarCategorias = useCallback(async () => setCategorias(await dreamsApi.categorias()), []);
  useEffect(() => {
    cargarCategorias();
  }, [cargarCategorias]);

  // La pestaña viaja siempre en la URL, incluso la de por defecto: así el menú
  // lateral sabe cuál marcar y el enlace se puede compartir tal cual.
  function ir(t: Tab) {
    setParams({ tab: t }, { replace: true });
  }

  return (
    <div>
      <div className="page-head">
        <h1>Sueños</h1>
        {/* En móvil estas pestañas se esconden: para eso está el menú de abajo,
            que ya lleva los tres subapartados */}
        <div className="seg dr-tabs" role="tablist">
          {(
            [
              ['macro', 'Macro'],
              ['micro', 'Micro'],
              ['deseos', 'Lista de deseos'],
            ] as [Tab, string][]
          ).map(([v, label]) => (
            <button
              key={v}
              role="tab"
              aria-selected={tab === v}
              className={tab === v ? 'active' : ''}
              onClick={() => ir(v)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {tab === 'deseos' ? (
        <ListaDeseos categorias={categorias} onGestionar={() => setGestionando(true)} />
      ) : (
        <Tablero
          kind={tab}
          categorias={categorias}
          onGestionar={() => setGestionando(true)}
          onCrear={() => setCreando(true)}
          creando={creando}
          onCerrarCreacion={() => setCreando(false)}
        />
      )}

      {gestionando && (
        <CategoriasModal
          categorias={categorias}
          onClose={() => setGestionando(false)}
          onCambio={cargarCategorias}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------- tablero

function Tablero({
  kind,
  categorias,
  onGestionar,
  onCrear,
  creando,
  onCerrarCreacion,
}: {
  kind: DreamKind;
  categorias: Categoria[];
  onGestionar: () => void;
  onCrear: () => void;
  creando: boolean;
  onCerrarCreacion: () => void;
}) {
  const [cards, setCards] = useState<DreamCard[]>([]);
  const [orden, setOrden] = useState<Orden>('prioridad');
  const [cargando, setCargando] = useState(true);

  const cargar = useCallback(async () => {
    setCards(await dreamsApi.lista(kind));
    setCargando(false);
  }, [kind]);
  useEffect(() => {
    setCargando(true);
    cargar();
  }, [cargar]);

  // Los cumplidos se quedan a la vista, en su propia sección al final: se ven
  // siempre, pero no tapan lo que aún persigues.
  const vivos = useMemo(() => cards.filter((c) => c.status !== 'cumplido' && c.status !== 'aparcado'), [cards]);
  const cumplidos = useMemo(() => cards.filter((c) => c.status === 'cumplido'), [cards]);
  const aparcados = useMemo(() => cards.filter((c) => c.status === 'aparcado'), [cards]);
  const [verAparcados, setVerAparcados] = useState(false);

  const ordenados = useMemo(() => {
    if (orden === 'fecha') {
      // sin fecha al final: un sueño sin plazo no es más urgente que uno con él
      return vivos.slice().sort((a, b) => {
        if (!a.targetDate && !b.targetDate) return a.sortOrder - b.sortOrder;
        if (!a.targetDate) return 1;
        if (!b.targetDate) return -1;
        return a.targetDate.localeCompare(b.targetDate);
      });
    }
    return vivos;
  }, [vivos, orden]);

  // Arrastrar solo tiene sentido cuando lo que se ve ES la prioridad
  const arrastrable = orden === 'prioridad';
  const arrastre = useArrastre(
    vivos,
    (l) => setCards([...l, ...cumplidos, ...aparcados]),
    (ids) => dreamsApi.reordenar(ids),
  );

  const porCategoria = useMemo(() => {
    const grupos = new Map<number | null, DreamCard[]>();
    for (const c of ordenados) {
      const k = c.categoryId ?? null;
      if (!grupos.has(k)) grupos.set(k, []);
      grupos.get(k)!.push(c);
    }
    return grupos;
  }, [ordenados]);

  const catPorId = useMemo(() => new Map(categorias.map((c) => [c.id, c])), [categorias]);

  return (
    <>
      <div className="dr-toolbar">
        <label className="dr-orden">
          <span className="dr-orden-et">Ordenar por</span>
          <select value={orden} onChange={(e) => setOrden(e.target.value as Orden)}>
            <option value="prioridad">Prioridad</option>
            <option value="fecha">Fecha objetivo</option>
            <option value="categoria">Categoría</option>
          </select>
        </label>
        <button className="btn ghost sm" onClick={onGestionar}>
          Categorías
        </button>
        {/* al otro extremo de la fila */}
        {/* en móvil se queda en «+ Nuevo»: la etiqueta larga no cabe en la fila */}
        <button className="btn dr-nuevo" onClick={onCrear}>
          + Nuevo<span className="dr-nuevo-largo"> {kind === 'macro' ? 'macrosueño' : 'microsueño'}</span>
        </button>
      </div>

      {cargando ? (
        <p className="empty">Cargando…</p>
      ) : cards.length === 0 ? (
        <p className="empty">
          Todavía no hay {kind === 'macro' ? 'macrosueños' : 'microsueños'}. Empieza por uno, aunque no sepas
          cuándo.
        </p>
      ) : (
        <>
          {orden === 'categoria' ? (
            [...porCategoria.entries()]
              .sort((a, b) => (catPorId.get(a[0] ?? -1)?.sortOrder ?? 9e9) - (catPorId.get(b[0] ?? -1)?.sortOrder ?? 9e9))
              .map(([catId, lista]) => (
                <section key={catId ?? 'sin'} className="dr-group">
                  <h2 className="dr-group-title">
                    {catId != null && (
                      <span className="dot" style={{ background: catPorId.get(catId)?.color ?? 'var(--line)' }} />
                    )}
                    {catId != null ? (catPorId.get(catId)?.name ?? 'Categoría') : 'Sin categoría'}
                    <span className="muted dr-group-n">{lista.length}</span>
                  </h2>
                  <Rejilla cards={lista} categorias={catPorId} arrastrable={false} arrastre={arrastre} />
                </section>
              ))
          ) : (
            <Rejilla cards={ordenados} categorias={catPorId} arrastrable={arrastrable} arrastre={arrastre} />
          )}

          {cumplidos.length > 0 && (
            <section className="dr-group">
              <h2 className="dr-group-title">
                ✅ Cumplidos <span className="muted dr-group-n">{cumplidos.length}</span>
              </h2>
              <Rejilla cards={cumplidos} categorias={catPorId} arrastrable={false} arrastre={arrastre} />
            </section>
          )}

          {aparcados.length > 0 && (
            <section className="dr-group">
              <button className="dr-group-toggle" onClick={() => setVerAparcados((v) => !v)}>
                {verAparcados ? '▾' : '▸'} Aparcados <span className="muted dr-group-n">{aparcados.length}</span>
              </button>
              {verAparcados && (
                <Rejilla cards={aparcados} categorias={catPorId} arrastrable={false} arrastre={arrastre} />
              )}
            </section>
          )}
        </>
      )}

      {creando && (
        <NuevoSuenoModal
          kind={kind}
          categorias={categorias}
          onClose={onCerrarCreacion}
          onCreado={() => {
            onCerrarCreacion();
            cargar();
          }}
        />
      )}
    </>
  );
}

function Rejilla({
  cards,
  categorias,
  arrastrable,
  arrastre,
}: {
  cards: DreamCard[];
  categorias: Map<number, Categoria>;
  arrastrable: boolean;
  arrastre: ReturnType<typeof useArrastre>;
}) {
  return (
    <div className="dr-grid">
      {cards.map((c) => {
        const cat = c.categoryId != null ? categorias.get(c.categoryId) : undefined;
        return (
          <article
            key={c.id}
            data-rid={c.id}
            className={`dr-card${c.status === 'cumplido' ? ' cumplido' : ''}${arrastre.activo === c.id ? ' arrastrando' : ''}`}
          >
            {arrastrable && (
              <button
                className="dr-grip"
                aria-label="Cambiar prioridad arrastrando"
                onPointerDown={(e) => arrastre.onPointerDown(e, c.id)}
                onPointerMove={arrastre.onPointerMove}
                onPointerUp={arrastre.onPointerUp}
                onPointerCancel={arrastre.onPointerUp}
              >
                ⠿
              </button>
            )}
            <Link to={`/suenos/${c.id}`} className="dr-card-link">
              <div className="dr-cover">
                {c.coverUrl ? (
                  <img src={imgUrl(c.coverUrl)} alt="" loading="lazy" />
                ) : (
                  <span className="dr-cover-empty">☁︎</span>
                )}
                {c.status === 'cumplido' && <span className="dr-flag">✓ Cumplido</span>}
              </div>
              <div className="dr-body">
                {cat && (
                  <span className="dr-cat">
                    <span className="dot" style={{ background: cat.color }} />
                    {cat.name}
                  </span>
                )}
                <h3 className="dr-title">{c.title}</h3>
                <div className="dr-meta">
                  {c.status === 'cumplido' && c.achievedAt ? (
                    <span>Conseguido el {fechaCorta(c.achievedAt)}</span>
                  ) : c.targetDate ? (
                    <span>Para {fechaCorta(c.targetDate)}</span>
                  ) : (
                    <span className="muted">Sin fecha</span>
                  )}
                  {c.steps.total > 0 && (
                    <span>
                      · {c.steps.done}/{c.steps.total} pasos
                    </span>
                  )}
                  {c.micros && c.micros.total > 0 && (
                    <span>
                      · {c.micros.done}/{c.micros.total} micros
                    </span>
                  )}
                </div>
                {c.parentTitle && <div className="dr-parent">↳ {c.parentTitle}</div>}
                {c.costEstimated && (
                  <div className="dr-cost">
                    {euros(c.costSaved ?? '0')} de {euros(c.costEstimated)}
                    <span className="dr-bar">
                      <span
                        className="dr-bar-fill"
                        style={{
                          width: `${Math.min(100, (Number(c.costSaved ?? 0) / Math.max(1, Number(c.costEstimated))) * 100)}%`,
                        }}
                      />
                    </span>
                  </div>
                )}
              </div>
            </Link>
          </article>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------- deseos

function ListaDeseos({ categorias, onGestionar }: { categorias: Categoria[]; onGestionar: () => void }) {
  const [pendientes, setPendientes] = useState<Deseo[]>([]);
  const [comprados, setComprados] = useState<Deseo[]>([]);
  const [total, setTotal] = useState('0');
  const [verComprados, setVerComprados] = useState(false);
  const [creando, setCreando] = useState(false);

  const cargar = useCallback(async () => {
    const r = await dreamsApi.deseos();
    setPendientes(r.pending);
    setComprados(r.bought);
    setTotal(r.total);
  }, []);
  useEffect(() => {
    cargar();
  }, [cargar]);

  const arrastre = useArrastre(pendientes, setPendientes, (ids) => dreamsApi.reordenarDeseos(ids));
  const catPorId = useMemo(() => new Map(categorias.map((c) => [c.id, c])), [categorias]);

  async function convertir(d: Deseo) {
    if (!confirm(`¿Convertir «${d.title}» en microsueño? Se irá de esta lista y podrás desarrollarlo.`)) return;
    await dreamsApi.deseoASueno(d.id);
    await cargar();
  }

  return (
    <>
      <div className="dr-toolbar">
        <div className="dr-total">
          <span className="muted">Pendiente de comprar</span>
          <strong>{euros(total)}</strong>
        </div>
        <button className="btn ghost sm" onClick={onGestionar}>
          Categorías
        </button>
        <button className="btn dr-nuevo" onClick={() => setCreando(true)}>
          + Nuevo<span className="dr-nuevo-largo"> deseo</span>
        </button>
      </div>

      {pendientes.length === 0 ? (
        <p className="empty">Nada en la lista. Cosas que solo te separa el dinero.</p>
      ) : (
        <div className="dr-wl">
          {pendientes.map((d) => {
            const cat = d.categoryId != null ? catPorId.get(d.categoryId) : undefined;
            return (
              <div key={d.id} data-rid={d.id} className={`dr-wl-row${arrastre.activo === d.id ? ' arrastrando' : ''}`}>
                <button
                  className="dr-grip inline"
                  aria-label="Cambiar el orden arrastrando"
                  onPointerDown={(e) => arrastre.onPointerDown(e, d.id)}
                  onPointerMove={arrastre.onPointerMove}
                  onPointerUp={arrastre.onPointerUp}
                  onPointerCancel={arrastre.onPointerUp}
                >
                  ⠿
                </button>
                <button
                  className="dr-wl-check"
                  aria-label="Marcar como comprado"
                  onClick={async () => {
                    await dreamsApi.comprado(d.id, true);
                    await cargar();
                  }}
                />
                <span className="dr-wl-title">
                  {d.url ? (
                    <a href={d.url} target="_blank" rel="noopener noreferrer">
                      {d.title}
                    </a>
                  ) : (
                    d.title
                  )}
                </span>
                {cat && (
                  <span className="dr-cat">
                    <span className="dot" style={{ background: cat.color }} />
                    {cat.name}
                  </span>
                )}
                <span className="dr-wl-eur">{euros(d.price) ?? '—'}</span>
                <button className="btn ghost sm" onClick={() => convertir(d)} title="Es más que una compra">
                  A sueño
                </button>
                <button
                  className="dr-wl-x"
                  aria-label="Quitar de la lista"
                  onClick={async () => {
                    await dreamsApi.borrarDeseo(d.id);
                    await cargar();
                  }}
                >
                  ✕
                </button>
              </div>
            );
          })}
        </div>
      )}

      {creando && (
        <NuevoDeseoModal
          categorias={categorias}
          onClose={() => setCreando(false)}
          onCreado={() => {
            setCreando(false);
            cargar();
          }}
        />
      )}

      {comprados.length > 0 && (
        <section className="dr-group">
          <button className="dr-group-toggle" onClick={() => setVerComprados((v) => !v)}>
            {verComprados ? '▾' : '▸'} Comprados <span className="muted dr-group-n">{comprados.length}</span>
          </button>
          {verComprados && (
            <div className="dr-wl">
              {comprados.map((d) => (
                <div key={d.id} className="dr-wl-row comprado">
                  <span className="dr-wl-done">✓</span>
                  <span className="dr-wl-title">{d.title}</span>
                  <span className="muted dr-wl-when">{d.boughtAt ? fechaCorta(d.boughtAt) : ''}</span>
                  <span className="dr-wl-eur">{euros(d.price) ?? '—'}</span>
                  <button
                    className="btn ghost sm"
                    onClick={async () => {
                      await dreamsApi.comprado(d.id, false);
                      await cargar();
                    }}
                  >
                    Devolver a la lista
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>
      )}
    </>
  );
}

// ---------------------------------------------------------------- modales

function NuevoDeseoModal({
  categorias,
  onClose,
  onCreado,
}: {
  categorias: Categoria[];
  onClose: () => void;
  onCreado: () => void;
}) {
  const [titulo, setTitulo] = useState('');
  const [precio, setPrecio] = useState('');
  const [enlace, setEnlace] = useState('');
  const [catId, setCatId] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await dreamsApi.crearDeseo({
        title: titulo.trim(),
        price: precio.trim() || null,
        url: enlace.trim() || null,
        categoryId: catId ? Number(catId) : null,
      });
      onCreado();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo añadir');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Nuevo deseo" onClose={onClose}>
      <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div className="field">
          <label htmlFor="nd-t">Qué quieres comprar</label>
          <input id="nd-t" value={titulo} onChange={(e) => setTitulo(e.target.value)} autoFocus />
        </div>
        <div className="field">
          <label htmlFor="nd-p">Precio aproximado (€)</label>
          <input id="nd-p" inputMode="decimal" value={precio} onChange={(e) => setPrecio(e.target.value)} style={{ width: 130 }} />
        </div>
        <div className="field">
          <label htmlFor="nd-u">Enlace (opcional)</label>
          <input id="nd-u" placeholder="https://…" value={enlace} onChange={(e) => setEnlace(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="nd-c">Categoría</label>
          <select id="nd-c" value={catId} onChange={(e) => setCatId(e.target.value)}>
            <option value="">Sin categoría</option>
            {categorias.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        {error && <div className="error-msg">{error}</div>}
        <div className="modal-actions">
          <button type="button" className="btn ghost" onClick={onClose}>
            Cancelar
          </button>
          <button className="btn" disabled={busy || !titulo.trim()}>
            {busy ? 'Añadiendo…' : 'Añadir'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function NuevoSuenoModal({
  kind,
  categorias,
  onClose,
  onCreado,
}: {
  kind: DreamKind;
  categorias: Categoria[];
  onClose: () => void;
  onCreado: () => void;
}) {
  const [titulo, setTitulo] = useState('');
  const [plantilla, setPlantilla] = useState('');
  const [catId, setCatId] = useState('');
  const [parentId, setParentId] = useState('');
  const [plantillas, setPlantillas] = useState<Plantilla[]>([]);
  const [macros, setMacros] = useState<{ id: number; title: string }[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    dreamsApi.plantillas().then(setPlantillas).catch(() => {});
    if (kind === 'micro') {
      dreamsApi
        .lista('macro')
        .then((l) => setMacros(l.map((m) => ({ id: m.id, title: m.title }))))
        .catch(() => {});
    }
  }, [kind]);

  // Elegir plantilla rellena el título si aún está vacío
  function elegirPlantilla(id: string) {
    setPlantilla(id);
    const p = plantillas.find((x) => x.id === id);
    if (p && !titulo.trim()) setTitulo(p.title);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await dreamsApi.crear({
        kind,
        title: titulo.trim(),
        template: plantilla || undefined,
        categoryId: catId ? Number(catId) : null,
        parentId: parentId ? Number(parentId) : null,
      });
      onCreado();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo crear');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={kind === 'macro' ? 'Nuevo macrosueño' : 'Nuevo microsueño'} onClose={onClose}>
      <form onSubmit={submit} className="form-grid" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
        <div className="field">
          <label htmlFor="ns-t">Título</label>
          <input id="ns-t" value={titulo} onChange={(e) => setTitulo(e.target.value)} autoFocus />
        </div>

        <div className="field">
          <label htmlFor="ns-p">Empezar desde una plantilla</label>
          <select id="ns-p" value={plantilla} onChange={(e) => elegirPlantilla(e.target.value)}>
            <option value="">Desde cero</option>
            {plantillas.map((p) => (
              <option key={p.id} value={p.id}>
                {p.emoji} {p.title}
                {p.steps > 0 ? ` · ${p.steps} pasos` : ''}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label htmlFor="ns-c">Categoría</label>
          <select id="ns-c" value={catId} onChange={(e) => setCatId(e.target.value)}>
            <option value="">Sin categoría</option>
            {categorias.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>

        {kind === 'micro' && macros.length > 0 && (
          <div className="field">
            <label htmlFor="ns-m">¿Cuelga de un macrosueño?</label>
            <select id="ns-m" value={parentId} onChange={(e) => setParentId(e.target.value)}>
              <option value="">Va suelto</option>
              {macros.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.title}
                </option>
              ))}
            </select>
          </div>
        )}

        {error && <div className="error-msg">{error}</div>}
        <div className="modal-actions">
          <button type="button" className="btn ghost" onClick={onClose}>
            Cancelar
          </button>
          <button className="btn" disabled={busy || !titulo.trim()}>
            {busy ? 'Creando…' : 'Crear'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

const COLORES = ['#0a0a0a', '#2f9e44', '#1971c2', '#c92a2a', '#e8590c', '#7048e8', '#0c8599', '#a61e4d'];

function CategoriasModal({
  categorias,
  onClose,
  onCambio,
}: {
  categorias: Categoria[];
  onClose: () => void;
  onCambio: () => void;
}) {
  const [nombre, setNombre] = useState('');
  const [color, setColor] = useState(COLORES[0]);

  async function crear(e: FormEvent) {
    e.preventDefault();
    if (!nombre.trim()) return;
    await dreamsApi.crearCategoria(nombre.trim(), color);
    setNombre('');
    onCambio();
  }

  async function borrar(c: Categoria) {
    if (!confirm(`¿Quitar la categoría «${c.name}»? Lo que la usara se queda sin categoría.`)) return;
    await dreamsApi.borrarCategoria(c.id);
    onCambio();
  }

  return (
    <Modal title="Categorías" onClose={onClose}>
      <p className="muted" style={{ fontSize: 13, margin: 0, lineHeight: 1.6 }}>
        Las comparten los macrosueños, los microsueños y la lista de deseos.
      </p>

      <form onSubmit={crear} className="form-grid">
        <input placeholder="Nombre" value={nombre} onChange={(e) => setNombre(e.target.value)} style={{ flex: 1 }} />
        <div className="dr-colores">
          {COLORES.map((c) => (
            <button
              key={c}
              type="button"
              className={`dr-color${color === c ? ' sel' : ''}`}
              style={{ background: c }}
              aria-label={`Color ${c}`}
              onClick={() => setColor(c)}
            />
          ))}
        </div>
        <button className="btn" disabled={!nombre.trim()}>
          Añadir
        </button>
      </form>

      {categorias.length > 0 && (
        <div className="roadmap-list">
          {categorias.map((c) => (
            <div key={c.id} className="roadmap-row" style={{ justifyContent: 'space-between' }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 14 }}>
                <span className="dot" style={{ background: c.color }} />
                {c.name}
              </span>
              <button className="btn ghost sm" onClick={() => borrar(c)}>
                Quitar
              </button>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}
