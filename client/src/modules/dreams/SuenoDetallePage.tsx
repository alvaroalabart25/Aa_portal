import { useCallback, useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { dreamsApi, imgUrl, reducirImagen } from './api';
import { ESTADOS, type Categoria, type DreamDetail, type DreamStatus } from './types';

const euros = (v: string | null) =>
  v == null ? null : `${Number(v).toLocaleString('es-ES', { minimumFractionDigits: 0, maximumFractionDigits: 2 })} €`;

function fechaCorta(iso: string): string {
  return new Date(`${iso}T12:00:00`).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' });
}

/**
 * Detalle de un sueño: aquí se desarrolla. Todo se guarda solo — el título y la
 * descripción al dejar de escribir, el resto al cambiarlo — porque un tablero
 * de sueños se toca a ratos y no apetece ir buscando un botón de guardar.
 */
export default function SuenoDetallePage() {
  const { id } = useParams();
  const dreamId = Number(id);
  const navigate = useNavigate();

  const [d, setD] = useState<DreamDetail | null>(null);
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [error, setError] = useState('');

  const cargar = useCallback(async () => {
    try {
      setD(await dreamsApi.detalle(dreamId));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo cargar');
    }
  }, [dreamId]);

  useEffect(() => {
    cargar();
    dreamsApi.categorias().then(setCategorias).catch(() => {});
  }, [cargar]);

  // Guardado parcial: actualiza la vista al momento y manda solo el cambio
  const guardar = useCallback(
    async (cambios: Parameters<typeof dreamsApi.editar>[1]) => {
      if (!d) return;
      setD({ ...d, ...(cambios as Partial<DreamDetail>) });
      try {
        await dreamsApi.editar(d.id, cambios);
        // el estado «cumplido» pone la fecha en el servidor: hay que releerla
        if (cambios.status) await cargar();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'No se pudo guardar');
        await cargar();
      }
    },
    [d, cargar],
  );

  if (error && !d) return <p className="empty">{error}</p>;
  if (!d) return <p className="empty">Cargando…</p>;

  return (
    <div>
      <div className="crumbs">
        <Link to={`/suenos?tab=${d.kind}`}>{d.kind === 'macro' ? 'Macrosueños' : 'Microsueños'}</Link>
        <span>›</span>
        <span>{d.title}</span>
      </div>

      <TituloEditable valor={d.title} onGuardar={(title) => guardar({ title })} />

      <div className="dr-dt-bar">
        <select
          value={d.status}
          onChange={(e) => guardar({ status: e.target.value as DreamStatus })}
          aria-label="Estado del sueño"
        >
          {ESTADOS.map((e) => (
            <option key={e.value} value={e.value}>
              {e.emoji} {e.label}
            </option>
          ))}
        </select>

        <select
          value={d.categoryId ?? ''}
          onChange={(e) => guardar({ categoryId: e.target.value ? Number(e.target.value) : null })}
          aria-label="Categoría"
        >
          <option value="">Sin categoría</option>
          {categorias.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>

        {d.kind === 'micro' && (
          <select
            value={d.parentId ?? ''}
            onChange={(e) => guardar({ parentId: e.target.value ? Number(e.target.value) : null })}
            aria-label="Macrosueño del que cuelga"
          >
            <option value="">Va suelto</option>
            {d.macros.map((m) => (
              <option key={m.id} value={m.id}>
                ↳ {m.title}
              </option>
            ))}
          </select>
        )}

        <label className="dr-dt-date">
          Para
          <input
            type="date"
            value={d.targetDate ?? ''}
            onChange={(e) => guardar({ targetDate: e.target.value || null })}
          />
        </label>

        {d.status === 'cumplido' && d.achievedAt && (
          <span className="badge dr-dt-done">✓ Conseguido el {fechaCorta(d.achievedAt)}</span>
        )}
      </div>

      {error && <div className="error-msg">{error}</div>}

      <Descripcion valor={d.description ?? ''} onGuardar={(description) => guardar({ description })} />

      <Coste dream={d} onGuardar={guardar} />

      <Galeria dream={d} onCambio={cargar} />

      <Pasos dream={d} onCambio={cargar} />

      <Enlaces dream={d} onCambio={cargar} />

      {d.kind === 'macro' && d.children.length > 0 && (
        <section className="section">
          <h2>Microsueños que cuelgan de aquí</h2>
          <div className="roadmap-list">
            {d.children.map((c) => (
              <Link key={c.id} to={`/suenos/${c.id}`} className="roadmap-row" style={{ justifyContent: 'space-between' }}>
                <span style={{ fontSize: 14 }}>
                  {c.status === 'cumplido' ? '✅ ' : ''}
                  {c.title}
                </span>
                <span className="muted" style={{ fontSize: 12.5 }}>
                  {c.targetDate ? fechaCorta(c.targetDate) : 'sin fecha'}
                </span>
              </Link>
            ))}
          </div>
        </section>
      )}

      <section className="section">
        <h2>Este sueño</h2>
        <div className="dr-dt-actions">
          <button
            className="btn ghost sm"
            onClick={async () => {
              if (!confirm(`¿Mover «${d.title}» a la lista de deseos? Se conserva el título, el precio y el primer enlace.`))
                return;
              await dreamsApi.suenoADeseo(d.id);
              navigate('/suenos?tab=deseos');
            }}
          >
            Mover a la lista de deseos
          </button>
          <button
            className="btn danger sm"
            onClick={async () => {
              if (!confirm(`¿Quitar «${d.title}» del tablero?`)) return;
              await dreamsApi.borrar(d.id);
              navigate(`/suenos?tab=${d.kind}`);
            }}
          >
            Quitar del tablero
          </button>
        </div>
        <p className="muted" style={{ fontSize: 12.5, marginTop: 8 }}>
          Si solo te separa el dinero, es un deseo. Si además hace falta tiempo, aprender algo o cambia cómo vives, es
          un sueño.
        </p>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------- piezas

function TituloEditable({ valor, onGuardar }: { valor: string; onGuardar: (v: string) => void }) {
  const [editando, setEditando] = useState(false);
  const [txt, setTxt] = useState(valor);
  useEffect(() => setTxt(valor), [valor]);

  function cerrar() {
    setEditando(false);
    const limpio = txt.trim();
    if (limpio && limpio !== valor) onGuardar(limpio);
    else setTxt(valor);
  }

  return editando ? (
    <input
      className="title-input"
      value={txt}
      autoFocus
      onChange={(e) => setTxt(e.target.value)}
      onBlur={cerrar}
      onKeyDown={(e) => {
        if (e.key === 'Enter') cerrar();
        if (e.key === 'Escape') {
          setTxt(valor);
          setEditando(false);
        }
      }}
    />
  ) : (
    <h1 className="title-editable" onClick={() => setEditando(true)} title="Pulsa para renombrar">
      {valor}
    </h1>
  );
}

// Autoguardado al dejar de escribir: ni botón ni pérdida de lo escrito
function Descripcion({ valor, onGuardar }: { valor: string; onGuardar: (v: string) => void }) {
  const [txt, setTxt] = useState(valor);
  const [estado, setEstado] = useState<'' | 'guardando' | 'guardado'>('');
  const timer = useRef<number | undefined>(undefined);
  const ultimo = useRef(valor);

  useEffect(() => {
    setTxt(valor);
    ultimo.current = valor;
  }, [valor]);

  function cambiar(v: string) {
    setTxt(v);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      if (v === ultimo.current) return;
      ultimo.current = v;
      setEstado('guardando');
      onGuardar(v);
      setEstado('guardado');
      window.setTimeout(() => setEstado(''), 1500);
    }, 700);
  }

  useEffect(() => () => window.clearTimeout(timer.current), []);

  return (
    <section className="section dr-dt-desc">
      <div className="page-head">
        <h2>Cómo me lo imagino</h2>
        {estado && <span className="muted" style={{ fontSize: 12 }}>{estado === 'guardando' ? 'Guardando…' : 'Guardado'}</span>}
      </div>
      <textarea
        value={txt}
        onChange={(e) => cambiar(e.target.value)}
        rows={6}
        placeholder="Descríbelo como si se lo contaras a alguien. Por qué lo quieres, cómo sería tenerlo."
      />
    </section>
  );
}

// La base guarda decimales ('32000.00'); en la casilla se escribe '32000'
const paraEditar = (v: string | null) => (v == null || v === '' ? '' : String(Number(v)));

function Coste({
  dream,
  onGuardar,
}: {
  dream: DreamDetail;
  onGuardar: (c: { costEstimated?: string | null; costSaved?: string | null }) => void;
}) {
  const [est, setEst] = useState(paraEditar(dream.costEstimated));
  const [ahorrado, setAhorrado] = useState(paraEditar(dream.costSaved));

  useEffect(() => {
    setEst(paraEditar(dream.costEstimated));
    setAhorrado(paraEditar(dream.costSaved));
  }, [dream.costEstimated, dream.costSaved]);

  const total = Number(dream.costEstimated ?? 0);
  const puesto = Number(dream.costSaved ?? 0);
  const pct = total > 0 ? Math.min(100, (puesto / total) * 100) : 0;

  return (
    <section className="section">
      <h2>Cuánto cuesta</h2>
      <div className="form-grid">
        <div className="field">
          <label htmlFor="dr-est">Cuesta</label>
          <input
            id="dr-est"
            inputMode="decimal"
            value={est}
            onChange={(e) => setEst(e.target.value)}
            onBlur={() => onGuardar({ costEstimated: est.trim() || null })}
            style={{ width: 120 }}
          />
        </div>
        <div className="field">
          <label htmlFor="dr-sav">Llevo ahorrado</label>
          <input
            id="dr-sav"
            inputMode="decimal"
            value={ahorrado}
            onChange={(e) => setAhorrado(e.target.value)}
            onBlur={() => onGuardar({ costSaved: ahorrado.trim() || null })}
            style={{ width: 120 }}
          />
        </div>
      </div>
      {total > 0 && (
        <div className="progress" style={{ marginTop: 12 }}>
          <span className="bar">
            <span className="fill" style={{ width: `${pct}%` }} />
          </span>
          <span>
            {euros(String(puesto))} de {euros(String(total))} · falta {euros(String(Math.max(0, total - puesto)))}
          </span>
        </div>
      )}
    </section>
  );
}

function Galeria({ dream, onCambio }: { dream: DreamDetail; onCambio: () => void }) {
  const [subiendo, setSubiendo] = useState(0);
  const [error, setError] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const [grande, setGrande] = useState<string | null>(null);

  async function elegidas(e: ChangeEvent<HTMLInputElement>) {
    const files = [...(e.target.files ?? [])];
    e.target.value = '';
    if (!files.length) return;
    setError('');
    setSubiendo(files.length);
    for (const f of files) {
      try {
        if (!f.type.startsWith('image/')) throw new Error(`«${f.name}» no es una imagen`);
        const reducida = await reducirImagen(f);
        await dreamsApi.subirImagen(dream.id, reducida);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'No se pudo subir');
      } finally {
        setSubiendo((n) => n - 1);
      }
    }
    onCambio();
  }

  return (
    <section className="section">
      <div className="page-head">
        <h2>Imágenes</h2>
        <button className="btn ghost sm" onClick={() => input.current?.click()} disabled={subiendo > 0}>
          {subiendo > 0 ? `Subiendo ${subiendo}…` : '+ Añadir imágenes'}
        </button>
      </div>
      <input ref={input} type="file" accept="image/*" multiple hidden onChange={elegidas} />
      {error && <div className="error-msg">{error}</div>}

      {dream.images.length === 0 ? (
        <p className="muted" style={{ fontSize: 13.5, marginTop: 8 }}>
          La primera imagen que subas será la que se vea en la tarjeta. Se reducen en tu móvil antes de subirse, así
          que no gastan casi nada.
        </p>
      ) : (
        <div className="dr-gal">
          {dream.images.map((img, i) => (
            <figure key={img.id} className="dr-gal-item">
              <button className="dr-gal-img" onClick={() => setGrande(imgUrl(img.fullUrl))} aria-label="Ver grande">
                <img src={imgUrl(img.thumbUrl)} alt="" loading="lazy" />
              </button>
              {i === 0 && <span className="dr-gal-flag">Destacada</span>}
              <div className="dr-gal-acts">
                {i !== 0 && (
                  <button
                    className="btn ghost sm"
                    onClick={async () => {
                      await dreamsApi.destacarImagen(img.id);
                      onCambio();
                    }}
                  >
                    Destacar
                  </button>
                )}
                <button
                  className="btn ghost sm"
                  onClick={async () => {
                    if (!confirm('¿Borrar esta imagen?')) return;
                    await dreamsApi.borrarImagen(img.id);
                    onCambio();
                  }}
                >
                  Borrar
                </button>
              </div>
            </figure>
          ))}
        </div>
      )}

      {grande && (
        <div className="dr-lightbox" onClick={() => setGrande(null)} role="presentation">
          <img src={grande} alt="" />
        </div>
      )}
    </section>
  );
}

function Pasos({ dream, onCambio }: { dream: DreamDetail; onCambio: () => void }) {
  const [nuevo, setNuevo] = useState('');
  const hechos = dream.steps.filter((s) => s.done).length;

  async function añadir(e: FormEvent) {
    e.preventDefault();
    if (!nuevo.trim()) return;
    await dreamsApi.crearPaso(dream.id, nuevo.trim());
    setNuevo('');
    onCambio();
  }

  return (
    <section className="section">
      <div className="page-head">
        <h2>Pasos</h2>
        {dream.steps.length > 0 && (
          <span className="muted" style={{ fontSize: 13 }}>
            {hechos} de {dream.steps.length}
          </span>
        )}
      </div>

      {dream.steps.length > 0 && (
        <div className="dr-steps">
          {dream.steps.map((s) => (
            <div key={s.id} className={`dy-check${s.done ? ' done' : ''}`}>
              <button
                className="dy-check-box as-btn"
                aria-label={s.done ? 'Desmarcar' : 'Marcar como hecho'}
                onClick={async () => {
                  await dreamsApi.editarPaso(s.id, { done: !s.done });
                  onCambio();
                }}
              >
                {s.done ? '✓' : ''}
              </button>
              <span className="dy-check-title">{s.title}</span>
              <button
                className="dy-check-x"
                aria-label="Quitar paso"
                onClick={async () => {
                  await dreamsApi.borrarPaso(s.id);
                  onCambio();
                }}
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}

      <form onSubmit={añadir} className="form-grid">
        <input
          placeholder="Añadir un paso"
          value={nuevo}
          onChange={(e) => setNuevo(e.target.value)}
          style={{ flex: 1, minWidth: 200 }}
        />
        <button className="btn ghost sm" disabled={!nuevo.trim()}>
          Añadir
        </button>
      </form>
    </section>
  );
}

function Enlaces({ dream, onCambio }: { dream: DreamDetail; onCambio: () => void }) {
  const [label, setLabel] = useState('');
  const [url, setUrl] = useState('');
  const [nota, setNota] = useState('');
  const [error, setError] = useState('');

  async function añadir(e: FormEvent) {
    e.preventDefault();
    setError('');
    if (!label.trim() || !url.trim()) return;
    try {
      await dreamsApi.crearEnlace(dream.id, { label: label.trim(), url: url.trim(), note: nota.trim() || undefined });
      setLabel('');
      setUrl('');
      setNota('');
      onCambio();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo guardar');
    }
  }

  return (
    <section className="section">
      <h2>Enlaces y notas</h2>

      {dream.links.length > 0 && (
        <div className="roadmap-list">
          {dream.links.map((l) => (
            <div key={l.id} className="roadmap-row" style={{ justifyContent: 'space-between' }}>
              <span style={{ minWidth: 0, fontSize: 14 }}>
                {/* rel noopener: un enlace externo no debe poder tocar esta pestaña */}
                <a href={l.url} target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'underline' }}>
                  {l.label}
                </a>
                {l.note && <span className="muted" style={{ marginLeft: 8, fontSize: 12.5 }}>{l.note}</span>}
              </span>
              <button
                className="btn ghost sm"
                onClick={async () => {
                  await dreamsApi.borrarEnlace(l.id);
                  onCambio();
                }}
              >
                Quitar
              </button>
            </div>
          ))}
        </div>
      )}

      <form onSubmit={añadir} className="form-grid">
        <input placeholder="Nombre" value={label} onChange={(e) => setLabel(e.target.value)} style={{ width: 150 }} />
        <input
          placeholder="https://…"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          style={{ flex: 1, minWidth: 180 }}
        />
        <input placeholder="Nota (opcional)" value={nota} onChange={(e) => setNota(e.target.value)} style={{ width: 170 }} />
        <button className="btn ghost sm" disabled={!label.trim() || !url.trim()}>
          Añadir
        </button>
      </form>
      {error && <div className="error-msg">{error}</div>}
    </section>
  );
}
