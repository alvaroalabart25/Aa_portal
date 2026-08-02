import { API_BASE, del, get, patch, post } from '../../lib/api';
import type {
  Categoria,
  Deseo,
  DreamCard,
  DreamDetail,
  DreamImage,
  DreamKind,
  DreamLink,
  DreamStatus,
  DreamStep,
  Plantilla,
} from './types';

// La API devuelve rutas relativas para las imágenes; aquí se convierten en
// direcciones absolutas porque el front vive en otro dominio que la API.
export const imgUrl = (ruta: string) => `${API_BASE}${ruta}`;

export const dreamsApi = {
  categorias: () => get<Categoria[]>('/dreams/categories'),
  crearCategoria: (name: string, color: string) => post<Categoria>('/dreams/categories', { name, color }),
  editarCategoria: (id: number, data: { name?: string; color?: string }) =>
    patch<Categoria>(`/dreams/categories/${id}`, data),
  borrarCategoria: (id: number) => del<{ archived: boolean }>(`/dreams/categories/${id}`),

  plantillas: () => get<Plantilla[]>('/dreams/templates'),

  lista: (kind: DreamKind) => get<DreamCard[]>(`/dreams?kind=${kind}`),
  detalle: (id: number) => get<DreamDetail>(`/dreams/${id}`),
  crear: (data: { kind: DreamKind; title: string; template?: string; categoryId?: number | null; parentId?: number | null }) =>
    post<{ id: number }>('/dreams', data),
  editar: (
    id: number,
    data: Partial<{
      title: string;
      description: string | null;
      status: DreamStatus;
      categoryId: number | null;
      parentId: number | null;
      targetDate: string | null;
      costEstimated: string | null;
      costSaved: string | null;
    }>,
  ) => patch<DreamCard>(`/dreams/${id}`, data),
  borrar: (id: number) => del<{ archived: boolean }>(`/dreams/${id}`),
  reordenar: (ids: number[]) => post<{ ok: boolean }>('/dreams/reorder', { ids }),

  crearPaso: (dreamId: number, title: string) => post<DreamStep>(`/dreams/${dreamId}/steps`, { title }),
  editarPaso: (id: number, data: { title?: string; done?: boolean }) => patch<DreamStep>(`/dreams/steps/${id}`, data),
  borrarPaso: (id: number) => del<{ deleted: boolean }>(`/dreams/steps/${id}`),

  crearEnlace: (dreamId: number, data: { label: string; url: string; note?: string }) =>
    post<DreamLink>(`/dreams/${dreamId}/links`, data),
  borrarEnlace: (id: number) => del<{ deleted: boolean }>(`/dreams/links/${id}`),

  subirImagen: (dreamId: number, data: { mime: string; thumb: string; full: string }) =>
    post<DreamImage>(`/dreams/${dreamId}/images`, data),
  destacarImagen: (id: number) => post<{ ok: boolean }>(`/dreams/images/${id}/cover`, {}),
  borrarImagen: (id: number) => del<{ deleted: boolean }>(`/dreams/images/${id}`),

  deseos: () => get<{ pending: Deseo[]; bought: Deseo[]; total: string }>('/dreams/wishlist'),
  crearDeseo: (data: { title: string; price?: string | null; url?: string | null; categoryId?: number | null }) =>
    post<Deseo>('/dreams/wishlist', data),
  editarDeseo: (id: number, data: Partial<{ title: string; price: string | null; url: string | null; categoryId: number | null }>) =>
    patch<Deseo>(`/dreams/wishlist/${id}`, data),
  comprado: (id: number, bought: boolean) => post<Deseo>(`/dreams/wishlist/${id}/bought`, { bought }),
  borrarDeseo: (id: number) => del<{ archived: boolean }>(`/dreams/wishlist/${id}`),
  reordenarDeseos: (ids: number[]) => post<{ ok: boolean }>('/dreams/wishlist/reorder', { ids }),

  deseoASueno: (id: number) => post<{ dreamId: number }>(`/dreams/wishlist/${id}/to-dream`, {}),
  suenoADeseo: (id: number) => post<{ wishlistId: number }>(`/dreams/${id}/to-wishlist`, {}),
};

/**
 * Reduce una foto en el navegador antes de subirla. Dos tamaños: la miniatura
 * para la rejilla y una versión grande para el detalle.
 *
 * Esto es lo que hace viable guardar las imágenes en la propia base de datos:
 * una foto de móvil pesa 3-6 MB y de aquí sale en decenas de kilobytes. Al
 * servidor nunca le llega el archivo original.
 */
export async function reducirImagen(file: File): Promise<{ mime: string; thumb: string; full: string }> {
  const bitmap = await cargar(file);
  // WebP con transparencia y buena compresión; si el navegador no lo soporta
  // (Safari muy antiguo), toBlob devuelve PNG y se detecta por el tipo real.
  const thumbBlob = await escalar(bitmap, 500, 0.82);
  const fullBlob = await escalar(bitmap, 1500, 0.85);
  bitmap.close?.();
  return {
    mime: fullBlob.type === 'image/webp' ? 'image/webp' : 'image/png',
    thumb: await aBase64(thumbBlob),
    full: await aBase64(fullBlob),
  };
}

async function cargar(file: File): Promise<ImageBitmap> {
  if ('createImageBitmap' in window) return createImageBitmap(file);
  throw new Error('Este navegador no puede procesar imágenes');
}

async function escalar(bitmap: ImageBitmap, maxLado: number, calidad: number): Promise<Blob> {
  const escala = Math.min(1, maxLado / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * escala));
  const h = Math.max(1, Math.round(bitmap.height * escala));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('No se pudo preparar la imagen');
  ctx.drawImage(bitmap, 0, 0, w, h);
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('No se pudo convertir la imagen'))),
      'image/webp',
      calidad,
    );
  });
}

function aBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result).split(',')[1] ?? '');
    fr.onerror = () => reject(new Error('No se pudo leer la imagen'));
    fr.readAsDataURL(blob);
  });
}
