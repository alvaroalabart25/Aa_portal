import { useCallback, useEffect, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { tasksApi } from "./api";
import MelonesDeTarea from "../focus/MelonesDeTarea";
import { EditableTitle, KebabMenu, NotesBox, StatusSelect } from "./components";
import {
  avisaAplazada,
  AVISO_APLAZADA_EN_MARCHA,
  PRIORITY_LABEL,
  type Priority,
  type Task,
} from "./types";

function fechaCorta(iso: string): string {
  return new Date(iso).toLocaleDateString("es-ES", {
    day: "numeric",
    month: "long",
  });
}

export default function TaskPage() {
  const { id } = useParams();
  const taskId = Number(id);
  const navigate = useNavigate();
  // De dónde vienes, si quien te trajo lo dijo. Sin eso (entrar por dirección
  // directa, o recargar) se cae a la Agenda, que es de donde se viene casi
  // siempre.
  const location = useLocation();
  const volverA =
    (location.state as { volverA?: string } | null)?.volverA ?? null;

  const [task, setTask] = useState<Task | null>(null);

  const load = useCallback(async () => {
    setTask(await tasksApi.one(taskId));
  }, [taskId]);

  useEffect(() => {
    load();
  }, [load]);

  async function update(data: Partial<Task>) {
    await tasksApi.update(taskId, data);
    await load();
  }

  async function archive() {
    if (!confirm("¿Archivar esta tarea? Dejará de aparecer en las listas."))
      return;
    await tasksApi.archive(taskId);
    navigate(-1);
  }

  if (!task) return <p className="muted">Cargando…</p>;

  // El nombre del sitio se saca de la propia tarea cuando se puede: «‹ Web
  // Residencia» dice mucho más que «‹ Proyecto».
  const vuelta = !volverA
    ? { to: "/agenda?tab=agenda", etiqueta: "Agenda" }
    : volverA.startsWith("/proyectos/")
      ? { to: volverA, etiqueta: task.projectName || "Proyecto" }
      : volverA.startsWith("/proyectos")
        ? { to: volverA, etiqueta: "Proyectos" }
        : volverA.startsWith("/tareas")
          ? { to: volverA, etiqueta: "Tareas" }
          : volverA.startsWith("/macro")
            ? { to: volverA, etiqueta: "Macro" }
            : { to: volverA, etiqueta: "Agenda" };

  return (
    <div>
      {/* La cabecera: todo lo que ES la tarea, en negro. El volver lleva a
          DONDE VENÍAS —si entraste desde un proyecto, al proyecto: volver a la
          Agenda y rehacer el camino era lo farragoso—; sin origen conocido, a
          la pestaña Agenda. */}
      <div className="fh oscuro">
        <div className="tk-crumbs">
          <Link to={vuelta.to} className="btn ghost sm tk-back">
            ‹ {vuelta.etiqueta}
          </Link>
          <span className="fh-acciones">
            <KebabMenu
              items={[
                { label: "Eliminar tarea", danger: true, onClick: archive },
              ]}
            />
          </span>
        </div>

        <span className="fh-ruta">
          <span className="dot" style={{ background: task.spaceColor }} />
          <Link to="/proyectos">{task.spaceName}</Link>
          <span className="tk-sep">›</span>
          <Link to={`/proyectos/${task.projectId}`}>{task.projectName}</Link>
        </span>
        <EditableTitle
          value={task.title}
          onSave={async (title) => update({ title })}
        />

        <div className="ficha">
          <div>
            <label>Estado</label>
            <StatusSelect
              value={task.status}
              onChange={(status) => update({ status })}
            />
          </div>
          <div>
            <label htmlFor="t-priority">Prioridad</label>
            <select
              id="t-priority"
              value={task.priority}
              onChange={(e) => update({ priority: e.target.value as Priority })}
            >
              {Object.entries(PRIORITY_LABEL).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="t-due">Vencimiento</label>
            <input
              id="t-due"
              type="date"
              value={task.dueDate ?? ""}
              onChange={(e) => update({ dueDate: e.target.value || null })}
            />
          </div>
        </div>

        {/* Cuántas veces la he empujado hacia adelante. Debajo de la tira, no
            dentro: metido en la casilla de la fecha la estiraba tanto que la
            tira se partía en dos filas. No sale siempre —mover una tarea
            larga es normal, y avisar de eso sería ruido—; ver
            `avisaAplazada`. */}
        {avisaAplazada(task.status, task.postponedCount) && (
          <p
            className={`ficha-nota${
              (task.postponedCount ?? 0) >= AVISO_APLAZADA_EN_MARCHA
                ? " aviso"
                : ""
            }`}
          >
            Aplazada {task.postponedCount}{" "}
            {task.postponedCount === 1 ? "vez" : "veces"}
            {task.lastPostponedAt &&
              ` · la última, el ${fechaCorta(task.lastPostponedAt)}`}
          </p>
        )}
      </div>

      <MelonesDeTarea taskId={task.id} />

      <NotesBox
        value={task.notes ?? null}
        onSave={async (notes) => {
          await tasksApi.update(taskId, { notes });
        }}
      />
    </div>
  );
}
