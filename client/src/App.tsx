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
import RutinaPage from './modules/routine/RutinaPage';
import DiarioPage from './modules/health/DiarioPage';
import SuenosPage from './modules/dreams/SuenosPage';
import SuenoDetallePage from './modules/dreams/SuenoDetallePage';
import MacroFichaPage from './modules/focus/MacroFichaPage';
import Configuracion from './pages/Configuracion';
import Recuperar from './pages/Recuperar';

function RequireAuth() {
  return isLoggedIn() ? <Outlet /> : <Navigate to="/login" replace />;
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/recuperar" element={<Recuperar />} />
        <Route element={<RequireAuth />}>
          <Route element={<Layout />}>
            <Route path="/" element={<Navigate to="/agenda" replace />} />
            <Route path="/agenda" element={<AgendaPage />} />
            <Route path="/espacios" element={<SpacesPage />} />
            <Route path="/espacios/:id" element={<SpacePage />} />
            <Route path="/proyectos" element={<ProjectsPage />} />
            <Route path="/proyectos/:id" element={<ProjectPage />} />
            <Route path="/tareas" element={<TasksPage />} />
            {/* Eventos vive dentro de Agenda: la dirección de antes sigue valiendo */}
            <Route path="/eventos" element={<Navigate to="/agenda?tab=eventos" replace />} />
            <Route path="/tareas/:id" element={<TaskPage />} />
            <Route path="/autonomo" element={<Navigate to="/autonomo/facturas" replace />} />
            <Route path="/autonomo/facturas" element={<FacturasPage />} />
            <Route path="/autonomo/cuentas" element={<CuentasPage />} />
            <Route path="/roadmap" element={<RoadmapPage />} />
            <Route path="/rutina" element={<RutinaPage />} />
            <Route path="/suenos" element={<SuenosPage />} />
            <Route path="/suenos/:id" element={<SuenoDetallePage />} />
            <Route path="/macro/:id" element={<MacroFichaPage />} />
            <Route path="/configuracion" element={<Configuracion />} />
            {/* enlaces antiguos: siguen funcionando */}
            <Route path="/notificaciones" element={<Navigate to="/configuracion?tab=notificaciones" replace />} />
            <Route path="/seguridad" element={<Navigate to="/configuracion" replace />} />
            <Route path="/diario" element={<DiarioPage />} />
          </Route>
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
