import { useSearchParams } from 'react-router-dom';
import NotificacionesPage from '../modules/push/NotificacionesPage';
import SeguridadPage from '../modules/security/SeguridadPage';
import BitacoraTab from '../modules/security/BitacoraTab';

type Tab = 'seguridad' | 'notificaciones' | 'bitacora';

const TABS: [Tab, string][] = [
  ['seguridad', 'Seguridad'],
  ['notificaciones', 'Notificaciones'],
  ['bitacora', 'Bitácora'],
];

// Configuración: un único apartado del menú que agrupa los ajustes del portal.
// La pestaña viaja en la URL (?tab=) para poder enlazar directamente a una.
export default function Configuracion() {
  const [params, setParams] = useSearchParams();
  const pedida = params.get('tab');
  const tab: Tab = pedida === 'notificaciones' || pedida === 'bitacora' ? pedida : 'seguridad';

  function ir(t: Tab) {
    setParams(t === 'seguridad' ? {} : { tab: t }, { replace: true });
  }

  return (
    <div>
      <div className="page-head">
        <h1>Configuración</h1>
        <div className="seg" role="tablist">
          {TABS.map(([v, label]) => (
            <button
              key={v}
              role="tab"
              aria-selected={tab === v}
              className={tab === v ? 'active' : ''}
              onClick={() => ir(v)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {tab === 'notificaciones' ? <NotificacionesPage /> : tab === 'bitacora' ? <BitacoraTab /> : <SeguridadPage />}
    </div>
  );
}
