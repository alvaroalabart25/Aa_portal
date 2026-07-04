import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { spacesApi } from './api';
import { AddSpaceModal } from './modals';
import type { Space } from './types';

export default function SpacesPage() {
  const [spaces, setSpaces] = useState<Space[]>([]);
  const [adding, setAdding] = useState(false);
  const navigate = useNavigate();

  const load = useCallback(async () => setSpaces(await spacesApi.list()), []);
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

      <table className="table" style={{ marginTop: 24 }}>
        <thead>
          <tr>
            <th>Nombre</th>
            <th style={{ width: 160 }}>Proyectos activos</th>
          </tr>
        </thead>
        <tbody>
          {spaces.map((s) => (
            <tr key={s.id} className="row" onClick={() => navigate(`/espacios/${s.id}`)}>
              <td style={{ fontWeight: 500 }}>
                <span className="dot" style={{ background: s.color, display: 'inline-block', marginRight: 10 }} />
                {s.name}
              </td>
              <td className="num">{s.activeProjects ?? 0} proyectos</td>
            </tr>
          ))}
        </tbody>
      </table>
      {spaces.length === 0 && <div className="empty">Crea tu primer espacio (p. ej. «Autónomos»).</div>}

      {adding && <AddSpaceModal onClose={() => setAdding(false)} onCreated={load} />}
    </div>
  );
}
