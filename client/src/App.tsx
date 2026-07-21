import { BrowserRouter, Navigate, Outlet, Route, Routes } from 'react-router-dom';
import { isLoggedIn } from './lib/auth';
import Layout from './shell/Layout';
import Login from './pages/Login';
import AgendaPage from './modules/tasks/AgendaPage';
import SpacesPage from './modules/tasks/SpacesPage';
import SpacePage from './modules/tasks/SpacePage';
import ProjectsPage from './modules/tasks/ProjectsPage';
import ProjectPage from './modules/tasks/ProjectPage';
import TasksPage from './modules/tasks/TasksPage';
import TaskPage from './modules/tasks/TaskPage';
import FacturasPage from './modules/autonomo/FacturasPage';
import CuentasPage from './modules/autonomo/CuentasPage';
import RoadmapPage from './modules/roadmap/RoadmapPage';

function RequireAuth() {
  return isLoggedIn() ? <Outlet /> : <Navigate to="/login" replace />;
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route element={<RequireAuth />}>
          <Route element={<Layout />}>
            <Route path="/" element={<Navigate to="/agenda" replace />} />
            <Route path="/agenda" element={<AgendaPage />} />
            <Route path="/espacios" element={<SpacesPage />} />
            <Route path="/espacios/:id" element={<SpacePage />} />
            <Route path="/proyectos" element={<ProjectsPage />} />
            <Route path="/proyectos/:id" element={<ProjectPage />} />
            <Route path="/tareas" element={<TasksPage />} />
            <Route path="/tareas/:id" element={<TaskPage />} />
            <Route path="/autonomo" element={<Navigate to="/autonomo/facturas" replace />} />
            <Route path="/autonomo/facturas" element={<FacturasPage />} />
            <Route path="/autonomo/cuentas" element={<CuentasPage />} />
            <Route path="/roadmap" element={<RoadmapPage />} />
          </Route>
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
