import type { ReactElement } from 'react';

// ⭐ REGISTRO DE MÓDULOS del portal.
// Añadir un módulo nuevo = crear src/modules/<x>/ y añadir UNA entrada aquí.
// El shell (sidebar + barra inferior móvil) se pinta solo a partir de esto.
// Un módulo puede ser un enlace directo (path) o un grupo desplegable (children).

export interface PortalLink {
  id: string;
  title: string;
  path: string;
  icon: ReactElement;
}

export interface PortalModule {
  id: string;
  title: string;
  icon: ReactElement;
  path?: string;
  children?: PortalLink[];
}

const stroke = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;

const icons = {
  agenda: (
    <svg width="18" height="18" viewBox="0 0 24 24" {...stroke}>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M3 10h18M8 3v4M16 3v4" />
    </svg>
  ),
  org: (
    <svg width="18" height="18" viewBox="0 0 24 24" {...stroke}>
      <rect x="8" y="3" width="8" height="6" rx="1.5" />
      <rect x="3" y="15" width="8" height="6" rx="1.5" />
      <rect x="13" y="15" width="8" height="6" rx="1.5" />
      <path d="M12 9v3M7 15v-3h10v3" />
    </svg>
  ),
  spaces: (
    <svg width="16" height="16" viewBox="0 0 24 24" {...stroke}>
      <rect x="3" y="3" width="8" height="8" rx="1.5" />
      <rect x="13" y="3" width="8" height="8" rx="1.5" />
      <rect x="3" y="13" width="8" height="8" rx="1.5" />
      <rect x="13" y="13" width="8" height="8" rx="1.5" />
    </svg>
  ),
  projects: (
    <svg width="16" height="16" viewBox="0 0 24 24" {...stroke}>
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    </svg>
  ),
  tasks: (
    <svg width="16" height="16" viewBox="0 0 24 24" {...stroke}>
      <path d="M4 6h2M4 12h2M4 18h2M10 6h10M10 12h10M10 18h10" />
    </svg>
  ),
  autonomo: (
    <svg width="18" height="18" viewBox="0 0 24 24" {...stroke}>
      <path d="M14 3v4a1 1 0 0 0 1 1h4" />
      <path d="M17 21H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7l5 5v11a2 2 0 0 1-2 2z" />
      <path d="M9 13h4M9 17h6" />
    </svg>
  ),
};

export const MODULES: PortalModule[] = [
  { id: 'agenda', title: 'Agenda', path: '/agenda', icon: icons.agenda },
  {
    id: 'org',
    title: 'Organización',
    icon: icons.org,
    children: [
      { id: 'spaces', title: 'Espacios', path: '/espacios', icon: icons.spaces },
      { id: 'projects', title: 'Proyectos', path: '/proyectos', icon: icons.projects },
      { id: 'tasks', title: 'Tareas', path: '/tareas', icon: icons.tasks },
    ],
  },
  { id: 'autonomo', title: 'Autónomo', path: '/autonomo', icon: icons.autonomo },
  // (futuro) { id: 'wiki', title: 'Wiki', ... },
];
