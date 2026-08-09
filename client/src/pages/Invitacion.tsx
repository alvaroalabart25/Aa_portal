import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../lib/api';
import { setToken } from '../lib/auth';
import { usePerfil } from '../lib/perfil';
import { MODULOS_ACTIVABLES } from '../shell/modules';

/**
 * Alta por invitación: la única puerta de entrada al portal.
 *
 * Son dos pasos a propósito. Pedir la cuenta y elegir el portal a la vez es una
 * pantalla larga en la que lo segundo se contesta por inercia, y los módulos
 * son justo lo que decide qué ves cada día. Además el paso 1 puede fallar (el
 * usuario está cogido) y sería una lástima perder lo elegido en el 2.
 *
 * Los módulos no son una decisión definitiva y se dice: se cambian en
 * Configuración cuando quieras.
 */

// Qué es cada módulo, en una frase. Sin esto la pantalla pide elegir entre seis
// palabras sueltas que no significan nada para quien acaba de llegar.
const QUE_ES: Record<string, string> = {
  agenda: 'Lo que tienes que hacer hoy, la semana y el mes de un vistazo.',
  org: 'Proyectos y tareas, agrupados por espacios (trabajo, casa, lo que sea).',
  salud: 'Diario de peso y ánimo, rutinas diarias y entrenamientos de gimnasio.',
  suenos: 'Metas grandes, metas pequeñas y lista de deseos.',
  autonomo: 'Facturas y cuentas si trabajas por tu cuenta.',
  roadmap: 'Las mejoras pendientes del propio portal.',
};

type Estado = 'comprobando' | 'invalida' | 'lista';

export default function Invitacion() {
  const { token = '' } = useParams();
  const navigate = useNavigate();
  const { recargar } = usePerfil();

  const [estado, setEstado] = useState<Estado>('comprobando');
  const [motivo, setMotivo] = useState('');
  const [paso, setPaso] = useState<1 | 2>(1);

  const [displayName, setDisplayName] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [modulos, setModulos] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [enviando, setEnviando] = useState(false);

  // Se comprueba el enlace ANTES de enseñar nada: rellenar un formulario
  // entero para que al final te digan que la invitación caducó es un mal día.
  useEffect(() => {
    api<{ ok: true; modules: string[] }>(`/auth/invitacion/${encodeURIComponent(token)}`, { skipAuthRedirect: true })
      .then((r) => {
        setModulos(r.modules);
        setEstado('lista');
      })
      .catch((e: Error) => {
        setMotivo(e.message || 'Esta invitación no es válida');
        setEstado('invalida');
      });
  }, [token]);

  function alternar(id: string) {
    setModulos((m) => (m.includes(id) ? m.filter((x) => x !== id) : [...m, id]));
  }

  async function crear(e: FormEvent) {
    e.preventDefault();
    setError('');
    setEnviando(true);
    try {
      const r = await api<{ token: string }>('/auth/registro', {
        method: 'POST',
        body: JSON.stringify({ token, username, password, displayName, modules: modulos }),
        skipAuthRedirect: true,
      });
      // Se entra directo: acabas de poner una contraseña, pedirla otra vez es
      // un trámite que no protege de nada.
      setToken(r.token);
      // El perfil se pide antes de entrar: si no, el menú se pinta con los
      // valores de «todavía no sé quién eres» y cambia debajo del dedo.
      await recargar();
      navigate('/', { replace: true });
    } catch (err) {
      setError((err as Error).message || 'No se ha podido crear la cuenta');
      setPaso(1); // los fallos de validación son del primer paso
    } finally {
      setEnviando(false);
    }
  }

  if (estado === 'comprobando') {
    return (
      <div className="login-wrap">
        <div className="login-card">
          <div className="brand">Aa</div>
          <p className="muted" style={{ textAlign: 'center' }}>Comprobando la invitación…</p>
        </div>
      </div>
    );
  }

  if (estado === 'invalida') {
    return (
      <div className="login-wrap">
        <div className="login-card">
          <div className="brand">Aa</div>
          <div className="error-msg">{motivo}</div>
          <p className="muted" style={{ fontSize: 12.5, lineHeight: 1.6 }}>
            Los enlaces de invitación caducan a los 7 días y solo sirven una vez. Pide uno nuevo a quien te invitó.
          </p>
          <button className="btn ghost" onClick={() => navigate('/login')}>
            Ir a entrar
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="login-wrap">
      <form className="login-card inv-card" onSubmit={paso === 1 ? (e) => { e.preventDefault(); setPaso(2); } : crear}>
        <div className="brand">Aa</div>

        {paso === 1 ? (
          <>
            <p className="inv-intro">
              Te han invitado al portal. Tu cuenta es tuya y solo tuya: nadie más ve lo que escribas aquí dentro.
            </p>

            <div>
              <label htmlFor="nombre">Tu nombre</label>
              <input
                id="nombre"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                autoComplete="name"
                placeholder="Como quieras que te llame"
                style={{ width: '100%' }}
              />
            </div>

            <div>
              <label htmlFor="user">Usuario</label>
              <input
                id="user"
                value={username}
                onChange={(e) => setUsername(e.target.value.toLowerCase().trim())}
                autoComplete="username"
                required
                minLength={3}
                placeholder="tu@correo.com"
                style={{ width: '100%' }}
              />
              <p className="inv-pista">
                Con esto entras. Si pones tu correo, podrás recuperar la contraseña si la olvidas.
              </p>
            </div>

            <div>
              <label htmlFor="pass">Contraseña</label>
              <input
                id="pass"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
                required
                minLength={12}
                style={{ width: '100%' }}
              />
              <p className="inv-pista">
                Mínimo 12 caracteres. Una frase que recuerdes es mejor que una palabra rara con símbolos.
              </p>
            </div>

            {error && <div className="error-msg">{error}</div>}
            <button className="btn" disabled={username.length < 3 || password.length < 12}>
              Siguiente
            </button>
          </>
        ) : (
          <>
            <p className="inv-intro">
              ¿Qué quieres usar? Enciende solo lo que vayas a mirar; el resto no aparecerá en el menú.
              <b> Esto se cambia luego en Configuración.</b>
            </p>

            <div className="inv-modulos">
              {MODULOS_ACTIVABLES.map((m) => {
                const puesto = modulos.includes(m.id);
                return (
                  <button
                    key={m.id}
                    type="button"
                    className={`inv-mod${puesto ? ' on' : ''}`}
                    aria-pressed={puesto}
                    onClick={() => alternar(m.id)}
                  >
                    <span className="inv-mod-ico">{m.icon}</span>
                    <span className="inv-mod-txt">
                      <b>{m.title}</b>
                      <span>{QUE_ES[m.id] ?? ''}</span>
                    </span>
                    <span className="inv-mod-check" aria-hidden>
                      {puesto ? '✓' : ''}
                    </span>
                  </button>
                );
              })}
            </div>

            {error && <div className="error-msg">{error}</div>}
            {modulos.length === 0 && (
              <p className="inv-pista">Enciende al menos uno: si no, el portal se queda vacío.</p>
            )}

            <button className="btn" disabled={enviando || modulos.length === 0}>
              {enviando ? 'Creando tu portal…' : 'Crear mi cuenta'}
            </button>
            <button type="button" className="login-link" onClick={() => setPaso(1)}>
              Volver
            </button>
          </>
        )}
      </form>
    </div>
  );
}
