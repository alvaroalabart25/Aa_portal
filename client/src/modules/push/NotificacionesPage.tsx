import { useCallback, useEffect, useState } from 'react';
import { get, post, api } from '../../lib/api';

interface Pref {
  type: string;
  label: string;
  enabled: boolean;
  sendTime: string;
}

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = window.atob(b64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

const HOURS = Array.from({ length: 17 }, (_, i) => `${String(i + 7).padStart(2, '0')}:00`); // 07:00-23:00

// Configurador central de notificaciones push: activar el dispositivo y
// un interruptor por tipo de aviso con su hora.
export default function NotificacionesPage() {
  const [supported] = useState(() => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window);
  const [subscribed, setSubscribed] = useState(false);
  const [devices, setDevices] = useState(0);
  const [prefs, setPrefs] = useState<Pref[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  const load = useCallback(async () => {
    const r = await get<{ devices: number; prefs: Pref[] }>('/push/prefs');
    setDevices(r.devices);
    setPrefs(r.prefs);
    if ('serviceWorker' in navigator) {
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = await reg?.pushManager.getSubscription();
      setSubscribed(Boolean(sub));
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function activate() {
    setBusy(true);
    setMsg('');
    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        setMsg('Permiso denegado: actívalo en los ajustes del navegador/dispositivo.');
        return;
      }
      const { publicKey } = await get<{ publicKey: string }>('/push/public-key');
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });
      await post('/push/subscribe', sub.toJSON());
      setMsg('✅ Dispositivo activado.');
      await load();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Error al activar');
    } finally {
      setBusy(false);
    }
  }

  async function deactivate() {
    setBusy(true);
    setMsg('');
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = await reg?.pushManager.getSubscription();
      if (sub) {
        await post('/push/unsubscribe', { endpoint: sub.endpoint });
        await sub.unsubscribe();
      }
      setMsg('Dispositivo desactivado.');
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function sendTest() {
    setBusy(true);
    setMsg('');
    try {
      await post('/push/test', {});
      setMsg('📬 Prueba enviada — debería sonar en tus dispositivos activados.');
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Error');
    } finally {
      setBusy(false);
    }
  }

  async function updatePref(p: Pref, changes: Partial<Pref>) {
    const next = { ...p, ...changes };
    setPrefs((list) => list.map((x) => (x.type === p.type ? next : x)));
    await api('/push/prefs', {
      method: 'PUT',
      body: JSON.stringify({ type: next.type, enabled: next.enabled, sendTime: next.sendTime }),
    });
  }

  return (
    <div>
      <div className="page-head">
        <h1>Notificaciones</h1>
      </div>

      {!supported && (
        <p className="quarter-result" style={{ marginTop: 18 }}>
          Este navegador no soporta notificaciones push. En iPhone: instala la app (Safari → Compartir → «Añadir a
          pantalla de inicio») y actívalas <strong>desde la app instalada</strong>.
        </p>
      )}

      <section className="section" style={{ marginTop: 24 }}>
        <h2>Este dispositivo</h2>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 12, flexWrap: 'wrap' }}>
          {subscribed ? (
            <>
              <span className="badge" style={{ color: '#2f9e44', fontWeight: 600 }}>
                <span className="dot" style={{ background: '#2f9e44' }} /> Activadas aquí
              </span>
              <button className="btn ghost sm" disabled={busy} onClick={sendTest}>
                📬 Enviar prueba
              </button>
              <button className="btn danger sm" disabled={busy} onClick={deactivate}>
                Desactivar
              </button>
            </>
          ) : (
            <button className="btn" disabled={busy || !supported} onClick={activate}>
              🔔 Activar notificaciones en este dispositivo
            </button>
          )}
          <span className="muted" style={{ fontSize: 13 }}>
            {devices} dispositivo{devices === 1 ? '' : 's'} activado{devices === 1 ? '' : 's'} en total
          </span>
        </div>
        {msg && <p style={{ fontSize: 13.5, marginTop: 10 }}>{msg}</p>}
        <p className="muted" style={{ fontSize: 12.5, marginTop: 10, lineHeight: 1.6 }}>
          En iPhone las notificaciones solo funcionan desde la <strong>app instalada</strong> (no desde Safari):
          instálala, ábrela y pulsa Activar. Actívalo en cada dispositivo donde quieras recibir avisos.
        </p>
      </section>

      <section className="section">
        <h2>Avisos</h2>
        <div className="roadmap-list">
          {prefs.map((p) => (
            <div key={p.type} className="roadmap-row" style={{ justifyContent: 'space-between' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 10, margin: 0, fontSize: 14, fontWeight: 500, color: 'var(--ink)' }}>
                <input type="checkbox" checked={p.enabled} onChange={(e) => updatePref(p, { enabled: e.target.checked })} />
                {p.label}
              </label>
              <select value={p.sendTime} disabled={!p.enabled} onChange={(e) => updatePref(p, { sendTime: e.target.value })} style={{ padding: '4px 8px' }}>
                {HOURS.map((h) => (
                  <option key={h} value={h}>
                    {h}
                  </option>
                ))}
              </select>
            </div>
          ))}
        </div>
        <p className="muted" style={{ fontSize: 12.5, marginTop: 12 }}>
          Cada aviso se envía como muy tarde una vez al día, a partir de su hora, y solo si hay algo que contar.
        </p>
      </section>
    </div>
  );
}
