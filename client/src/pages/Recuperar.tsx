import { useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api';

// Pantalla del enlace del correo: pone la contraseña nueva. El enlace caduca a
// los 30 minutos y solo sirve una vez.
export default function Recuperar() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const [nueva, setNueva] = useState('');
  const [repetida, setRepetida] = useState('');
  const [error, setError] = useState('');
  const [listo, setListo] = useState(false);
  const [pide2fa, setPide2fa] = useState(false);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    if (nueva !== repetida) return setError('Las dos contraseñas no coinciden');
    if (nueva.length < 12) return setError('Usa al menos 12 caracteres');
    setLoading(true);
    try {
      const r = await api<{ ok: boolean; need2fa: boolean }>('/auth/reset-password', {
        method: 'POST',
        body: JSON.stringify({ token, next: nueva }),
        skipAuthRedirect: true,
      });
      setPide2fa(r.need2fa);
      setListo(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo cambiar');
    } finally {
      setLoading(false);
    }
  }

  if (!token) {
    return (
      <div className="login-wrap">
        <div className="login-card">
          <div className="brand">Aa</div>
          <div className="error-msg">Falta el enlace. Ábrelo desde el correo que te hemos enviado.</div>
          <button className="btn ghost" onClick={() => navigate('/login')}>
            Volver a entrar
          </button>
        </div>
      </div>
    );
  }

  if (listo) {
    return (
      <div className="login-wrap">
        <div className="login-card">
          <div className="brand">Aa</div>
          <p style={{ fontSize: 14, margin: 0 }}>✅ Contraseña cambiada.</p>
          <p className="muted" style={{ fontSize: 13, margin: 0, lineHeight: 1.6 }}>
            Las sesiones de todos tus dispositivos se han cerrado.
            {pide2fa && ' Al entrar seguirá pidiéndote el código de verificación.'}
          </p>
          <button className="btn" onClick={() => navigate('/login')}>
            Entrar
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={submit}>
        <div className="brand">Aa</div>
        <p className="muted" style={{ fontSize: 13.5, margin: 0 }}>Elige tu contraseña nueva</p>
        <div>
          <label htmlFor="r-nueva">Nueva (mínimo 12 caracteres)</label>
          <input
            id="r-nueva"
            type="password"
            autoComplete="new-password"
            value={nueva}
            onChange={(e) => setNueva(e.target.value)}
            style={{ width: '100%' }}
          />
        </div>
        <div>
          <label htmlFor="r-rep">Repítela</label>
          <input
            id="r-rep"
            type="password"
            autoComplete="new-password"
            value={repetida}
            onChange={(e) => setRepetida(e.target.value)}
            style={{ width: '100%' }}
          />
        </div>
        {error && <div className="error-msg">{error}</div>}
        <button className="btn" disabled={loading || !nueva}>
          {loading ? 'Guardando…' : 'Cambiar contraseña'}
        </button>
      </form>
    </div>
  );
}
