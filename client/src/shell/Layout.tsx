import { useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { clearToken } from '../lib/auth';
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

export default function Layout() {
  const navigate = useNavigate();

  function logout() {
    clearToken();
    navigate('/login');
  }

  // En móvil (barra inferior) los grupos se aplanan: Agenda + Espacios + Proyectos + Tareas
  const flatLinks = MODULES.flatMap((m) => (m.children ? m.children : [{ id: m.id, title: m.title, path: m.path!, icon: m.icon }]));

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">Aa</div>
        {MODULES.map((m) => (
          <SidebarItem key={m.id} mod={m} />
        ))}
        <div className="spacer" />
        <button className="btn ghost sm" onClick={logout}>
          Cerrar sesión
        </button>
      </aside>

      <main className="main">
        <Outlet />
      </main>

      <nav className="bottombar">
        {flatLinks.map((l) => (
          <NavLink key={l.id} to={l.path} className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}>
            {l.icon}
            <span>{l.title}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
