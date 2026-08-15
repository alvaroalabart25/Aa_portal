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
    idea:
      'Tu central de organización personal: la agenda del día, tus metas, tu salud y tus finanzas viven aquí, ' +
      'cada una en su sitio y conectadas entre sí.',
    puntos: [
      'Navega por las distintas pestañas para entender en qué consiste cada una: la primera vez que entres en una pantalla, un aviso como este te contará qué puedes hacer en ella.',
      'Muévete con la barra de abajo (o con el menú lateral en pantalla grande).',
      'En Configuración › Módulos eliges qué apartados quieres tener encendidos.',
    ],
    boton: 'Vamos',
  },
  {
    id: 'agenda',
    rutas: ['/agenda'],
    titulo: 'Agenda',
    idea:
      'La Agenda es donde miras el tiempo: qué tienes entre manos este mes, qué toca esta semana y qué fechas ' +
      'no se te pueden pasar.',
    puntos: [
      'Macro: la foto del mes — tus objetivos mensuales y su avance, para mirar sin editar.',
      'Agenda: el día a día de la semana; toca un día para crearle una tarea.',
      'Eventos: cumpleaños, citas y plazos, con sus avisos.',
    ],
  },
  {
    id: 'metas',
    rutas: ['/suenos'],
    titulo: 'Metas',
    idea:
      'Aquí viven las cosas que quieres conseguir, ordenadas por tamaño: las grandes dan dirección y las ' +
      'pequeñas se pueden tachar.',
    puntos: [
      'Macro: las metas grandes, las que marcan hacia dónde vas.',
      'Micro: pasos concretos y alcanzables; pueden colgar de una macro o ir sueltas.',
      'Lista de deseos: cosas que te apetecen y que solo dependen del dinero.',
      'Toca cualquiera para abrir su ficha; si cambia de tamaño, súbela o bájala de nivel.',
    ],
  },
  {
    id: 'proyectos',
    rutas: ['/proyectos'],
    titulo: 'Proyectos',
    idea:
      'El trabajo con nombre y apellidos: cada proyecto con sus tareas y su avance, agrupados en espacios ' +
      'para separar contextos (trabajo, personal, un cliente…).',
    puntos: [
      'Crea un espacio por contexto y cuelga dentro sus proyectos.',
      'Entra en un proyecto para ver y crear sus tareas.',
      'Las tareas con fecha aparecen solas en la Agenda: aquí se organiza, allí se ve cuándo.',
    ],
  },
  {
    id: 'tareas',
    rutas: ['/tareas'],
    titulo: 'Tareas',
    idea:
      'La vista transversal: todas las tareas de todos tus proyectos en una sola tabla, para repasar y ' +
      'despachar sin ir proyecto por proyecto.',
    puntos: [
      'Filtra por estado o proyecto y marca hechas sin cambiar de pantalla.',
      'Las que tienen fecha salen también en la Agenda.',
    ],
  },
  {
    id: 'salud-objetivos',
    rutas: ['/salud/objetivos'],
    titulo: 'Objetivo & Analíticas',
    idea:
      'El cuadro de mando de tu salud: declaras a dónde quieres llegar y el portal mide contra eso — tu peso ' +
      'contra tu meta, tu rutina contra la musculatura que quieres cubrir.',
    puntos: [
      'Declara tu fase (hipertrofia, fuerza, definición…) y tus metas medibles.',
      'Apunta aquí el pesaje: la gráfica lo compara con tu objetivo.',
      'La Cobertura te enseña qué músculos trabajas y cuáles se te quedan fuera.',
      'Apunta tus condicionantes (lesiones): avisarán mientras entrenas.',
    ],
  },
  {
    id: 'gimnasio',
    rutas: ['/gimnasio'],
    titulo: 'Gimnasio',
    idea:
      'Aquí montas tu rutina y la sigues: el portal te dice qué sesión toca, tú apuntas las series, y todo ' +
      'queda registrado para tu historial y tus PR.',
    puntos: [
      'Entrenar: te dice qué sesión toca y ahí apuntas series, pesos y descansos.',
      'Rutina: monta tus sesiones, declara el objetivo de cada una y ajusta lo que haga falta.',
      'Ejercicios: el catálogo; cada ejercicio guarda tu PR, tu historial y tus notas.',
      '¿Entrenas con alguien? Comparte sesiones por key y sus cambios os llegarán como sugerencias.',
    ],
  },
  {
    id: 'rutina',
    rutas: ['/rutina'],
    titulo: 'Rutina',
    idea:
      'El plan de cómo quieres que sea tu día a día. Está en obras: la idea es que se alimente de lo que el ' +
      'Diario ya registra, en vez de escribirlo todo a mano.',
    puntos: [
      'Mi día: tus checks y la plantilla semanal.',
      'Eventos: el catálogo de actividades, compartido con el Diario.',
    ],
  },
  {
    id: 'diario',
    rutas: ['/diario'],
    titulo: 'Diario',
    idea:
      'La otra mitad del plan: la realidad. Aquí queda lo que de verdad haces cada día — el peso, los checks ' +
      'y tus actividades — con el mínimo esfuerzo posible.',
    puntos: [
      'Apunta el peso y las marcas del día en un toque; el peso alimenta tu objetivo en Analíticas.',
      'Checks diarios: lo que quieres cumplir cada día, para marcarlo y ver la racha.',
      'La radiografía: tus actividades del día pintadas en una línea de tiempo.',
    ],
  },
  {
    id: 'finanzas',
    rutas: ['prefijo:/autonomo'],
    titulo: 'Finanzas',
    idea:
      'La parte de autónomo sin sustos: tus facturas emitidas, tus números por trimestre y los plazos de ' +
      'Hacienda siempre a la vista.',
    puntos: [
      'Facturas: créalas, envíalas y llévalas ordenadas por empresa.',
      'Cuentas: lo cobrado, lo gastado y los resúmenes trimestrales.',
      'Los plazos fiscales avisan con un mes de antelación.',
    ],
  },
  {
    id: 'configuracion',
    rutas: ['/configuracion'],
    titulo: 'Configuración',
    idea: 'Todo lo que es de tu cuenta y no del contenido: cómo entras, qué apartados usas y qué avisos recibes.',
    puntos: [
      'Seguridad: contraseña, segundo factor y códigos de recuperación.',
      'Módulos: enciende y apaga apartados del portal a tu medida.',
      'Notificaciones: activa los avisos push en este dispositivo.',
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
