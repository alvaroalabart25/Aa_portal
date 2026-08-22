import React from 'react';
import ReactDOM from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import App from './App';
import './styles.css';

/**
 * El service worker se actualiza solo al desplegar, pero eso NO recarga lo que
 * ya está en pantalla: el trabajador nuevo toma el mando y la página sigue
 * ejecutando el código viejo hasta la siguiente carga completa. En una PWA
 * instalada en el móvil eso puede ser nunca —al volver del selector de apps se
 * restaura la pantalla, no se recarga—, y se queda con una versión de hace
 * días sin enterarse.
 *
 * Así que cuando el trabajador nuevo toma el mando, se recarga una vez. El
 * pestillo evita el bucle: sin él, la recarga dispara otro relevo y otra
 * recarga.
 */
registerSW({ immediate: true });

if ('serviceWorker' in navigator) {
  let recargando = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (recargando) return;
    recargando = true;
    window.location.reload();
  });
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
