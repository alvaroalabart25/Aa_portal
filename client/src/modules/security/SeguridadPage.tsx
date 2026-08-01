import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { get, post } from '../../lib/api';
import { setToken } from '../../lib/auth';

interface EventoSeguridad {
  id: number;
  kind: string;
  severity: 'alta' | 'media' | 'baja';
  ip: string | null;
  detail: string | null;
  createdAt: string;
}

const NOMBRES: Record<string, string> = {
  login_fallido: 'Intento de acceso fallido',
  login_nuevo_origen: 'Acceso desde una IP nueva',
  token_invalido: 'Token inválido',
  sesion_revocada_uso: 'Uso de una sesión revocada',
  track_token_invalido: 'Token del control remoto incorrecto',
  cron_secreto_invalido: 'Secreto del disparador incorrecto',
  limite_trafico: 'Límite de tráfico alcanzado',
  origen_no_permitido: 'Origen no permitido',
  error_servidor: 'Error de la API',
  sesiones_revocadas: 'Sesiones cerradas en todos los dispositivos',
  front_modificado: 'El portal cambió sin despliegue',
  contrasena_cambiada: 'Contraseña cambiada',
  '2fa_activado': 'Segundo factor activado',
  '2fa_desactivado': 'Segundo factor desactivado',
};

function fecha(iso: string): string {
  return new Date(iso).toLocaleString('es-ES', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

// Contraseña: exige la actual y cierra las demás sesiones al cambiarla
function CambiarContrasena() {
  const [actual, setActual] = useState('');
  const [nueva, setNueva] = useState('');
  const [repetida, setRepetida] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setMsg('');
    if (nueva !== repetida) return setMsg('La nueva contraseña y su repetición no coinciden');
    if (nueva.length < 12) return setMsg('Usa al menos 12 caracteres');
    setBusy(true);
    try {
      const r = await post<{ token: string }>('/auth/change-password', { current: actual, next: nueva });
      setToken(r.token); // esta sesión sigue viva, las demás no
      setActual('');
      setNueva('');
      setRepetida('');
      setMsg('✅ Contraseña cambiada. Las sesiones de otros dispositivos ya no valen.');
    } catch (err) {
      setMsg(err instanceof Error ? err.message : 'No se pudo cambiar');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="section">
      <h2>Contraseña</h2>
      <form onSubmit={submit} className="sg-form">
        <div className="field">
          <label htmlFor="sg-actual">Contraseña actual</label>
          <input id="sg-actual" type="password" autoComplete="current-password" value={actual} onChange={(e) => setActual(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="sg-nueva">Nueva (mínimo 12 caracteres)</label>
          <input id="sg-nueva" type="password" autoComplete="new-password" value={nueva} onChange={(e) => setNueva(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="sg-rep">Repítela</label>
          <input id="sg-rep" type="password" autoComplete="new-password" value={repetida} onChange={(e) => setRepetida(e.target.value)} />
        </div>
        <button className="btn" disabled={busy || !actual || !nueva}>
          Cambiar contraseña
        </button>
      </form>
      {msg && <p style={{ fontSize: 13.5, marginTop: 10 }}>{msg}</p>}
      <p className="muted" style={{ fontSize: 12.5, marginTop: 8 }}>
        Al cambiarla se cierran las sesiones del resto de dispositivos; esta se mantiene.
      </p>
    </section>
  );
}

// Segundo factor con app autenticadora (TOTP)
function SegundoFactor({ activo, onCambio }: { activo: boolean; onCambio: () => void }) {
  const [qr, setQr] = useState('');
  const [secreto, setSecreto] = useState('');
  const [code, setCode] = useState('');
  const [pass, setPass] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  async function empezar() {
    setBusy(true);
    setMsg('');
    try {
      const r = await post<{ qr: string; secret: string }>('/auth/2fa/setup', {});
      setQr(r.qr);
      setSecreto(r.secret);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Error');
    } finally {
      setBusy(false);
    }
  }

  async function activar(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg('');
    try {
      await post('/auth/2fa/enable', { code });
      setQr('');
      setSecreto('');
      setCode('');
      setMsg('✅ Segundo factor activado. La próxima vez que entres te pedirá el código.');
      onCambio();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : 'Error');
    } finally {
      setBusy(false);
    }
  }

  async function desactivar(e: FormEvent) {
    e.preventDefault();
    if (!confirm('¿Desactivar el segundo factor? Tu portal quedará protegido solo con la contraseña.')) return;
    setBusy(true);
    setMsg('');
    try {
      await post('/auth/2fa/disable', { password: pass, code });
      setPass('');
      setCode('');
      setMsg('Segundo factor desactivado.');
      onCambio();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : 'Error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="section">
      <div className="page-head">
        <h2>Segundo factor</h2>
        <span className="badge" style={{ color: activo ? '#2f9e44' : 'var(--ink-muted)', fontWeight: 600 }}>
          <span className="dot" style={{ background: activo ? '#2f9e44' : 'var(--line)' }} />
          {activo ? 'Activado' : 'Desactivado'}
        </span>
      </div>

      {!activo && !qr && (
        <>
          <p className="muted" style={{ fontSize: 13.5, lineHeight: 1.6, marginTop: 6 }}>
            Añade un código de 6 dígitos a tu contraseña. Te vale cualquier app autenticadora: la de contraseñas del
            propio iPhone, Google Authenticator o 1Password. Es la medida que más sube el nivel de cara a los datos
            bancarios.
          </p>
          <button className="btn" disabled={busy} onClick={empezar} style={{ marginTop: 12 }}>
            Empezar
          </button>
        </>
      )}

      {!activo && qr && (
        <form onSubmit={activar} style={{ marginTop: 12 }}>
          <p style={{ fontSize: 13.5, margin: '0 0 12px' }}>
            1. Escanea este código con tu app autenticadora.
          </p>
          <img src={qr} alt="Código QR para la app autenticadora" width={200} height={200} style={{ border: '1px solid var(--line)', borderRadius: 8 }} />
          <p className="muted" style={{ fontSize: 12.5, margin: '10px 0 0' }}>
            Si no puedes escanear, introduce esta clave a mano:
            <br />
            <code style={{ fontSize: 12, wordBreak: 'break-all' }}>{secreto}</code>
          </p>
          <p style={{ fontSize: 13.5, margin: '16px 0 8px' }}>2. Escribe el código que te muestre para confirmar:</p>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <input
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="000000"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              style={{ width: 110, letterSpacing: 2, textAlign: 'center' }}
            />
            <button className="btn" disabled={busy || code.length < 6}>
              Activar
            </button>
            <button type="button" className="btn ghost" onClick={() => { setQr(''); setSecreto(''); }}>
              Cancelar
            </button>
          </div>
        </form>
      )}

      {activo && (
        <form onSubmit={desactivar} style={{ marginTop: 10 }}>
          <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>
            Para desactivarlo hacen falta tu contraseña y un código: así un token robado no basta.
          </p>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 8 }}>
            <input type="password" placeholder="Contraseña" autoComplete="current-password" value={pass} onChange={(e) => setPass(e.target.value)} style={{ width: 170 }} />
            <input inputMode="numeric" placeholder="000000" value={code} onChange={(e) => setCode(e.target.value)} style={{ width: 100, letterSpacing: 2, textAlign: 'center' }} />
            <button className="btn danger sm" disabled={busy || !pass || code.length < 6}>
              Desactivar
            </button>
          </div>
        </form>
      )}

      {msg && <p style={{ fontSize: 13.5, marginTop: 12 }}>{msg}</p>}
    </section>
  );
}

// Salud · Seguridad: contraseña, segundo factor, sesiones y bitácora
export default function SeguridadPage() {
  const [activo, setActivo] = useState(false);
  const [eventos, setEventos] = useState<EventoSeguridad[]>([]);
  const [msg, setMsg] = useState('');

  const cargar = useCallback(async () => {
    const [st, ev] = await Promise.all([
      get<{ enabled: boolean }>('/auth/2fa/status'),
      get<EventoSeguridad[]>('/auth/security-events'),
    ]);
    setActivo(st.enabled);
    setEventos(ev);
  }, []);
  useEffect(() => {
    cargar();
  }, [cargar]);

  async function revocar() {
    if (!confirm('¿Cerrar la sesión en todos los dispositivos? Tendrás que volver a entrar en el resto (aquí no).')) return;
    try {
      const r = await post<{ token: string }>('/auth/revoke-all', {});
      setToken(r.token);
      setMsg('Hecho: las demás sesiones ya no valen.');
      cargar();
    } catch {
      setMsg('No se ha podido completar.');
    }
  }

  return (
    <div>
      <div className="page-head">
        <h1>Seguridad</h1>
      </div>

      <SegundoFactor activo={activo} onCambio={cargar} />
      <CambiarContrasena />

      <section className="section">
        <h2>Sesiones</h2>
        <p className="muted" style={{ fontSize: 13, marginTop: 4 }}>
          La sesión dura 30 días en cada dispositivo. Si pierdes el móvil o sospechas de algo, ciérralas todas.
        </p>
        <button className="btn ghost" onClick={revocar} style={{ marginTop: 10 }}>
          Cerrar sesión en todos los dispositivos
        </button>
        {msg && <p style={{ fontSize: 13.5, marginTop: 10 }}>{msg}</p>}
      </section>

      <section className="section">
        <h2>Últimos eventos</h2>
        {eventos.length === 0 && <div className="empty">Nada registrado. Buena señal.</div>}
        <div className="sg-events">
          {eventos.map((e) => (
            <div key={e.id} className={`sg-event ${e.severity}`}>
              <span className="sg-event-when">{fecha(e.createdAt)}</span>
              <span className="sg-event-what">{NOMBRES[e.kind] ?? e.kind}</span>
              <span className="sg-event-ip">{e.ip ?? ''}</span>
            </div>
          ))}
        </div>
        <p className="muted" style={{ fontSize: 12, marginTop: 10 }}>
          Todo lo anómalo queda aquí y, según su gravedad, te llega también por correo.
        </p>
      </section>
    </div>
  );
}
