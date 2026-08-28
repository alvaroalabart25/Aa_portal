import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { abrir, alCambiar, cerrar, hayPase, type Ambito } from '../lib/pase';
import { passkeysSoportadas } from '../lib/passkeys';

/**
 * La segunda puerta: lo de dentro no se enseña hasta pasar Face ID.
 *
 * Envuelve una pantalla entera. Mientras esté cerrada no se pinta nada de lo de
 * dentro —ni un titular ni una cifra— y, sobre todo, no se pide nada a la API:
 * el servidor tampoco lo daría, porque el pase se exige allí.
 *
 * Al salir de la pantalla se cierra sola. Volver a entrar vuelve a pedir la
 * cara, que es justo lo que se espera de algo cerrado con llave.
 */
export default function Cerrojo({
  ambito,
  titulo,
  explicacion,
  children,
}: {
  ambito: Ambito;
  titulo: string;
  explicacion: string;
  children: ReactNode;
}) {
  const [abierto, setAbierto] = useState(hayPase(ambito));
  const [abriendo, setAbriendo] = useState(false);
  const [error, setError] = useState('');
  const [sinLlave, setSinLlave] = useState(false);

  useEffect(() => alCambiar(() => setAbierto(hayPase(ambito))), [ambito]);
  useEffect(() => () => cerrar(ambito), [ambito]);

  async function pedir(otroDispositivo = false) {
    setAbriendo(true);
    setError('');
    setSinLlave(false);
    try {
      await abrir(ambito, otroDispositivo);
      setAbierto(true);
    } catch (e) {
      const err = e as Error;
      // Los navegadores dicen lo mismo para dos cosas distintas: que has
      // cancelado, o que en ESTE aparato no hay ninguna llave del portal.
      if (err.name === 'NotAllowedError') setSinLlave(true);
      else setError(`${err.name ? `${err.name}: ` : ''}${err.message || 'No se pudo abrir'}`);
    } finally {
      setAbriendo(false);
    }
  }

  if (abierto) return <>{children}</>;

  return (
    <div className="pe-cerrado">
      <span className="pe-candado" aria-hidden="true">
        ⌘
      </span>
      <h1>{titulo}</h1>
      <p className="muted">{explicacion}</p>

      {passkeysSoportadas() ? (
        <>
          <button className="btn" disabled={abriendo} onClick={() => pedir()}>
            {abriendo ? 'Abriendo…' : 'Abrir con Face ID'}
          </button>
          <button className="pe-otro" disabled={abriendo} onClick={() => pedir(true)}>
            Usar otro dispositivo
          </button>
        </>
      ) : (
        <p className="muted">
          Este navegador no tiene Face ID. Entra desde el móvil o registra una llave en Configuración.
        </p>
      )}

      {sinLlave && (
        <p className="pe-ayuda">
          Este aparato no tiene ninguna llave de acceso del portal. Registra una aquí —te pedirá Touch ID y tarda diez
          segundos— o firma con el iPhone desde «Usar otro dispositivo».
          <br />
          <Link to="/configuracion">Añadir una llave en este dispositivo →</Link>
        </p>
      )}
      {error && <p className="error-msg">{error}</p>}
    </div>
  );
}
