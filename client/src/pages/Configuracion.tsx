import { useEffect, useState } from 'react';
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
        <>
          <SeguridadPage />
          <Medidor />
        </>
      )}
    </div>
  );
}

/**
 * Los números del hueco del sistema.
 *
 * Está aquí, y no detrás de un `?medir=1`, porque en la app instalada no hay
 * barra de direcciones donde escribir eso. Contesta a la única pregunta que
 * desde el ordenador no se puede contestar: cuánto mide de verdad la franja
 * del reloj para la web en SU iPhone. De eso depende si el contenido pasa por
 * debajo del reloj o si iOS nos recorta la ventana ahí. Se quita en cuanto se
 * sepa.
 */
function Medidor() {
  const [txt, setTxt] = useState('');

  useEffect(() => {
    const sonda = document.createElement('div');
    sonda.style.cssText =
      'position:fixed;top:0;left:0;width:1px;height:env(safe-area-inset-top);visibility:hidden';
    document.body.appendChild(sonda);
    const arriba = Math.round(sonda.getBoundingClientRect().height);
    sonda.style.height = 'env(safe-area-inset-bottom)';
    const abajo = Math.round(sonda.getBoundingClientRect().height);
    sonda.remove();

    const instalada = (window.navigator as { standalone?: boolean }).standalone ? 'instalada' : 'en Safari';
    const tapa = document.querySelector('.tapa-arriba');
    const cristal = tapa ? Math.round(tapa.getBoundingClientRect().height) : 0;
    setTxt(`arriba ${arriba} · abajo ${abajo} · cristal ${cristal} · ${instalada} · ventana ${window.innerHeight}`);
  }, []);

  return (
    <section className="section">
      <h2 style={{ fontSize: 16 }}>Medidas de la pantalla</h2>
      <p className="muted" style={{ fontSize: 13 }}>
        Temporal, para cuadrar el cristal de arriba. Manda esta línea:
      </p>
      <p
        style={{
          background: '#0a0a0a',
          color: '#fff',
          padding: '10px 12px',
          borderRadius: 10,
          fontSize: 14,
          fontWeight: 600,
          textAlign: 'center',
          margin: 0,
        }}
      >
        {txt || 'midiendo…'}
      </p>
    </section>
  );
}
