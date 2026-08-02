import type { ReactElement } from 'react';

// ⭐ REGISTRO DE MÓDULOS del portal.
// Añadir un módulo nuevo = crear src/modules/<x>/ y añadir UNA entrada aquí.
// El shell (sidebar + barra inferior móvil) se pinta solo a partir de esto.
// Un módulo puede ser un enlace directo (path) o un grupo desplegable (children).

export interface PortalLink {
  id: string;
  title: string;
  path: string;
  // Para páginas con pestañas internas (Metas): el enlace lleva a una pestaña
  // concreta y el menú se marca activo comparando también esta parte.
  search?: string;
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

// Nube de pensamiento en el mismo trazo monocromo que el resto: el emoji 💭 a
// color rompería la coherencia visual del menú.
const iconoMetas = (
  <svg width="18" height="18" viewBox="0 0 24 24" {...stroke}>
    <path d="M9 15.5h7a3.4 3.4 0 0 0 .4-6.8 4.5 4.5 0 0 0-8.6-1.4A3.5 3.5 0 0 0 9 15.5z" />
    <circle cx="6" cy="19" r="1.5" />
    <circle cx="3.2" cy="21.4" r="0.9" />
  </svg>
);

const iconoSub = (d: string) => (
  <svg width="16" height="16" viewBox="0 0 24 24" {...stroke}>
    <path d={d} />
  </svg>
);

/**
 * Orden de la barra inferior del móvil, que NO es el del menú lateral.
 *
 * En el ordenador manda la jerarquía (las metas primero, que es lo que da
 * sentido al resto). En el móvil manda la frecuencia: se abre para ver qué toca
 * hoy, así que delante va lo del día a día y las metas quedan en cuarto lugar.
 * Lo que no esté aquí va detrás, en el orden en que esté declarado.
 */
export const ORDEN_MOVIL = ['agenda', 'org', 'salud', 'suenos'];

export const MODULES: PortalModule[] = [
  { id: 'agenda', title: 'Agenda', path: '/agenda', icon: icons.agenda },
  {
    id: 'suenos',
    title: 'Metas',
    icon: iconoMetas,
    children: [
      {
        id: 'macro',
        title: 'Macrometas',
        path: '/suenos',
        search: '?tab=macro',
        // montaña: lo grande y lejano
        icon: iconoSub('M3 19l6-9 4 5.5 2.5-3.5L21 19z'),
      },
      {
        id: 'micro',
        title: 'Micrometas',
        path: '/suenos',
        search: '?tab=micro',
        // diana: algo concreto y alcanzable
        icon: (
          <svg width="16" height="16" viewBox="0 0 24 24" {...stroke}>
            <circle cx="12" cy="12" r="8" />
            <circle cx="12" cy="12" r="3.2" />
          </svg>
        ),
      },
      {
        id: 'deseos',
        title: 'Lista de deseos',
        path: '/suenos',
        search: '?tab=deseos',
        icon: iconoSub('M5 5h14l-1.2 13a2 2 0 0 1-2 1.8H8.2a2 2 0 0 1-2-1.8zM9 5V3.8A2 2 0 0 1 11 2h2a2 2 0 0 1 2 1.8V5'),
      },
    ],
  },
  {
    id: 'salud',
    title: 'Salud',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" {...stroke}>
        <path d="M19.5 12.6 12 20l-7.5-7.4a5 5 0 1 1 7.5-6.6 5 5 0 1 1 7.5 6.6z" />
      </svg>
    ),
    children: [
      {
        id: 'diario',
        title: 'Diario',
        path: '/diario',
        icon: (
          <svg width="16" height="16" viewBox="0 0 24 24" {...stroke}>
            <path d="M3 12h4l2-6 4 12 2-6h6" />
          </svg>
        ),
      },
      {
        id: 'rutina',
        title: 'Rutina',
        path: '/rutina',
        icon: (
          <svg width="16" height="16" viewBox="0 0 24 24" {...stroke}>
            <path d="M3 12a9 9 0 1 0 3-6.7" />
            <path d="M3 3v5h5" />
            <path d="M12 7v5l3 3" />
          </svg>
        ),
      },
      // (futuro) { id: 'gimnasio', title: 'Gimnasio', path: '/gimnasio', ... },
    ],
  },
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
  {
    // El id y las rutas siguen siendo /autonomo: renombrar direcciones rompería
    // enlaces guardados sin ganar nada. Lo que cambia es el nombre visible.
    id: 'autonomo',
    title: 'Finanzas',
    icon: icons.autonomo,
    children: [
      {
        id: 'facturas',
        title: 'Facturas',
        path: '/autonomo/facturas',
        icon: (
          <svg width="16" height="16" viewBox="0 0 24 24" {...stroke}>
            <path d="M14 3v4a1 1 0 0 0 1 1h4" />
            <path d="M17 21H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7l5 5v11a2 2 0 0 1-2 2z" />
          </svg>
        ),
      },
      {
        id: 'cuentas',
        title: 'Cuentas',
        path: '/autonomo/cuentas',
        icon: (
          <svg width="16" height="16" viewBox="0 0 24 24" {...stroke}>
            <rect x="4" y="3" width="16" height="18" rx="2" />
            <path d="M8 7h8M8 11h3M8 15h3M13 11h3M13 15h3" />
          </svg>
        ),
      },
    ],
  },
  // (futuro) { id: 'wiki', title: 'Wiki', ... },
];
