# Aa Portal

Portal web personal de organización. Empieza como un **gestor de tareas** y está
diseñado para crecer (proyectos, etiquetas, notas…) sin rehacer nada.

- **Uso:** personal, un solo usuario.
- **Tipo:** aplicación web (portal) instalable como **PWA** en el móvil.
- **Sincronización** PC ↔ móvil vía backend + base de datos.

## Stack

| Capa | Tecnología |
|---|---|
| Frontend | React + Vite + PWA (TypeScript) |
| Backend | Node.js + Express (API REST, TypeScript) |
| ORM | Drizzle |
| Base de datos | MySQL |
| Hosting | Raiola Networks (cPanel), subdominio `portal.alvaroalabart.com` |

## Estructura

```
Aa_portal/
├── client/   # React + Vite + PWA
└── server/   # Node + Express + Drizzle
```

> 🚧 Proyecto en construcción. Instrucciones de arranque local y despliegue en
> cPanel se añadirán cuando el esqueleto esté montado.
