import { useCallback, useEffect, useState } from 'react';
import { EditorRico } from '../tasks/components';
import { notasApi, type Nota, type TipoDeFicha } from './api';

/**
 * Las notas de una tarea o de un proyecto, fechadas.
 *
 * Una caja de texto única dice qué pasa; esto dice CÓMO HA IDO. Lo de hace tres
 * semanas y lo de ayer dejan de ser el mismo párrafo, que era justo lo que
 * impedía leer el histórico de una tarea larga.
 *
 * Mismas reglas que el bloc, porque es el mismo gesto: arriba siempre el de
 * hoy, listo para escribir aunque esté vacío —es al que vienes—; los días
 * anteriores debajo, con su fecha; y un día sin nada escrito no existe, así que
 * vaciar un apunte lo borra.
 *
 * Si vuelves a escribir el mismo día, sigues el apunte de ese día en vez de
 * abrir otro: son las notas de UN día, no cada vez que abriste la ficha.
 */

/** «2026-08-25» → «Lunes, 25 de agosto» */
function diaLargo(iso: string): string {
  const t = new Date(`${iso}T12:00:00`).toLocaleDateString('es-ES', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
  return t.charAt(0).toUpperCase() + t.slice(1);
}

export default function Bitacora({ tipo, id }: { tipo: TipoDeFicha; id: number }) {
  const [hoy, setHoy] = useState('');
  const [notas, setNotas] = useState<Nota[]>([]);
  const [etiqueta, setEtiqueta] = useState('');

  const cargar = useCallback(async () => {
    const d = await notasApi.ficha(tipo, id);
    setHoy(d.hoy);
    setNotas(d.notas);
  }, [tipo, id]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  if (!hoy) return null;

  const deHoy = notas.find((n) => n.fecha === hoy);
  const anteriores = notas.filter((n) => n.fecha !== hoy);

  async function guardar(fecha: string, texto: string) {
    await notasApi.guardarFicha(tipo, id, fecha, texto);
    // La lista se refresca en silencio: un apunte nuevo tiene que aparecer en
    // el histórico, y uno vaciado tiene que desaparecer de él.
    await cargar();
  }

  return (
    <div className="section bit">
      <div className="bit-cab">
        <h2>Notas</h2>
        <span className="muted bit-guardado">{etiqueta}</span>
      </div>

      <div className="bit-dia">
        <span className="bit-fecha">
          {diaLargo(hoy)} <em>hoy</em>
        </span>
        <EditorRico
          key={hoy}
          value={deHoy?.texto ?? null}
          onSave={(texto) => guardar(hoy, texto)}
          onEstado={setEtiqueta}
          placeholder="Cómo ha ido, qué falta, con quién has hablado…"
        />
      </div>

      {anteriores.map((n) => (
        <div key={n.fecha} className="bit-dia">
          <span className="bit-fecha">{diaLargo(n.fecha)}</span>
          <EditorRico value={n.texto} onSave={(texto) => guardar(n.fecha, texto)} barra="alEnfocar" />
        </div>
      ))}
    </div>
  );
}
