import { useEffect, useState } from 'react';
import { del, get, post, patch } from '../lib/api';
import { usePerfil } from '../lib/perfil';
import { MODULOS_ACTIVABLES } from '../shell/modules';

interface Usuario {
  id: number;
  username: string;
  displayName: string | null;
  role: 'admin' | 'user';
  modules: string[];
  lastSeenAt: string | null;
  disabledAt: string | null;
  createdAt: string;
  totpEnabled: boolean;
  filas: number;
  detalle: Record<string, number>;
}

interface Invitacion {
  id: number;
  note: string | null;
  modules: string[];
  expiresAt: string;
  usedAt: string | null;
  usuario: string | null;
  createdAt: string;
  estado: 'pendiente' | 'usada' | 'caducada' | 'anulada';
}

/**
 * Quién usa el portal.
 *
 * Lo que se ve aquí es TODO lo que se puede ver: cuándo entró cada cuenta por
 * última vez y cuántas filas ocupa. Nada de lo que escriben dentro. No es una
 * limitación de esta pantalla que se pueda ampliar mañana: el servidor
 * tampoco lo devuelve, y ese es el trato.
 */
export default function UsuariosTab() {
  const { perfil } = usePerfil();
  const [usuarios, setUsuarios] = useState<Usuario[]>([]);
  const [invitaciones, setInvitaciones] = useState<Invitacion[]>([]);
  const [cargando, setCargando] = useState(true);
  const [abierto, setAbierto] = useState<number | null>(null);

  const [creando, setCreando] = useState(false);
  // enlace de recuperación recién creado, por usuario: se enseña una sola vez
  const [rescate, setRescate] = useState<{ userId: number; url: string } | null>(null);
  const [rescatando, setRescatando] = useState(false);
  const [nota, setNota] = useState('');
  const [modulos, setModulos] = useState<string[]>(['agenda', 'org', 'salud']);
  const [enlace, setEnlace] = useState('');
  const [generando, setGenerando] = useState(false);
  const [copiado, setCopiado] = useState(false);
  const [error, setError] = useState('');

  async function cargar() {
    const [u, i] = await Promise.all([get<Usuario[]>('/admin/usuarios'), get<Invitacion[]>('/admin/invitaciones')]);
    setUsuarios(u);
    setInvitaciones(i);
    setCargando(false);
  }

  useEffect(() => {
    void cargar().catch(() => setCargando(false));
  }, []);

  async function crearInvitacion() {
    if (generando) return; // el candado de verdad; `disabled` es solo lo que se ve
    setError('');
    setGenerando(true);
    try {
      const r = await post<{ url: string }>('/admin/invitaciones', { note: nota, modules: modulos });
      // Si la respuesta viniera sin dirección, callarse dejaría la pantalla
      // igual que si no hubieras pulsado. Mejor decirlo.
      if (!r?.url) throw new Error('La invitación se creó pero el servidor no devolvió el enlace');
      setEnlace(r.url);
      setCopiado(false);
      setNota('');
      setCreando(false);
      await cargar();
    } catch (e) {
      setError((e as Error).message || 'No se ha podido crear');
    } finally {
      setGenerando(false);
    }
  }

  async function copiar() {
    try {
      await navigator.clipboard.writeText(enlace);
      setCopiado(true);
    } catch {
      setCopiado(false); // sin permiso de portapapeles: queda el enlace a la vista
    }
  }

  async function cambiarAcceso(u: Usuario) {
    await patch(`/admin/usuarios/${u.id}`, { disabled: !u.disabledAt });
    await cargar();
  }

  if (cargando) return <p className="muted">Cargando…</p>;

  return (
    <>
      <section className="section">
        <div className="mc-head">
          <h2>Personas</h2>
          <button className="btn ghost sm" onClick={() => { setCreando((v) => !v); setEnlace(''); }}>
            {creando ? 'Cancelar' : '+ Invitar'}
          </button>
        </div>

        <p className="us-privacidad">
          De cada cuenta ves <b>cuándo entró</b> y <b>cuánto ocupa</b>. Nada más. Sus tareas, su diario, sus
          entrenamientos y sus facturas no salen de su cuenta: la API no los devuelve ni siendo administrador.
        </p>

        {creando && (
          <div className="us-crear">
            <label htmlFor="nota">¿Para quién es?</label>
            <input
              id="nota"
              value={nota}
              onChange={(e) => setNota(e.target.value)}
              placeholder="Una nota tuya para reconocerla (no la ve quien entra)"
              style={{ width: '100%' }}
            />
            <p className="inv-pista" style={{ marginTop: 10 }}>Con qué módulos entra. Podrá cambiarlos.</p>
            <div className="us-chips">
              {MODULOS_ACTIVABLES.map((m) => {
                const on = modulos.includes(m.id);
                return (
                  <button
                    key={m.id}
                    type="button"
                    className={`us-chip${on ? ' on' : ''}`}
                    aria-pressed={on}
                    onClick={() => setModulos((p) => (on ? p.filter((x) => x !== m.id) : [...p, m.id]))}
                  >
                    {m.title}
                  </button>
                );
              })}
            </div>
            {error && <div className="error-msg" style={{ marginTop: 10 }}>{error}</div>}
            <button
              className="btn sm"
              style={{ marginTop: 12 }}
              disabled={!modulos.length || generando}
              onClick={crearInvitacion}
            >
              {generando ? 'Creando el enlace…' : 'Crear el enlace'}
            </button>
          </div>
        )}

        {enlace && (
          <div className="us-enlace">
            <p>
              <b>Pásale este enlace.</b> Caduca en 7 días y sirve una sola vez.
              {' '}Es la llave de la cuenta: no se puede volver a ver desde aquí, así que cópialo ahora.
            </p>
            <code>{enlace}</code>
            <button className="btn sm" onClick={copiar}>{copiado ? 'Copiado ✓' : 'Copiar'}</button>
          </div>
        )}

        <div className="us-lista">
          {usuarios.map((u) => {
            const yo = u.id === perfil?.id;
            return (
              <div key={u.id} className={`us-fila${u.disabledAt ? ' off' : ''}`}>
                <button className="us-cab" onClick={() => setAbierto(abierto === u.id ? null : u.id)}>
                  <span className="us-nombre">
                    {u.displayName || u.username}
                    {u.role === 'admin' && <span className="us-tag">admin</span>}
                    {yo && <span className="us-tag suave">tú</span>}
                    {u.disabledAt && <span className="us-tag off">sin acceso</span>}
                  </span>
                  <span className="us-uso">
                    {visto(u.lastSeenAt)} · {u.filas.toLocaleString('es-ES')} filas
                  </span>
                </button>

                {abierto === u.id && (
                  <div className="us-detalle">
                    <p className="us-dato">
                      <span>Usuario</span>
                      <b>{u.username}</b>
                    </p>
                    <p className="us-dato">
                      <span>Se dio de alta</span>
                      <b>{new Date(u.createdAt).toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' })}</b>
                    </p>
                    <p className="us-dato">
                      <span>Segundo factor</span>
                      <b>{u.totpEnabled ? 'activado' : 'sin activar'}</b>
                    </p>
                    <p className="us-dato">
                      <span>Módulos puestos</span>
                      <b>{u.modules.map((id) => MODULOS_ACTIVABLES.find((m) => m.id === id)?.title ?? id).join(', ')}</b>
                    </p>

                    {Object.keys(u.detalle).length > 0 && (
                      <div className="us-filas">
                        {Object.entries(u.detalle).map(([k, v]) => (
                          <span key={k}>
                            {k} <b>{v.toLocaleString('es-ES')}</b>
                          </span>
                        ))}
                      </div>
                    )}

                    {/* La recuperación por correo no funciona (el servidor de
                        correo no es alcanzable desde Render), así que el camino
                        es este: generas su enlace y se lo pasas tú. Un uso,
                        60 min, y no toca nada hasta que la persona lo abre y
                        pone su contraseña nueva. */}
                    {rescate?.userId === u.id ? (
                      <div className="us-enlace" style={{ marginTop: 12 }}>
                        <p>
                          <b>Pásale este enlace para que ponga una contraseña nueva.</b> Caduca en 60 minutos y sirve
                          una vez. Al usarlo se cierran sus sesiones antiguas.
                        </p>
                        <code>{rescate.url}</code>
                        <button
                          className="btn sm"
                          onClick={() => void navigator.clipboard.writeText(rescate.url).catch(() => {})}
                        >
                          Copiar
                        </button>
                      </div>
                    ) : (
                      <button
                        className="btn ghost sm"
                        style={{ marginTop: 12 }}
                        disabled={rescatando}
                        onClick={async () => {
                          setRescatando(true);
                          try {
                            const r = await post<{ url: string }>(`/admin/usuarios/${u.id}/recuperacion`, {});
                            setRescate({ userId: u.id, url: r.url });
                          } finally {
                            setRescatando(false);
                          }
                        }}
                      >
                        {rescatando ? 'Creando…' : 'Enlace de recuperación'}
                      </button>
                    )}

                    {!yo && (
                      <button className="btn ghost sm" style={{ marginTop: 12, marginLeft: 8 }} onClick={() => void cambiarAcceso(u)}>
                        {u.disabledAt ? 'Devolverle el acceso' : 'Quitarle el acceso'}
                      </button>
                    )}
                    {!yo && (
                      <p className="inv-pista" style={{ marginTop: 8 }}>
                        Quitar el acceso cierra la puerta, no borra sus datos.
                      </p>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {invitaciones.length > 0 && (
        <section className="section">
          <h2>Invitaciones</h2>
          <div className="us-lista">
            {invitaciones.map((i) => (
              <div key={i.id} className="us-fila">
                <div className="us-cab" style={{ cursor: 'default' }}>
                  <span className="us-nombre">
                    {i.note || 'Sin nota'}
                    <span className={`us-tag ${i.estado === 'pendiente' ? '' : 'off'}`}>{i.estado}</span>
                  </span>
                  <span className="us-uso">
                    {i.estado === 'pendiente'
                      ? `caduca el ${new Date(i.expiresAt).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })}`
                      : i.estado === 'usada'
                        ? `la usó ${i.usuario ?? 'alguien'}`
                        : ''}
                  </span>
                </div>
                {i.estado === 'pendiente' && (
                  <div className="us-detalle">
                    <button
                      className="btn ghost sm"
                      onClick={async () => {
                        await del(`/admin/invitaciones/${i.id}`);
                        await cargar();
                      }}
                    >
                      Anular
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      )}
    </>
  );
}

/** «Hace 3 días» se lee mejor que una fecha, salvo cuando ya es historia. */
function visto(iso: string | null): string {
  if (!iso) return 'sin entrar todavía';
  const dias = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  if (dias <= 0) return 'hoy';
  if (dias === 1) return 'ayer';
  if (dias < 30) return `hace ${dias} días`;
  return `el ${new Date(iso).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: '2-digit' })}`;
}
