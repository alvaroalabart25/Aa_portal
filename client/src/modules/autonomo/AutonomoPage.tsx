import { useSearchParams } from 'react-router-dom';
import type { ReactNode } from 'react';
import FacturasTab from './FacturasTab';
import EmpresasTab from './EmpresasTab';
import CuentasTab from './CuentasTab';
import TrimestralesTab from './TrimestralesTab';
import { EventsRadar } from '../events/components';
import { RADAR_DIAS_FISCAL } from '../events/types';
import { OjoPrivacidad } from './dinero';

/**
 * Autónomo: el papeleo, en una sola pantalla.
 *
 * Antes eran dos entradas de menú —Facturas y Cuentas— con dos pestañas cada
 * una. Contestan a lo mismo: la parte administrativa de ser autónomo. Ahora es
 * una entrada con dos niveles, y el de abajo se pinta MÁS LIGERO a propósito:
 * dos filas de pestañas iguales en un móvil no dejan claro cuál manda.
 *
 * La pestaña vive en la dirección (?tab y ?sub), así que recargar no te
 * devuelve al principio y se puede enlazar a un sitio concreto. Las direcciones
 * viejas siguen valiendo: /autonomo/cuentas redirige aquí.
 */

interface Sub {
  id: string;
  titulo: string;
  pinta: () => ReactNode;
}

interface Seccion {
  id: string;
  titulo: string;
  lema: string;
  sub: Sub[];
}

const SECCIONES: Seccion[] = [
  {
    id: 'facturas',
    titulo: 'Facturas',
    lema: 'Tus facturas emitidas y las empresas a las que facturas, con los plazos de Hacienda a la vista.',
    sub: [
      { id: 'emitidas', titulo: 'Emitidas', pinta: () => <FacturasTab /> },
      { id: 'empresas', titulo: 'Empresas', pinta: () => <EmpresasTab /> },
    ],
  },
  {
    id: 'cuentas',
    titulo: 'Cuentas',
    lema: 'Tus números: lo cobrado, lo gastado y el cierre de cada trimestre.',
    sub: [
      { id: 'movimientos', titulo: 'Movimientos', pinta: () => <CuentasTab /> },
      { id: 'cierres', titulo: 'Cierres', pinta: () => <TrimestralesTab /> },
    ],
  },
];

export default function AutonomoPage() {
  const [params, setParams] = useSearchParams();
  const seccion = SECCIONES.find((s) => s.id === params.get('tab')) ?? SECCIONES[0];
  const sub = seccion.sub.find((s) => s.id === params.get('sub')) ?? seccion.sub[0];

  // Al cambiar de sección se entra por su primera subpestaña: mantener la de
  // antes no significaría nada, porque no existen las mismas en las dos.
  const ir = (tab: string, subId?: string) => {
    const destino = SECCIONES.find((s) => s.id === tab) ?? SECCIONES[0];
    setParams({ tab: destino.id, sub: subId ?? destino.sub[0].id }, { replace: true });
  };

  return (
    <div>
      <div className="page-head">
        <h1>Autónomo</h1>
        <div className="seg" role="tablist">
          {SECCIONES.map((s) => (
            <button
              key={s.id}
              role="tab"
              aria-selected={s.id === seccion.id}
              className={s.id === seccion.id ? 'active' : ''}
              onClick={() => ir(s.id)}
            >
              {s.titulo}
            </button>
          ))}
        </div>
        <OjoPrivacidad />
      </div>

      <p className="page-sub">{seccion.lema}</p>

      {/* los plazos de Hacienda sí interesan con un mes de antelación */}
      <EventsRadar scope="autonomo" dias={RADAR_DIAS_FISCAL} />

      {/* Las subpestañas van pegadas a lo que cambian, debajo de lo que no
          cambia (el lema y los plazos), que es de la sección entera. */}
      <div className="subseg" role="tablist">
        {seccion.sub.map((s) => (
          <button
            key={s.id}
            role="tab"
            aria-selected={s.id === sub.id}
            className={s.id === sub.id ? 'active' : ''}
            onClick={() => ir(seccion.id, s.id)}
          >
            {s.titulo}
          </button>
        ))}
      </div>

      {sub.pinta()}
    </div>
  );
}
