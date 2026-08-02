import { useCallback, useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { clearToken } from '../lib/auth';
import { entrarConPasskey, marcarActividad, tocaBloquear } from '../lib/passkeys';
import { MODULES, type PortalLink, type PortalModule } from './modules';

/**
 * ¿Está activo este enlace? Si apunta a una pestaña concreta (los subapartados
 * de Sueños comparten ruta y se distinguen por ?tab=), hay que comparar también
 * la pestaña. La de por defecto es «micro», así que una URL sin parámetro cuenta
 * como esa.
 *
 * Lo usan el menú lateral Y la barra inferior: NavLink por sí solo mira solo la
 * ruta y marcaría los tres subapartados a la vez.
 */
function esEnlaceActivo(location: { pathname: string; search: string }, c: PortalLink): boolean {
  if (!location.pathname.startsWith(c.path)) return false;
  if (!c.search) return true;
  const actual = new URLSearchParams(location.search).get('tab') ?? 'micro';
  return `?tab=${actual}` === c.search;
}

/** Dirección completa de un enlace, con su pestaña si la lleva. */
function destino(c: PortalLink): string {
  return `${c.path}${c.search ?? ''}`;
}

function SidebarItem({ mod }: { mod: PortalModule }) {
  const location = useLocation();
  const esActivo = (c: PortalLink) => esEnlaceActivo(location, c);

  const hayHijoActivo = mod.children?.some((c) => location.pathname.startsWith(c.path)) ?? false;
  // Colapsados por defecto: solo se abre el grupo en el que estás. Y si navegas
  // a otro módulo, ese se abre y el anterior se recoge.
  const [open, setOpen] = useState(hayHijoActivo);
  useEffect(() => {
    setOpen(hayHijoActivo);
  }, [hayHijoActivo]);

  if (!mod.children) {
    return (
      <NavLink to={mod.path!} className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}>
        {mod.icon}
        <span>{mod.title}</span>
      </NavLink>
    );
  }

  return (
    <div>
      <button className="nav-group-head" onClick={() => setOpen(!open)} aria-expanded={open}>
        {mod.icon}
        <span style={hayHijoActivo ? { color: 'var(--ink)', fontWeight: 600 } : undefined}>{mod.title}</span>
        <span className={`chev${open ? ' open' : ''}`}>›</span>
      </button>
      {open && (
        <div className="nav-children">
          {mod.children.map((c) => (
            <NavLink
              key={c.id}
              to={destino(c)}
              // className como función a propósito: con una cadena, NavLink
              // añade su propio `active` mirando solo la ruta, y las tres
              // pestañas de Sueños comparten ruta (se marcarían todas).
              className={() => `nav-item${esActivo(c) ? ' active' : ''}`}
            >
              {c.icon}
              <span>{c.title}</span>
            </NavLink>
          ))}
        </div>
      )}
    </div>
  );
}

// En móvil, Espacios no se muestra (se gestiona desde Proyectos)
const HIDDEN_ON_MOBILE = new Set(['spaces']);

// Barra inferior móvil con navegación en 2 niveles:
// raíz = enlaces directos + grupos; al tocar un grupo se muestran sus hijos.
function BottomBar() {
  const [group, setGroup] = useState<string | null>(null);
  const location = useLocation();
  const agenda = MODULES.find((m) => m.id === 'agenda')!;
  const groups = MODULES.filter((m) => m.children);

  const agendaLink = (
    <NavLink
      key="agenda"
      to={agenda.path!}
      onClick={() => setGroup(null)}
      className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
    >
      {agenda.icon}
      <span>{agenda.title}</span>
    </NavLink>
  );

  if (group === null) {
    return (
      <nav className="bottombar">
        {/* se recorre MODULES entero: un módulo sin hijos es un enlace directo,
            uno con hijos abre su segundo nivel */}
        {MODULES.map((m) =>
          m.children ? (
            <button key={m.id} className="nav-item" onClick={() => setGroup(m.id)}>
              {m.icon}
              <span>{m.title}</span>
            </button>
          ) : (
            <NavLink
              key={m.id}
              to={m.path!}
              onClick={() => setGroup(null)}
              className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
            >
              {m.icon}
              <span>{m.title}</span>
            </NavLink>
          ),
        )}
        <NavLink to="/configuracion" onClick={() => setGroup(null)} className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z" />
          </svg>
          <span>Ajustes</span>
        </NavLink>
      </nav>
    );
  }

  const g = groups.find((x) => x.id === group)!;
  return (
    <nav className="bottombar">
      <button className="nav-item" aria-label="Volver" onClick={() => setGroup(null)}>
        <span style={{ fontSize: 17, lineHeight: '18px' }}>‹</span>
        <span>Volver</span>
      </button>
      {group === 'org' && agendaLink}
      {g.children!
        .filter((c) => !HIDDEN_ON_MOBILE.has(c.id))
        .map((c) => (
          // to={destino(c)} y el activo calculado a mano: sin esto, los tres
          // subapartados de Sueños llevaban todos a la misma pestaña y salían
          // los tres en negrita.
          <NavLink
            key={c.id}
            to={destino(c)}
            className={() => `nav-item${esEnlaceActivo(location, c) ? ' active' : ''}`}
          >
            {c.icon}
            <span>{c.title}</span>
          </NavLink>
        ))}
    </nav>
  );
}

/**
 * Pantalla de bloqueo: tapa el portal hasta pasar Face ID. Solo aparece si has
 * activado el bloqueo y la app llevaba un rato cerrada.
 *
 * Se intenta abrir Face ID solo, en cuanto aparece la pantalla. Ojo: Safari (y
 * por tanto todo el iPhone) exige un gesto del usuario para pedir una llave, así
 * que ahí el intento automático falla en el acto —a propósito, para que ninguna
 * web pueda lanzarte la cámara sin que la toques—. Cuando eso pasa, toda la
 * pantalla queda como zona pulsable: un toque en cualquier sitio y va directo a
 * Face ID, sin la hoja de «elige una llave».
 */
function Bloqueo({ onAbrir }: { onAbrir: () => void }) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const yaIntentado = useRef(false);

  const desbloquear = useCallback(
    async (silencioso = false) => {
      if (busy) return; // una petición de llave a la vez: dos a la vez fallan
      setBusy(true);
      setError('');
      try {
        await entrarConPasskey(true); // renueva la sesión de paso
        marcarActividad();
        onAbrir();
      } catch (e) {
        const err = e as Error;
        // NotAllowedError = cancelado por el usuario o falta el gesto: no es
        // nada que contarle, se queda la pantalla esperando el toque.
        if (!silencioso && err.name !== 'NotAllowedError') {
          setError(err.message || 'No se pudo desbloquear');
        }
      } finally {
        setBusy(false);
      }
    },
    [busy, onAbrir],
  );

  useEffect(() => {
    if (yaIntentado.current) return;
    yaIntentado.current = true;
    void desbloquear(true);
    // solo al montar: si el navegador lo permite, Face ID sale sin tocar nada
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="lock-wrap">
      <button className="lock-tap" onClick={() => desbloquear()} aria-label="Desbloquear con Face ID">
        <div className="lock-card">
          <div className="brand">Aa</div>
          <p className="muted" style={{ fontSize: 14, margin: 0 }}>
            {busy ? 'Comprobando…' : 'Portal bloqueado'}
          </p>
          <span className="lock-hint">{busy ? '' : 'Toca para entrar con Face ID'}</span>
          {error && <div className="error-msg">{error}</div>}
        </div>
      </button>
      <button
        className="btn ghost sm lock-alt"
        onClick={() => {
          clearToken();
          window.location.href = '/login';
        }}
      >
        Entrar con contraseña
      </button>
    </div>
  );
}

export default function Layout() {
  const [bloqueado, setBloqueado] = useState(() => tocaBloquear());

  // Se marca actividad mientras usas el portal, y al volver de segundo plano
  // se comprueba si toca pedir la cara otra vez.
  useEffect(() => {
    if (!bloqueado) marcarActividad();
    const alVolver = () => {
      if (document.visibilityState === 'visible') {
        if (tocaBloquear()) setBloqueado(true);
        else marcarActividad();
      } else {
        marcarActividad();
      }
    };
    const tic = setInterval(() => {
      if (document.visibilityState === 'visible' && !bloqueado) marcarActividad();
    }, 60_000);
    document.addEventListener('visibilitychange', alVolver);
    return () => {
      document.removeEventListener('visibilitychange', alVolver);
      clearInterval(tic);
    };
  }, [bloqueado]);

  if (bloqueado) return <Bloqueo onAbrir={() => setBloqueado(false)} />;

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">Aa</div>
        {MODULES.map((m) => (
          <SidebarItem key={m.id} mod={m} />
        ))}
        <div className="spacer" />
        <NavLink to="/roadmap" className={({ isActive }) => `nav-item subtle${isActive ? ' active' : ''}`}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 4l-5 2v14l5-2 6 2 5-2V4l-5 2-6-2z" />
            <path d="M9 4v14M15 6v14" />
          </svg>
          <span>Road Map</span>
        </NavLink>
        <NavLink to="/configuracion" className={({ isActive }) => `nav-item subtle${isActive ? ' active' : ''}`}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z" />
          </svg>
          <span>Configuración</span>
        </NavLink>
      </aside>

      <main className="main">
        <Outlet />
      </main>

      <BottomBar />
    </div>
  );
}
