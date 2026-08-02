import { useCallback, useEffect, useState } from 'react';
import { get } from '../../lib/api';

export interface EventoSeguridad {
  id: number;
  kind: string;
  severity: 'alta' | 'media' | 'baja';
  ip: string | null;
  detail: string | null;
  createdAt: string;
}

export const NOMBRES_EVENTOS: Record<string, string> = {
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
  passkey_registrada: 'Llave de acceso registrada',
  passkey_borrada: 'Llave de acceso eliminada',
  recuperacion_solicitada: 'Recuperación de contraseña solicitada',
  contrasena_restablecida: 'Contraseña restablecida por correo',
  codigo_recuperacion_usado: 'Entrada con código de recuperación',
  codigos_recuperacion_nuevos: 'Códigos de recuperación regenerados',
};

function fechaLarga(iso: string): string {
  return new Date(iso).toLocaleString('es-ES', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Bitácora de seguridad, en su propia pantalla.
 *
 * Antes vivía al final de Seguridad y la volvía interminable. No hace falta
 * tenerla delante: lo que importa llega por correo en el momento. Esto es el
 * sitio al que venir cuando algo huele mal y quieres mirar con calma.
 */
export default function BitacoraTab() {
  const [eventos, setEventos] = useState<EventoSeguridad[]>([]);
  const [cargando, setCargando] = useState(true);
  const [todos, setTodos] = useState(false);
  const [soloGraves, setSoloGraves] = useState(false);

  const cargar = useCallback(async () => {
    setCargando(true);
    setEventos(await get<EventoSeguridad[]>(`/auth/security-events?limit=${todos ? 300 : 60}`));
    setCargando(false);
  }, [todos]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  const mostrados = soloGraves ? eventos.filter((e) => e.severity === 'alta') : eventos;

  return (
    <div>
      <div className="page-head">
        <h2>Bitácora de seguridad</h2>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <label className="bit-check">
            <input type="checkbox" checked={soloGraves} onChange={(e) => setSoloGraves(e.target.checked)} />
            Solo lo grave
          </label>
          <button className="btn ghost sm" onClick={cargar}>
            Actualizar
          </button>
        </div>
      </div>

      <p className="muted" style={{ fontSize: 13, lineHeight: 1.6, marginTop: 4 }}>
        Todo lo anómalo queda aquí: accesos fallidos, tokens inválidos, límites de tráfico, cambios en tu cuenta. Lo
        importante te llega además por correo en el momento, así que no hace falta vigilar esta lista.
      </p>

      {cargando ? (
        <p className="empty">Cargando…</p>
      ) : mostrados.length === 0 ? (
        <div className="empty">{soloGraves ? 'Nada grave registrado.' : 'Nada registrado. Buena señal.'}</div>
      ) : (
        <>
          <div className="sg-events" style={{ marginTop: 14 }}>
            {mostrados.map((e) => (
              <div key={e.id} className={`sg-event ${e.severity}`}>
                <span className="sg-event-when">{fechaLarga(e.createdAt)}</span>
                <span className="sg-event-what">
                  {NOMBRES_EVENTOS[e.kind] ?? e.kind}
                  {e.detail && <span className="muted bit-detail">{e.detail}</span>}
                </span>
                <span className="sg-event-ip">{e.ip ?? ''}</span>
              </div>
            ))}
          </div>

          {!todos && eventos.length >= 60 && (
            <button className="btn ghost sm" style={{ marginTop: 14 }} onClick={() => setTodos(true)}>
              Ver más (hasta 300)
            </button>
          )}
          {todos && (
            <p className="muted" style={{ fontSize: 12.5, marginTop: 12 }}>
              Se muestran los 300 últimos. Lo anterior sigue guardado en la base, pero no se pagina aquí a propósito:
              esto es para mirar lo reciente, no un archivo histórico.
            </p>
          )}
        </>
      )}
    </div>
  );
}
