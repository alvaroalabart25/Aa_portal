import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { patch } from '../lib/api';
import { usePerfil } from '../lib/perfil';

/**
 * La guía contextual de primera vez.
 *
 * Responde a dos preguntas, en su momento y sin túnel de pasos:
 *  - «Acabo de entrar, ¿qué tengo que hacer?» → la bienvenida, UNA vez.
 *  - «¿Qué puedo hacer aquí?» → un aviso corto la primera vez que se pisa cada
 *    pantalla: la idea principal y tres o cuatro cosas que se pueden hacer.
 *
 * Lo visto se guarda POR USUARIO en el servidor (users.guided_seen):
 * reinstalar la PWA o cambiar de móvil no repite el tour. Cerrar el aviso
 * (botón o tocando fuera) lo marca visto: un aviso que reaparece es un pesado.
 */
interface Aviso {
  id: string;
  /** rutas donde salta; 'prefijo:' delante para casar por prefijo */
  rutas: string[];
  titulo: string;
  idea: string;
  puntos: string[];
  boton?: string;
}

const GUIAS: Aviso[] = [
  {
    id: 'bienvenida',
    rutas: [], // especial: salta donde estés, la primera vez de todas
    titulo: 'Esto es tu portal',
    idea: 'Aquí organizas tu día a día: agenda, metas, salud y finanzas, cada cosa en su sitio.',
    puntos: [
      'Muévete con la barra de abajo. La primera vez que entres en cada pantalla, te contará qué puedes hacer en ella.',
      'Empieza por la Agenda: es donde se ve qué toca hoy.',
      'En Configuración › Módulos enciendes solo lo que vayas a usar.',
    ],
    boton: 'Vamos',
  },
  {
    id: 'agenda',
    rutas: ['/agenda'],
    titulo: 'Agenda',
    idea: 'Qué toca, de un vistazo. Se abre en Macro: el mes entero.',
    puntos: [
      'Macro es para mirar: el mes de un vistazo.',
      'En la pestaña Agenda vives el día a día: las tareas se crean tocando su día.',
      'Eventos guarda las fechas señaladas: cumpleaños, citas, plazos.',
    ],
  },
  {
    id: 'metas',
    rutas: ['/suenos'],
    titulo: 'Metas',
    idea: 'Lo que quieres conseguir, en tres tamaños.',
    puntos: [
      'Macro: las grandes, las que dan dirección.',
      'Micro: concretas y alcanzables; pueden colgar de una macro.',
      'Lista de deseos: lo que solo te separa el dinero.',
      'Toca cualquiera para ver su ficha, y súbelas o bájalas de nivel cuando cambien de tamaño.',
    ],
  },
  {
    id: 'proyectos',
    rutas: ['/proyectos'],
    titulo: 'Proyectos',
    idea: 'Los espacios agrupan; los proyectos son lo que se trabaja.',
    puntos: [
      'Crea un espacio (Trabajo, Personal…) y cuelga proyectos dentro.',
      'Cada proyecto lleva sus tareas y su avance.',
      'Las tareas con fecha aparecen solas en la Agenda.',
    ],
  },
  {
    id: 'tareas',
    rutas: ['/tareas'],
    titulo: 'Tareas',
    idea: 'Todas tus tareas juntas, vengan del proyecto que vengan.',
    puntos: [
      'Filtra, completa y edita sin entrar proyecto a proyecto.',
      'Las que tienen fecha salen también en la Agenda.',
    ],
  },
  {
    id: 'salud-objetivos',
    rutas: ['/salud/objetivos'],
    titulo: 'Objetivo & Analíticas',
    idea: 'A dónde vas con tu salud, y si los números acompañan.',
    puntos: [
      'Declara tu fase y tus metas medibles (peso, marcas de ejercicio).',
      'Apunta aquí el pesaje: se mide contra tu objetivo.',
      'La Cobertura te dice qué musculatura se te queda sin trabajar.',
      'Los condicionantes (lesiones) avisan luego mientras entrenas.',
    ],
  },
  {
    id: 'gimnasio',
    rutas: ['/gimnasio'],
    titulo: 'Gimnasio',
    idea: 'Tu rutina: montarla, seguirla y apuntarla.',
    puntos: [
      'Entrenar te dice qué día toca; ahí apuntas las series mientras entrenas.',
      'En Rutina montas tus sesiones y declaras el objetivo de cada una.',
      'Ejercicios es el catálogo: cada uno guarda tu PR y tu historial.',
      'Desde Rutina puedes compartir sesiones con otra cuenta mediante una key.',
    ],
  },
  {
    id: 'rutina',
    rutas: ['/rutina'],
    titulo: 'Rutina',
    idea: 'El plan de tu día a día. Está en obras: se está simplificando.',
    puntos: [
      'Mi día: tus checks y la plantilla semanal.',
      'Eventos: el catálogo de actividades, compartido con el Diario.',
    ],
  },
  {
    id: 'diario',
    rutas: ['/diario'],
    titulo: 'Diario',
    idea: 'Tu día real, apuntado en toques.',
    puntos: [
      'El peso y las marcas del día, en un toque; el peso alimenta Objetivo & Analíticas.',
      'Checks diarios para lo que quieres cumplir.',
      'La radiografía: tus actividades del día en una línea de tiempo.',
    ],
  },
  {
    id: 'finanzas',
    rutas: ['prefijo:/autonomo'],
    titulo: 'Finanzas',
    idea: 'Facturas y cuentas, con Hacienda a la vista.',
    puntos: [
      'Facturas: emítelas y llévalas por empresa.',
      'Cuentas: tus números y los resúmenes trimestrales.',
      'Los plazos fiscales avisan con un mes de antelación.',
    ],
  },
  {
    id: 'configuracion',
    rutas: ['/configuracion'],
    titulo: 'Configuración',
    idea: 'Tu cuenta y tu seguridad.',
    puntos: [
      'Seguridad: contraseña, segundo factor y códigos de recuperación.',
      'Módulos: enciende y apaga apartados del portal.',
      'Notificaciones: activa los avisos en este dispositivo.',
    ],
  },
];

function coincide(g: Aviso, pathname: string): boolean {
  return g.rutas.some((r) => (r.startsWith('prefijo:') ? pathname.startsWith(r.slice(8)) : pathname === r));
}

export default function Guia() {
  const { perfil } = usePerfil();
  const { pathname } = useLocation();
  // El estado local manda desde que carga: así marcar una guía no obliga a
  // repedir el perfil entero, y el aviso no parpadea.
  const [vistas, setVistas] = useState<Set<string> | null>(null);

  useEffect(() => {
    if (perfil && vistas === null) setVistas(new Set(perfil.guiadoVisto));
  }, [perfil, vistas]);

  if (!perfil || vistas === null) return null;

  const actual = !vistas.has('bienvenida')
    ? GUIAS[0]
    : (GUIAS.find((g) => g.id !== 'bienvenida' && coincide(g, pathname) && !vistas.has(g.id)) ?? null);
  if (!actual) return null;

  function entendido() {
    const nuevas = new Set(vistas);
    nuevas.add(actual!.id);
    setVistas(nuevas);
    // fuego y olvido: si falla, lo peor que pasa es volver a ver un aviso
    patch('/auth/me', { guiadoVisto: [...nuevas] }).catch(() => {});
  }

  return (
    <div className="guia-velo" onClick={entendido}>
      <div className="guia" role="dialog" aria-label={actual.titulo} onClick={(e) => e.stopPropagation()}>
        <p className="guia-eti">Primera vez aquí</p>
        <h3>{actual.titulo}</h3>
        <p className="guia-idea">{actual.idea}</p>
        <ul className="guia-puntos">
          {actual.puntos.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
        <button className="btn guia-btn" onClick={entendido}>
          {actual.boton ?? 'Entendido'}
        </button>
      </div>
    </div>
  );
}
