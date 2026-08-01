import { useSearchParams } from 'react-router-dom';
import NotificacionesPage from '../modules/push/NotificacionesPage';
import SeguridadPage from '../modules/security/SeguridadPage';

type Tab = 'seguridad' | 'notificaciones';

// Configuración: un único apartado del menú que agrupa los ajustes del portal.
// La pestaña viaja en la URL (?tab=) para poder enlazar directamente a una.
export default function Configuracion() {
  const [params, setParams] = useSearchParams();
  const tab: Tab = params.get('tab') === 'notificaciones' ? 'notificaciones' : 'seguridad';

  function ir(t: Tab) {
    setParams(t === 'seguridad' ? {} : { tab: t }, { replace: true });
  }

  return (
    <div>
      <div className="page-head">
        <h1>Configuración</h1>
        <div className="seg" role="tablist">
          <button
            role="tab"
            aria-selected={tab === 'seguridad'}
            className={tab === 'seguridad' ? 'active' : ''}
            onClick={() => ir('seguridad')}
          >
            Seguridad
          </button>
          <button
            role="tab"
            aria-selected={tab === 'notificaciones'}
            className={tab === 'notificaciones' ? 'active' : ''}
            onClick={() => ir('notificaciones')}
          >
            Notificaciones
          </button>
        </div>
      </div>

      {tab === 'seguridad' ? <SeguridadPage /> : <NotificacionesPage />}
    </div>
  );
}
