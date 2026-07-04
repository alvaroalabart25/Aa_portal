import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { post } from '../lib/api';
import { setToken } from '../lib/auth';

export default function Login() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const { token } = await post<{ token: string }>('/auth/login', { username, password });
      setToken(token);
      navigate('/agenda');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al entrar');
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
        {error && <div className="error-msg">{error}</div>}
        <button className="btn" disabled={loading}>
          {loading ? 'Entrando…' : 'Entrar'}
        </button>
      </form>
    </div>
  );
}
