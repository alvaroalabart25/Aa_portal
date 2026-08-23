import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
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
 *
 * En la segunda pestaña, los pagos TAL CUAL están en el banco. El cuadro de
 * arriba agrupa por mes y redondea la historia; esto es el rastro: qué día, de
 * qué cuenta y con qué concepto. Es lo que se mira cuando un mes no cuadra.
 */


const mesLargo = (iso: string) =>
  new Date(iso).toLocaleDateString('es-ES', { month: 'long', year: 'numeric' });

const mesCorto = (iso: string) =>
  new Date(iso).toLocaleDateString('es-ES', { month: 'short', year: '2-digit' });

const diaCorto = (iso: string) =>
  new Date(iso).toLocaleDateString('es-ES', { day: '2-digit', month: 'short' });

interface Fila {
  etiqueta: string;
  /** la fecha real de la fila prevista, para poder decir el mes en que acaba */
  iso?: string;
  importe: number;
  pendiente: number;
  real: boolean;
}

/** Santander mete el número completo de la tarjeta dentro del concepto. */
const sinNumerosLargos = (t: string) => t.replace(/\d{8,}/g, (n) => `···${n.slice(-4)}`);

/**
 * Del «BIZUM A FAVOR DE Jorge Enrique Alabart Ferrer CONCEPTO: ventilador» solo
 * interesa lo último: en esta pantalla el destinatario es el título, repetirlo
 * en cada línea tapa lo único que cambia, que es en concepto de qué se pagó.
 */
function soloElConcepto(t: string): string {
  const m = /CONCEPTO:\s*(.+)$/i.exec(t);
  return sinNumerosLargos((m ? m[1] : t).trim()) || 'Pago';
}

/** Las cuotas que tiene sentido probar, además de la suya. */
const CUOTAS = [150, 250, 300, 400, 580];

export default function DeudaPage() {
  const { eur } = useDinero();
  const { id } = useParams();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') === 'movimientos' ? 'movimientos' : 'cuadro';
  const [d, setD] = useState<DeudaFicha | null>(null);
  const [error, setError] = useState('');
  const [cuota, setCuota] = useState<number | null>(null);
  // qué pago se está acotando y con qué valor
  const [editando, setEditando] = useState<number | null>(null);
  const [valor, setValor] = useState('');

  const cargar = useCallback(
    (primeraVez = false) =>
      obligacionesApi
        .deuda(Number(id))
        .then((x) => {
          setD(x);
          if (primeraVez) setCuota(x.mensual);
        })
        .catch((e) => setError((e as Error).message)),
    [id],
  );

  useEffect(() => {
    void cargar(true);
  }, [cargar]);

  /**
   * Guardar cuánto de un pago era deuda. Vacío = vuelve a contar entero, que es
   * la salida cuando uno se equivoca acotando.
   */
  async function guardarParte(pagoId: number) {
    const limpio = valor.trim().replace(',', '.');
    const importe = limpio === '' ? null : Number(limpio);
    setEditando(null);
    if (importe !== null && (!Number.isFinite(importe) || importe < 0)) return;
    await obligacionesApi.parteDeuda(Number(id), pagoId, importe).catch((e) => setError((e as Error).message));
    await cargar();
  }

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

    // 2. Lo real, agrupado por mes: sus pagos no son de 150 clavados, y de
    //    algunos solo una parte amortiza —el resto era otra cosa que le pagó
    const porMes = new Map<string, number>();
    for (const p of d.pagos) {
      if (p.aDeuda <= 0) continue;
      const k = p.fecha.slice(0, 7);
      porMes.set(k, (porMes.get(k) ?? 0) + Math.round(p.aDeuda * 100));
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
  const salidoDelBanco = d.pagos.reduce((a, p) => a + p.importe, 0);
  const amortizado = d.pagos.reduce((a, p) => a + p.aDeuda, 0);
  const fin = previstas[previstas.length - 1];

  return (
    <div>
      <div className="page-head">
        <h1>{d.nombre}</h1>
        <div className="page-acciones">
          <div className="seg" role="tablist">
            {(['cuadro', 'movimientos'] as const).map((t) => (
              <button
                key={t}
                role="tab"
                aria-selected={tab === t}
                className={tab === t ? 'active' : ''}
                onClick={() => setParams(t === 'cuadro' ? {} : { tab: t }, { replace: true })}
              >
                {t === 'cuadro' ? 'Cuadro' : 'Movimientos'}
              </button>
            ))}
          </div>
          <OjoPrivacidad />
        </div>
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

      {tab === 'movimientos' ? (
        <section className="section mc-bloque">
          <div className="mc-head">
            <h2>Los pagos, como están en el banco</h2>
            <span className="ob-cuando">
              {d.pagos.length} {d.pagos.length === 1 ? 'pago' : 'pagos'} · {eur(amortizado)} €
              {amortizado !== salidoDelBanco && ` de ${eur(salidoDelBanco)} €`}
            </span>
          </div>

          {d.pagos.length === 0 ? (
            <p className="muted mc-vacio">
              Ningún pago reconocido desde {mesLargo(d.declarado.hasta)}. Se reconocen por el concepto, así que si
              pagaste de otra forma no aparece aquí.
            </p>
          ) : (
            <div className="bk-movs">
              {[...d.pagos].reverse().map((p) => (
                <div key={p.id} className="bk-mov">
                  <span className="bk-mov-f">{diaCorto(p.fecha)}</span>
                  <span className="bk-mov-t">
                    <b>{p.concepto ? soloElConcepto(p.concepto) : 'Pago'}</b>
                    <span className="bk-mov-c">
                      {p.tipo && <em className="bk-mov-tipo">{p.tipo}</em>}
                      {p.banco}
                      {p.cuenta && ` · ${p.cuenta}`}
                    </span>
                    {editando === p.id ? (
                      <span className="dp-parte-edit">
                        <input
                          type="text"
                          inputMode="decimal"
                          autoFocus
                          value={valor}
                          placeholder="todo"
                          onChange={(e) => setValor(e.target.value)}
                          onBlur={() => guardarParte(p.id)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') guardarParte(p.id);
                            if (e.key === 'Escape') setEditando(null);
                          }}
                        />
                        <em>€ de {eur(p.importe)} · vacío = entero</em>
                      </span>
                    ) : (
                      <button
                        className={`dp-parte${p.declarado ? ' acotado' : ''}`}
                        onClick={() => {
                          setEditando(p.id);
                          setValor(p.declarado ? String(p.aDeuda).replace('.', ',') : '');
                        }}
                      >
                        {!p.declarado
                          ? 'cuenta entero'
                          : p.aDeuda === 0
                            ? 'no es deuda'
                            : `solo ${eur(p.aDeuda)} € es deuda`}
                      </button>
                    )}
                  </span>
                  <span className={`bk-mov-i sale${p.aDeuda === 0 ? ' fuera' : ''}`}>−{eur(p.importe)}</span>
                </div>
              ))}
            </div>
          )}

          <p className="ob-nota">
            Los pagos se reconocen por el nombre, así que aquí entra <b>todo</b> lo que le mandas. Toca la etiqueta de
            cualquiera para decir cuánto de ese pago era deuda: el resto sigue siendo un gasto, pero deja de amortizar.
          </p>
          <p className="ob-nota">
            Antes de {mesLargo(d.declarado.hasta)} no hay rastro: el banco solo da 90 días. Los {eur(d.declarado.importe)}{' '}
            € anteriores están declarados por ti, no vistos.
          </p>
        </section>
      ) : (
        <>
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
        </>
      )}

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
