import React from 'react';
import ReactDOM from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import App from './App';
import './styles.css';

/**
 * El service worker se actualiza solo al desplegar, pero eso NO recarga lo que
 * ya está en pantalla: el trabajador nuevo toma el mando y la página sigue
 * ejecutando el código viejo hasta la siguiente carga completa. En una PWA
 * instalada eso puede ser nunca —al volver del selector de apps se restaura la
 * pantalla, no se recarga—, y se queda con una versión de hace días.
 *
 * Recargar al relevo lo arregla, pero es una escopeta apuntando al pie: mal
 * hecho, deja la app dando vueltas sin llegar a cargar nunca. Dos seguros:
 *
 * 1. Solo se recarga si YA había un trabajador al mando. La primera vez que se
 *    instala no había nada viejo que refrescar, y ese relevo inicial es el que
 *    dispara el bucle si no se distingue.
 * 2. Una recarga por sesión como mucho, apuntada en sessionStorage. Aunque
 *    algo se tuerza, no puede repetirse.
 */
registerSW({ immediate: true });

if ('serviceWorker' in navigator) {
  const habiaControlador = Boolean(navigator.serviceWorker.controller);
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!habiaControlador) return;
    if (sessionStorage.getItem('aa_recargado_por_sw')) return;
    sessionStorage.setItem('aa_recargado_por_sw', '1');
    window.location.reload();
  });
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
