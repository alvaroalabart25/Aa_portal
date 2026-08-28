import { useRef, useState } from 'react';
import { autonomoApi } from './api';
import { reducirImagen } from '../dreams/api';

/**
 * El escaneo de una factura: la foto del móvil.
 *
 * `accept="image/*"` es lo que hace que el móvil ofrezca la galería y la cámara
 * en el mismo gesto. La foto se reduce EN EL NAVEGADOR antes de subirla —una de
 * móvil pesa 3-6 MB y de aquí salen decenas de kilobytes—, con la misma pieza
 * que usan las imágenes de Metas.
 *
 * El portal no lee lo que pone en la foto: los datos los escribe él. Esto es
 * el papel guardado, que es lo que acaba pidiendo el gestor.
 */
export function FotosDeFactura({
  facturaId,
  fotos,
  onCambio,
}: {
  facturaId: number;
  fotos: { id: number; thumbUrl: string; fullUrl: string }[];
  onCambio: () => void;
}) {
  const campo = useRef<HTMLInputElement>(null);
  const [subiendo, setSubiendo] = useState(false);
  const [error, setError] = useState('');

  async function elegida(archivos: FileList | null) {
    if (!archivos?.length) return;
    setSubiendo(true);
    setError('');
    try {
      for (const archivo of Array.from(archivos)) {
        const reducida = await reducirImagen(archivo);
        await autonomoApi.subirFoto(facturaId, reducida);
      }
      onCambio();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo subir');
    } finally {
      setSubiendo(false);
      if (campo.current) campo.current.value = '';
    }
  }

  return (
    <span className="fx-fotos" onClick={(e) => e.stopPropagation()}>
      {fotos.map((f) => (
        <a key={f.id} href={f.fullUrl} target="_blank" rel="noreferrer" className="fx-foto" title="Ver el escaneo">
          <img src={f.thumbUrl} alt="Escaneo de la factura" loading="lazy" />
          <button
            aria-label="Quitar el escaneo"
            title="Quitar el escaneo"
            onClick={async (e) => {
              e.preventDefault();
              await autonomoApi.borrarFoto(f.id);
              onCambio();
            }}
          >
            ✕
          </button>
        </a>
      ))}

      <button className="fx-anadir" disabled={subiendo} onClick={() => campo.current?.click()}>
        {subiendo ? 'Subiendo…' : fotos.length ? '+' : '+ Foto'}
      </button>
      <input
        ref={campo}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => elegida(e.target.files)}
      />
      {error && <em className="fx-error">{error}</em>}
    </span>
  );
}

/** Una foto ya reducida, esperando a que exista la factura a la que va. */
export type Escaneo = { mime: string; thumb: string; full: string };

/**
 * El mismo escaneo, pero ANTES de que la factura exista.
 *
 * Al dar de alta un gasto todavía no hay id al que colgar la foto, así que se
 * elige y se reduce aquí y se guarda en memoria; la ventana la sube en cuanto
 * el gasto está creado. Es lo que evita el «guarda, búscalo en la lista y ahora
 * sí, añade la foto», que con el papel en la mano es justo el momento en que se
 * pierde.
 */
export function EscaneosPendientes({
  escaneos,
  onCambio,
}: {
  escaneos: Escaneo[];
  onCambio: (e: Escaneo[]) => void;
}) {
  const campo = useRef<HTMLInputElement>(null);
  const [preparando, setPreparando] = useState(false);
  const [error, setError] = useState('');

  async function elegida(archivos: FileList | null) {
    if (!archivos?.length) return;
    setPreparando(true);
    setError('');
    try {
      const nuevas: Escaneo[] = [];
      for (const archivo of Array.from(archivos)) nuevas.push(await reducirImagen(archivo));
      onCambio([...escaneos, ...nuevas]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo preparar la imagen');
    } finally {
      setPreparando(false);
      if (campo.current) campo.current.value = '';
    }
  }

  return (
    <span className="fx-fotos">
      {escaneos.map((f, i) => (
        <span key={i} className="fx-foto">
          <img src={`data:${f.mime};base64,${f.thumb}`} alt="Escaneo de la factura" />
          <button
            type="button"
            aria-label="Quitar el escaneo"
            title="Quitar el escaneo"
            onClick={() => onCambio(escaneos.filter((_, j) => j !== i))}
          >
            ✕
          </button>
        </span>
      ))}

      <button type="button" className="fx-anadir" disabled={preparando} onClick={() => campo.current?.click()}>
        {preparando ? 'Preparando…' : escaneos.length ? '+' : '+ Foto'}
      </button>
      <input ref={campo} type="file" accept="image/*" multiple hidden onChange={(e) => elegida(e.target.files)} />
      {error && <em className="fx-error">{error}</em>}
    </span>
  );
}
