import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useArrastre } from '../dreams/reorder';
import { agruparSuperseries } from './api';

/**
 * Los ejercicios de una sesión, reordenables arrastrando.
 *
 * La unidad de arrastre es el GRUPO: un ejercicio suelto, o una superserie
 * entera con su etiqueta. Una superserie no se puede partir arrastrando — sus
 * miembros van pegados porque se ejecutan alternados, y separarlos con el dedo
 * sería romperla sin querer.
 *
 * Reordenar es cosmético: no viaja a las cuentas vinculadas (regla suya).
 */
interface Unidad<T> {
  id: number;
  items: T[];
}

export function ListaOrdenable<T extends { id: number; supersetId?: number | null }>({
  ejercicios,
  onOrden,
  conAsa = true,
  etiqueta = 'Superserie · alternados',
  children,
}: {
  ejercicios: T[];
  onOrden: (ids: number[]) => Promise<unknown>;
  /** false = solo lectura (sesión cerrada): sin asas y sin arrastre */
  conAsa?: boolean;
  etiqueta?: string;
  children: (e: T, asa: ReactNode | null) => ReactNode;
}) {
  const [unidades, setUnidades] = useState<Unidad<T>[]>(() =>
    agruparSuperseries(ejercicios).map((g) => ({ id: g[0].id, items: g })),
  );

  // qué ejercicios contiene cada unidad, para aplanar al guardar
  const miembrosRef = useRef(new Map<number, number[]>());
  miembrosRef.current = new Map(unidades.map((u) => [u.id, u.items.map((i) => i.id)]));

  const arrastre = useArrastre(unidades, setUnidades, (ids) =>
    onOrden(ids.flatMap((uid) => miembrosRef.current.get(uid) ?? [])),
  );

  // si los datos cambian por fuera (añadir, quitar, vincular), se resincroniza;
  // nunca a mitad de arrastre, que pisaría lo que llevas movido
  useEffect(() => {
    if (arrastre.activo != null) return;
    setUnidades(agruparSuperseries(ejercicios).map((g) => ({ id: g[0].id, items: g })));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ejercicios]);

  const asaDe = (id: number): ReactNode =>
    conAsa ? (
      <button
        className="gy-asa"
        aria-label="Reordenar"
        onPointerDown={(e) => arrastre.onPointerDown(e, id)}
        onPointerMove={arrastre.onPointerMove}
        onPointerUp={arrastre.onPointerUp}
        onPointerCancel={arrastre.onPointerUp}
      >
        ⠿
      </button>
    ) : null;

  return (
    <>
      {unidades.map((u) =>
        u.items.length > 1 ? (
          <div key={u.id} data-rid={u.id} className={`ss-grupo${arrastre.activo === u.id ? ' arrastrando' : ''}`}>
            <div className="ss-eti-fila">
              <span className="ss-etiqueta">{etiqueta}</span>
              {asaDe(u.id)}
            </div>
            {u.items.map((e) => children(e, null))}
          </div>
        ) : (
          <div key={u.id} data-rid={u.id} className={`gy-ord${arrastre.activo === u.id ? ' arrastrando' : ''}`}>
            {children(u.items[0], asaDe(u.id))}
          </div>
        ),
      )}
    </>
  );
}
