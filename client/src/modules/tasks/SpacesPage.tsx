import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { repartirPortadas } from '../../lib/portadas';
import { spacesApi } from './api';
import { AddSpaceModal } from './modals';
import type { Space } from './types';

// Espacios en tarjetas con portada: un espacio es un contexto entero de tu vida
// (un cliente, un área), y se reconoce antes por una imagen que por una fila.
export default function SpacesPage() {
  const [spaces, setSpaces] = useState<Space[]>([]);
  const [adding, setAdding] = useState(false);
  const navigate = useNavigate();

  const load = useCallback(async () => setSpaces(await spacesApi.list()), []);
  // reparto sin repetir dentro de la rejilla
  const portadas = useMemo(() => repartirPortadas(spaces.map((s) => s.id)), [spaces]);
  useEffect(() => {
    load();
  }, [load]);

  return (
    <div>
      <div className="page-head">
        <h1>Espacios</h1>
        <button className="btn" onClick={() => setAdding(true)}>
          + Añadir espacio
        </button>
      </div>

      {spaces.length === 0 ? (
        <div className="empty">Crea tu primer espacio (p. ej. «Autónomos»).</div>
      ) : (
        <div className="cg-grid">
          {spaces.map((s) => (
            <button key={s.id} className="cg-card" onClick={() => navigate(`/espacios/${s.id}`)}>
              <span className="cg-cover">
                <img src={portadas.get(s.id)} alt="" loading="lazy" />
                <span className="cg-badge">{s.activeProjects ?? 0} proyectos</span>
              </span>
              <span className="cg-body">
                <span className="cg-title">
                  <span className="dot" style={{ background: s.color }} />
                  {s.name}
                </span>
              </span>
            </button>
          ))}
        </div>
      )}

      {adding && <AddSpaceModal onClose={() => setAdding(false)} onCreated={load} />}
    </div>
  );
}
