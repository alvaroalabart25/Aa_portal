import { useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { clearToken, setToken } from '../lib/auth';
import { post } from '../lib/api';
import { MODULES, type PortalModule } from './modules';

function SidebarItem({ mod }: { mod: PortalModule }) {
  const location = useLocation();
  const hasActiveChild = mod.children?.some((c) => location.pathname.startsWith(c.path)) ?? false;
  const [open, setOpen] = useState(true);

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
        <span style={hasActiveChild ? { color: 'var(--ink)', fontWeight: 600 } : undefined}>{mod.title}</span>
        <span className={`chev${open ? ' open' : ''}`}>›</span>
      </button>
      {open && (
        <div className="nav-children">
          {mod.children.map((c) => (
            <NavLink key={c.id} to={c.path} className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}>
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
// raíz = Agenda + grupos; al tocar un grupo se muestran sus hijos (+ Agenda y volver).
function BottomBar() {
  const [group, setGroup] = useState<string | null>(null);
  const agenda = MODULES.find((m) => !m.children)!;
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
        {agendaLink}
        {groups.map((g) => (
          <button key={g.id} className="nav-item" onClick={() => setGroup(g.id)}>
            {g.icon}
            <span>{g.title}</span>
          </button>
        ))}
        <NavLink to="/notificaciones" onClick={() => setGroup(null)} className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
            <path d="M13.7 21a2 2 0 0 1-3.4 0" />
          </svg>
          <span>Avisos</span>
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
          <NavLink key={c.id} to={c.path} className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}>
            {c.icon}
            <span>{c.title}</span>
          </NavLink>
        ))}
    </nav>
  );
}

export default function Layout() {
  const navigate = useNavigate();

  function logout() {
    clearToken();
    navigate('/login');
  }

  // Invalida los tokens de todos los dispositivos y renueva el de este, para
  // que un móvil perdido o una sesión robada dejen de servir al instante.
  async function revokeAll() {
    if (!confirm('¿Cerrar la sesión en todos los dispositivos? Tendrás que volver a entrar en el resto (aquí no).')) return;
    try {
      const r = await post<{ token: string }>('/auth/revoke-all', {});
      setToken(r.token);
      alert('Hecho: las demás sesiones ya no valen.');
    } catch {
      alert('No se ha podido completar. Inténtalo de nuevo.');
    }
  }

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">Aa</div>
        {MODULES.map((m) => (
          <SidebarItem key={m.id} mod={m} />
        ))}
        <div className="spacer" />
        <NavLink to="/notificaciones" className={({ isActive }) => `nav-item subtle${isActive ? ' active' : ''}`}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
            <path d="M13.7 21a2 2 0 0 1-3.4 0" />
          </svg>
          <span>Notificaciones</span>
        </NavLink>
        <NavLink to="/roadmap" className={({ isActive }) => `nav-item subtle${isActive ? ' active' : ''}`}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 4l-5 2v14l5-2 6 2 5-2V4l-5 2-6-2z" />
            <path d="M9 4v14M15 6v14" />
          </svg>
          <span>Road Map</span>
        </NavLink>
        <button className="btn ghost sm" onClick={logout}>
          Cerrar sesión
        </button>
        <button className="nav-item subtle" onClick={revokeAll} title="Invalida la sesión en cualquier otro dispositivo">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
            <rect x="4" y="10" width="16" height="11" rx="2" />
            <path d="M8 10V7a4 4 0 0 1 8 0v3" />
          </svg>
          <span>Cerrar en todos</span>
        </button>
      </aside>

      <main className="main">
        <Outlet />
      </main>

      <BottomBar />
    </div>
  );
}
