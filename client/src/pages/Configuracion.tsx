import { useSearchParams } from 'react-router-dom';
import NotificacionesPage from '../modules/push/NotificacionesPage';
import SeguridadPage from '../modules/security/SeguridadPage';
import BitacoraTab from '../modules/security/BitacoraTab';
import ModulosTab from './ModulosTab';
import UsuariosTab from './UsuariosTab';
import { usePerfil } from '../lib/perfil';

type Tab = 'seguridad' | 'modulos' | 'notificaciones' | 'bitacora' | 'usuarios';

// Bitácora y Usuarios son del portal entero (IPs, intentos, quién hay dentro),
// no de una cuenta: solo las ve quien administra. Que no se pinte el botón es
// comodidad; quien decide de verdad es el servidor, que devuelve 403.
const TABS: [Tab, string, boolean][] = [
  ['seguridad', 'Seguridad', false],
  ['modulos', 'Módulos', false],
  ['notificaciones', 'Notificaciones', false],
  ['bitacora', 'Bitácora', true],
  ['usuarios', 'Usuarios', true],
];

// Configuración: un único apartado del menú que agrupa los ajustes del portal.
// La pestaña viaja en la URL (?tab=) para poder enlazar directamente a una.
export default function Configuracion() {
  const [params, setParams] = useSearchParams();
  const { perfil } = usePerfil();
  const admin = perfil?.role === 'admin';

  const visibles = TABS.filter(([, , soloAdmin]) => admin || !soloAdmin);
  const pedida = params.get('tab');
  const tab: Tab = visibles.some(([v]) => v === pedida) ? (pedida as Tab) : 'seguridad';

  function ir(t: Tab) {
    setParams(t === 'seguridad' ? {} : { tab: t }, { replace: true });
  }

  return (
    <div>
      <div className="page-head">
        <h1>Configuración</h1>
        <div className="seg" role="tablist">
          {visibles.map(([v, label]) => (
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

      <p className="page-sub">Tu cuenta y nada más: seguridad, módulos encendidos y avisos.</p>

      {tab === 'notificaciones' ? (
        <NotificacionesPage />
      ) : tab === 'bitacora' ? (
        <BitacoraTab />
      ) : tab === 'modulos' ? (
        <ModulosTab />
      ) : tab === 'usuarios' ? (
        <UsuariosTab />
      ) : (
        <SeguridadPage />
      )}
    </div>
  );
}
