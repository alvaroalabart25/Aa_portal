import { useCallback, useEffect, useRef, useState } from 'react';
import { bancoApi, type FiltroMovimientos, type PaginaMovimientos } from './api';
import { useDinero } from './dinero';

/**
 * El libro de movimientos, con filtros.
 *
 * Ordenado por fecha porque es como se busca de verdad («eso fue por agosto»),
 * y se puede dar la vuelta o pasar a importe para encontrar lo gordo. Filtrar y
 * buscar se hacen en el SERVIDOR: hoy son 344 movimientos y en dos años serán
 * 4.000, que no caben en un móvil.
 *
 * Los filtros que se ofrecen salen de sus datos, no de una lista inventada: si
 * no tiene ninguna comisión, no aparece el filtro de comisiones.
 *
 * Cada gasto lleva su categoría y se puede cambiar AQUÍ, en la misma línea, sin
 * abrir nada: corregir uno corrige todos los del mismo comercio y se guarda
 * como regla. Ese es el trato —él corrige una vez, el portal aprende— y es lo
 * único que evita que esto acabe abandonado como cualquier hoja de gastos.
 */


/** Santander mete el número completo de la tarjeta en el concepto. */
const sinNumerosLargos = (t: string) => t.replace(/\d{8,}/g, (n) => `···${n.slice(-4)}`);

export default function MovimientosTab() {
  const { eur } = useDinero();
  const [pag, setPag] = useState<PaginaMovimientos | null>(null);
  const [filtro, setFiltro] = useState<FiltroMovimientos>({ orden: 'fecha', dir: 'desc', limite: 50 });
  const [texto, setTexto] = useState('');
  const [cargando, setCargando] = useState(true);
  const [aviso, setAviso] = useState('');
  const debounce = useRef<number>();

  const cargar = useCallback((f: FiltroMovimientos) => {
    setCargando(true);
    bancoApi
      .movimientos(f)
      .then(setPag)
      .catch(() => setPag(null))
      .finally(() => setCargando(false));
  }, []);

  useEffect(() => cargar(filtro), [filtro, cargar]);

  // La búsqueda espera a que dejes de teclear: una consulta por letra sobraría
  function buscar(v: string) {
    setTexto(v);
    window.clearTimeout(debounce.current);
    debounce.current = window.setTimeout(() => setFiltro((f) => ({ ...f, q: v, pagina: 0 })), 350);
  }

  const cambiar = (parcial: FiltroMovimientos) => setFiltro((f) => ({ ...f, ...parcial, pagina: 0 }));

  /** Corregir la categoría de uno: arrastra a todos los del mismo comercio. */
  async function categorizar(id: number, valor: string) {
    const r = await bancoApi.categorizar(id, valor || null).catch(() => null);
    if (!r) return setAviso('No se ha podido guardar');
    setAviso(r.regla ? `Guardado: todo lo de ${r.regla.toLowerCase()} va ahí` : 'Guardado');
    window.setTimeout(() => setAviso(''), 4000);
    cargar(filtro);
  }

  return (
    <div>
      <input
        className="mv-buscar"
        type="search"
        value={texto}
        placeholder="Buscar en conceptos y nombres…"
        onChange={(e) => buscar(e.target.value)}
      />

      <div className="mv-filtros">
        <select value={filtro.banco ?? ''} onChange={(e) => cambiar({ banco: e.target.value })}>
          <option value="">Todos los bancos</option>
          {pag?.bancos.map((b) => (
            <option key={b} value={b}>
              {b}
            </option>
          ))}
        </select>

        <select value={filtro.tipo ?? ''} onChange={(e) => cambiar({ tipo: e.target.value })}>
          <option value="">Todos los tipos</option>
          {pag?.tipos.map((t) => (
            <option key={t.tipo} value={t.tipo}>
              {t.nombre} ({t.n})
            </option>
          ))}
        </select>

        <select value={filtro.categoria ?? ''} onChange={(e) => cambiar({ categoria: e.target.value })}>
          <option value="">Todas las categorías</option>
          {pag?.categorias
            .filter((c) => c.n > 0)
            .map((c) => (
              <option key={c.categoria} value={c.categoria}>
                {c.nombre} ({c.n})
              </option>
            ))}
        </select>

        <button
          className={`mv-toggle${filtro.traspasos ? ' active' : ''}`}
          onClick={() => cambiar({ traspasos: filtro.traspasos ? undefined : 1 })}
        >
          {filtro.traspasos ? 'Ocultar traspasos' : 'Ver traspasos'}
        </button>

        <select
          value={`${filtro.orden}-${filtro.dir}`}
          onChange={(e) => {
            const [orden, dir] = e.target.value.split('-') as ['fecha' | 'importe', 'asc' | 'desc'];
            cambiar({ orden, dir });
          }}
        >
          <option value="fecha-desc">Más recientes</option>
          <option value="fecha-asc">Más antiguos</option>
          <option value="importe-desc">Importe, de mayor a menor</option>
          <option value="importe-asc">Importe, de menor a mayor</option>
        </select>
      </div>

      <p className="mv-cuantos">
        {cargando ? 'Buscando…' : `${pag?.total ?? 0} movimientos`}
        {!cargando && !filtro.traspasos && !filtro.tipo && <span>sin contar traspasos</span>}
        {(filtro.banco || filtro.tipo || filtro.categoria || filtro.q || filtro.traspasos) && !cargando && (
          <button
            className="mv-limpiar"
            onClick={() => {
              setTexto('');
              setFiltro({ orden: 'fecha', dir: 'desc', limite: 50 });
            }}
          >
            quitar filtros
          </button>
        )}
      </p>

      {aviso && <p className="mv-aviso">{aviso}</p>}

      {pag && pag.movimientos.length === 0 && !cargando && (
        <p className="muted mc-vacio">Ningún movimiento con esos filtros.</p>
      )}

      <div className="bk-movs">
        {pag?.movimientos.map((m) => (
          <div key={m.id} className="bk-mov">
            <span className="bk-mov-f">{m.fecha ? `${m.fecha.slice(8, 10)}/${m.fecha.slice(5, 7)}` : '—'}</span>
            <span className="bk-mov-t">
              <b>{sinNumerosLargos(m.contraparte || m.concepto || 'Movimiento')}</b>
              <span className="bk-mov-c">
                {m.tipoNombre && <em className="bk-mov-tipo">{m.tipoNombre}</em>}
                {m.banco}
                {m.cuentaIban && ` ···${m.cuentaIban}`}
              </span>
              {m.direccion === 'DBIT' && m.tipo !== 'traspaso' && (
                /* La etiqueta la pinta el <span> y el <select> va encima,
                   invisible: si se estilara el select, se estiraría hasta el
                   ancho de su opción más larga y la línea quedaría ocupada por
                   una pastilla de medio móvil. */
                <span className={`bk-mov-cat${m.categoria ? '' : ' vacia'}`}>
                  {m.categoriaNombre ?? 'Sin categoría'}
                  <select
                    aria-label="Categoría"
                    value={m.categoria ?? ''}
                    onChange={(e) => categorizar(m.id, e.target.value)}
                  >
                    <option value="">Sin categoría</option>
                    {pag?.categorias
                      .filter((c) => c.categoria !== 'sin')
                      .map((c) => (
                        <option key={c.categoria} value={c.categoria}>
                          {c.nombre}
                        </option>
                      ))}
                  </select>
                </span>
              )}
            </span>
            <span className={`bk-mov-i ${m.direccion === 'CRDT' ? 'entra' : 'sale'}`}>
              {m.direccion === 'CRDT' ? '+' : '−'}
              {eur(Number(m.importe))}
            </span>
          </div>
        ))}
      </div>

      {pag && pag.total > pag.movimientos.length + pag.pagina * pag.limite && (
        <button
          className="btn ghost sm"
          style={{ marginTop: 12 }}
          onClick={() => setFiltro((f) => ({ ...f, limite: (f.limite ?? 50) + 50 }))}
        >
          Ver más
        </button>
      )}
    </div>
  );
}
