import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { setToken } from '../lib/auth';
import { usePerfil } from '../lib/perfil';
import { entrarConPasskey, marcarActividad, passkeysSoportadas } from '../lib/passkeys';

export default function Login() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [pide2fa, setPide2fa] = useState(false);
  const [pidiendoEnlace, setPidiendoEnlace] = useState(false);
  const [avisoEnlace, setAvisoEnlace] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const { recargar } = usePerfil();
  const conFaceId = passkeysSoportadas();

  // Pide el enlace de recuperación. La respuesta es siempre la misma exista o
  // no la cuenta, así que aquí solo mostramos el acuse.
  async function pedirEnlace() {
    setAvisoEnlace('');
    setLoading(true);
    try {
      await api<{ message: string }>('/auth/forgot-password', {
        method: 'POST',
        body: JSON.stringify({ username }),
        skipAuthRedirect: true,
      });
      setAvisoEnlace('Si la cuenta existe, te llega un correo con el enlace. Caduca en 30 minutos.');
    } catch (e) {
      setAvisoEnlace(e instanceof Error ? e.message : 'No se pudo pedir el enlace');
    } finally {
      setLoading(false);
    }
  }

  async function entrarConCara() {
    setError('');
    setLoading(true);
    try {
      await entrarConPasskey();
      marcarActividad();
      await recargar();
      // A «/» y no a Agenda: cada cuenta entra por el primer módulo que tenga.
      navigate('/', { replace: true });
    } catch (e) {
      const err = e as Error;
      setError(err.name === 'NotAllowedError' ? '' : err.message || 'No se pudo entrar con Face ID');
    } finally {
      setLoading(false);
    }
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      // Sin `post` para poder leer la marca need2fa del cuerpo del 401
      const res = await api<{ token: string }>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username, password, ...(code ? { code: code.trim() } : {}) }),
        skipAuthRedirect: true,
      });
      setToken(res.token);
      marcarActividad();
      await recargar();
      navigate('/', { replace: true });
    } catch (err) {
      const e = err as Error & { need2fa?: boolean };
      if (e.need2fa) {
        setPide2fa(true);
        setError(code ? 'Código incorrecto, prueba con el siguiente' : '');
        setCode('');
      } else {
        setError(e.message || 'Error al entrar');
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={onSubmit}>
        <div className="brand">Aa</div>
        <div>
          <label htmlFor="user">Usuario</label>
          <input
            id="user"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            style={{ width: '100%' }}
          />
        </div>
        <div>
          <label htmlFor="pass">Contraseña</label>
          <input
            id="pass"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            style={{ width: '100%' }}
          />
        </div>
        {pide2fa && (
          <div>
            <label htmlFor="code">Código de verificación</label>
            <input
              id="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              autoFocus
              placeholder="000000"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              style={{ width: '100%', letterSpacing: 3, textAlign: 'center' }}
            />
            <p className="muted" style={{ fontSize: 12.5, marginTop: 6 }}>
              El de 6 dígitos de tu app autenticadora.
            </p>
          </div>
        )}
        {error && <div className="error-msg">{error}</div>}
        <button className="btn" disabled={loading || (pide2fa && code.trim().length < 6)}>
          {loading ? 'Entrando…' : pide2fa ? 'Verificar y entrar' : 'Entrar'}
        </button>
        {pidiendoEnlace ? (
          <div>
            <p className="muted" style={{ fontSize: 12.5, margin: '0 0 8px', lineHeight: 1.6 }}>
              Escribe tu usuario arriba y te mandamos un enlace al correo para poner una contraseña nueva.
            </p>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button type="button" className="btn sm" disabled={loading || !username} onClick={pedirEnlace}>
                Enviarme el enlace
              </button>
              <button type="button" className="btn ghost sm" onClick={() => { setPidiendoEnlace(false); setAvisoEnlace(''); }}>
                Cancelar
              </button>
            </div>
            {avisoEnlace && <p style={{ fontSize: 12.5, marginTop: 10 }}>{avisoEnlace}</p>}
          </div>
        ) : (
          <button
            type="button"
            className="login-link"
            onClick={() => setPidiendoEnlace(true)}
          >
            ¿Has olvidado la contraseña?
          </button>
        )}
        {conFaceId && !pide2fa && (
          <>
            <div className="login-sep">o</div>
            <button type="button" className="btn ghost" disabled={loading} onClick={entrarConCara}>
              🔓 Entrar con Face ID
            </button>
          </>
        )}
      </form>
    </div>
  );
}
