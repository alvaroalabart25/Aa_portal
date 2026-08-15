import { useEffect, useState } from 'react';
import { isLoggedIn } from '../lib/auth';
import { usePerfil } from '../lib/perfil';

/**
 * La pantalla de arranque: se ve mientras el portal pregunta quién eres.
 *
 * Con la API despierta dura décimas de segundo. Cuando el servidor gratuito
 * estaba dormido puede durar medio minuto, y ahí está la segunda mitad de esta
 * pantalla: a los cuatro segundos se dice la verdad («lo estoy despertando»)
 * en vez de dejar un spinner mudo que parece un cuelgue. No se puede saber si
 * eres «el primero del día» —solo que está tardando—, así que se dice eso.
 *
 * El GIF es suyo (su web), pequeño y abajo a la derecha, como él lo pidió.
 */
export default function Arranque() {
  const { cargando } = usePerfil();
  const [lento, setLento] = useState(false);

  useEffect(() => {
    if (!cargando) return;
    const t = window.setTimeout(() => setLento(true), 4000);
    return () => window.clearTimeout(t);
  }, [cargando]);

  // sin sesión no hay nada que esperar: al login sin ceremonia
  if (!cargando || !isLoggedIn()) return null;

  return (
    <div className="arranque" role="status" aria-label="Cargando el portal">
      <span className="arranque-brand">Aa</span>
      {lento && (
        <p className="arranque-msg">
          El servidor gratuito se duerme cuando nadie lo usa.
          <br />
          Lo estoy despertando: unos segundos…
        </p>
      )}
      <img className="arranque-gif" src="/arranque.gif" alt="" />
    </div>
  );
}
