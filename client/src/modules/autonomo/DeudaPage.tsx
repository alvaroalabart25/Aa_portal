import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { obligacionesApi, type DeudaFicha } from './api';
import { OjoPrivacidad, useDinero } from './dinero';

/**
 * La ficha de una deuda y su cuadro de amortización.
 *
 * El cuadro tiene dos mitades que NO se pueden confundir: lo que ya pasó —los
 * pagos que el portal reconoce en el banco, más el bloque declarado de antes de
 * que hubiera histórico— y lo que queda, que es una proyección.
 *
 * Y como la cuota se puede cambiar, la proyección se recalcula aquí mismo: el
 * valor de esta pantalla no es ver el pasado, es ver cuánto se adelanta el final
 * si un mes se paga más. Con una deuda al 0% esa es la única decisión que hay.
 */


const mesLargo = (iso: string) =>
  new Date(iso).toLocaleDateString('es-ES', { month: 'long', year: 'numeric' });

const mesCorto = (iso: string) =>
  new Date(iso).toLocaleDateString('es-ES', { month: 'short', year: '2-digit' });

interface Fila {
  etiqueta: string;
  /** la fecha real de la fila prevista, para poder decir el mes en que acaba */
  iso?: string;
  importe: number;
  pendiente: number;
  real: boolean;
}

/** Las cuotas que tiene sentido probar, además de la suya. */
const CUOTAS = [150, 250, 300, 400, 580];

export default function DeudaPage() {
  const { eur } = useDinero();
  const { id } = useParams();
  const navigate = useNavigate();
  const [d, setD] = useState<DeudaFicha | null>(null);
  const [error, setError] = useState('');
  const [cuota, setCuota] = useState<number | null>(null);

  useEffect(() => {
    obligacionesApi
      .deuda(Number(id))
      .then((x) => {
        setD(x);
        setCuota(x.mensual);
      })
      .catch((e) => setError((e as Error).message));
  }, [id]);

  const cuadro = useMemo<Fila[]>(() => {
    if (!d || !cuota) return [];
    const filas: Fila[] = [];
    let pendiente = Math.round(d.total * 100);

    // 1. Lo declarado: pagado antes de que el banco tuviera histórico
    if (d.declarado.importe > 0) {
      pendiente -= Math.round(d.declarado.importe * 100);
      filas.push({
        etiqueta: `hasta ${mesCorto(d.declarado.hasta)} · declarado`,
        importe: d.declarado.importe,
        pendiente: pendiente / 100,
        real: true,
      });
    }

    // 2. Lo real, agrupado por mes: sus pagos no son de 150 clavados
    const porMes = new Map<string, number>();
    for (const p of d.pagos) {
      const k = p.fecha.slice(0, 7);
      porMes.set(k, (porMes.get(k) ?? 0) + Math.round(p.importe * 100));
    }
    for (const [mes, importe] of [...porMes].sort()) {
      pendiente -= importe;
      filas.push({ etiqueta: mesCorto(`${mes}-01`), importe: importe / 100, pendiente: pendiente / 100, real: true });
    }

    // 3. Lo que queda, a la cuota que se esté probando
    const ultimoReal = [...porMes.keys()].sort().pop() ?? d.declarado.hasta.slice(0, 7);
    const cursor = new Date(`${ultimoReal}-01T00:00:00Z`);
    const cuotaCent = Math.round(cuota * 100);
    let vueltas = 0;
    while (pendiente > 0 && vueltas < 600) {
      cursor.setUTCMonth(cursor.getUTCMonth() + 1);
      const pago = Math.min(cuotaCent, pendiente);
      pendiente -= pago;
      filas.push({
        etiqueta: mesCorto(cursor.toISOString().slice(0, 10)),
        iso: cursor.toISOString().slice(0, 10),
        importe: pago / 100,
        pendiente: pendiente / 100,
        real: false,
      });
      vueltas += 1;
    }
    return filas;
  }, [d, cuota]);

  if (error) return <div className="error-msg">{error}</div>;
  if (!d || !cuota) return <p className="muted">Cargando la deuda…</p>;

  const pendienteHoy = cuadro.filter((f) => f.real).pop()?.pendiente ?? d.total;
  const pagadoHoy = d.total - pendienteHoy;
  const porcentaje = Math.round((100 * pagadoHoy) / d.total);
  const previstas = cuadro.filter((f) => !f.real);
  const fin = previstas[previstas.length - 1];

  return (
    <div>
      <div className="page-head">
        <h1>{d.nombre}</h1>
        <OjoPrivacidad />
      </div>
      <p className="page-sub">
        Debes {eur(pendienteHoy)} € de {eur(d.total)} €, desde {mesLargo(d.desde)}.
      </p>

      <section className="section mc-bloque oscuro">
        <span className="wg-etiqueta">Pendiente</span>
        <b className="wg-grande">{eur(pendienteHoy)} €</b>
        <span className="wg-pie">de {eur(d.total)} € · {porcentaje}% pagado</span>
        <div className="ob-barra" aria-hidden style={{ marginTop: 16 }}>
          <div style={{ width: `${porcentaje}%` }} />
        </div>
        <p className="ob-nota">
          {fin?.iso
            ? `A ${eur(cuota)} €/mes queda saldada en ${mesLargo(fin.iso)}.`
            : 'Ya está saldada.'}
        </p>
      </section>

      <section className="section mc-bloque">
        <div className="mc-head">
          <h2>Si pagas al mes…</h2>
        </div>
        <div className="dp-cuotas">
          {[...new Set([d.mensual, ...CUOTAS])].sort((a, b) => a - b).map((c) => (
            <button key={c} className={c === cuota ? 'active' : ''} onClick={() => setCuota(c)}>
              {eur(c).replace(',00', '')} €
            </button>
          ))}
        </div>
        <p className="ob-nota">
          {cuota === d.mensual
            ? 'Es lo que pagas hoy.'
            : `${eur(cuota - d.mensual)} € más al mes que ahora. Adelanta el final ${adelanto(cuadro, d)} meses.`}
        </p>
      </section>

      <section className="section mc-bloque">
        <div className="mc-head">
          <h2>Cuadro de amortización</h2>
          <span className="ob-cuando">{cuadro.length} filas</span>
        </div>
        <div className="dp-tabla">
          <div className="dp-cab">
            <span>Mes</span>
            <span>Pago</span>
            <span>Pendiente</span>
          </div>
          {cuadro.map((f, i) => (
            <div key={`${f.etiqueta}-${i}`} className={`dp-fila${f.real ? ' real' : ''}`}>
              <span>{f.etiqueta}</span>
              <span>{eur(f.importe)}</span>
              <span>{eur(f.pendiente)}</span>
            </div>
          ))}
        </div>
        <p className="ob-nota">En negro lo pagado, en gris la previsión.</p>
      </section>

      <button className="btn ghost sm" style={{ marginTop: 8 }} onClick={() => navigate('/autonomo/obligaciones')}>
        ← Obligaciones
      </button>
    </div>
  );
}

/** Cuántos meses se adelanta el final respecto a la cuota de hoy. */
function adelanto(cuadro: Fila[], d: DeudaFicha): number {
  const pendiente = cuadro.filter((f) => f.real).pop()?.pendiente ?? d.total;
  const conSuCuota = Math.ceil(pendiente / d.mensual);
  const ahora = cuadro.filter((f) => !f.real).length;
  return Math.max(0, conSuCuota - ahora);
}
