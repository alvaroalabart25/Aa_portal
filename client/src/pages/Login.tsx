import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { setToken } from '../lib/auth';

export default function Login() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [pide2fa, setPide2fa] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

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
      navigate('/agenda');
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
      </form>
    </div>
  );
}
