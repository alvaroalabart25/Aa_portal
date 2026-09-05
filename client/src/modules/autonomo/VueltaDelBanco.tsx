import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { bancoApi } from './api';

/**
 * La vuelta del banco: cerrar el permiso que acabas de dar, y nada más.
 *
 * Vive FUERA del cerrojo de Finanzas a propósito. Al volver de la web del
 * banco la pestaña se ha recargado entera, así que el pase —que vive en
 * memoria— ya no está, y el cerrojo pedía Face ID justo aquí: en medio de un
 * código de un solo uso que está caducando. Si la cara tardaba, fallaba o se
 * cancelaba, la autorización recién concedida se moría en la puerta.
 *
 * Y no hace falta: esta pantalla no enseña nada. Ni saldos, ni movimientos, ni
 * facturas. Solo canjea un código que el banco acaba de darte —con tu sesión
 * abierta, que eso sí se exige— y te manda a Finanzas, que ahí sí pide la cara
 * antes de enseñar un solo número.
 */
export default function VueltaDelBanco() {
  const [params] = useSearchParams();
  const [estado, setEstado] = useState<'canjeando' | 'hecho' | 'error'>('canjeando');
  const [mensaje, setMensaje] = useState('');
  // El código es de un solo uso: si se canjea dos veces, el segundo intento
  // falla. En desarrollo React monta los efectos dos veces, así que se marca.
  const hecho = useRef(false);

  useEffect(() => {
    if (hecho.current) return;
    hecho.current = true;

    // El banco también puede devolverte con un no.
    const fallo = params.get('error');
    if (fallo) {
      setEstado('error');
      setMensaje(`El banco no completó la autorización: ${params.get('error_description') || fallo}`);
      return;
    }

    const code = params.get('code');
    const state = params.get('state');
    if (!code || !state) {
      setEstado('error');
      setMensaje('Esta dirección es la vuelta del banco, y ha llegado sin el permiso.');
      return;
    }

    bancoApi
      .vuelta(code, state)
      .then((r) => {
        setEstado('hecho');
        setMensaje(`${r.cuentas} ${r.cuentas === 1 ? 'cuenta conectada' : 'cuentas conectadas'}.`);
      })
      .catch((e) => {
        setEstado('error');
        setMensaje((e as Error).message);
      });
  }, [params]);

  return (
    <div className="vb">
      <h1>{estado === 'canjeando' ? 'Conectando el banco…' : estado === 'hecho' ? 'Banco conectado' : 'No se pudo conectar'}</h1>

      {estado === 'canjeando' && <p className="muted">Cerrando el permiso que acabas de dar. Un segundo.</p>}

      {estado === 'hecho' && (
        <>
          <p className="muted">{mensaje}</p>
          <p className="muted">Los saldos y los movimientos están en Finanzas, que te pedirá Face ID al entrar.</p>
        </>
      )}

      {estado === 'error' && <p className="error-msg">{mensaje}</p>}

      {estado !== 'canjeando' && (
        <Link className="btn" to="/autonomo/banco">
          Ir a Finanzas
        </Link>
      )}
    </div>
  );
}
