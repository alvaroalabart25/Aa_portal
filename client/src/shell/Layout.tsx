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

      <BottomBar />
    </div>
  );
}
