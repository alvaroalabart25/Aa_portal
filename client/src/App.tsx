import { BrowserRouter, Navigate, Outlet, Route, Routes } from 'react-router-dom';
import { isLoggedIn } from './lib/auth';
import Layout from './shell/Layout';
import Login from './pages/Login';
import AgendaPage from './modules/tasks/AgendaPage';
import ProjectsPage from './modules/tasks/ProjectsPage';
import ProjectPage from './modules/tasks/ProjectPage';
import TasksPage from './modules/tasks/TasksPage';
import TaskPage from './modules/tasks/TaskPage';
import FacturasPage from './modules/autonomo/FacturasPage';
import CuentasPage from './modules/autonomo/CuentasPage';
import BancoPage from './modules/autonomo/BancoPage';
import RoadmapPage from './modules/roadmap/RoadmapPage';
import RutinaPage from './modules/routine/RutinaPage';
import DiarioPage from './modules/health/DiarioPage';
import SuenosPage from './modules/dreams/SuenosPage';
import SuenoDetallePage from './modules/dreams/SuenoDetallePage';
import MacroFichaPage from './modules/focus/MacroFichaPage';
import GimnasioPage from './modules/gym/GimnasioPage';
import ObjetivosPage from './modules/gym/ObjetivosPage';
import SesionPage from './modules/gym/SesionPage';
import Configuracion from './pages/Configuracion';
import Recuperar from './pages/Recuperar';
import Invitacion from './pages/Invitacion';
import { PerfilProvider, usePerfil } from './lib/perfil';
import Arranque from './components/Arranque';

function RequireAuth() {
  return isLoggedIn() ? <Outlet /> : <Navigate to="/login" replace />;
}

/**
 * La portada de cada cuenta.
 *
 * Antes «/» iba siempre a Agenda porque solo había un portal. Ahora Agenda
 * puede estar apagada, así que se entra por el primer módulo que esa cuenta
 * tenga puesto. Con el perfil aún cargando no se redirige a ciegas: mandar a
 * Agenda y rebotar a otro sitio medio segundo después se ve como un fallo.
 */
const PORTADA: Record<string, string> = {
  agenda: '/agenda',
  org: '/proyectos',
  salud: '/diario',
  suenos: '/suenos',
  autonomo: '/autonomo/facturas',
  roadmap: '/roadmap',
};

function Portada() {
  const { perfil, cargando } = usePerfil();
  if (cargando) return null;
  const primero = perfil?.modules.find((m) => PORTADA[m]);
  return <Navigate to={primero ? PORTADA[primero] : '/agenda'} replace />;
}

export default function App() {
  return (
    <BrowserRouter>
      <PerfilProvider>
      <Arranque />
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/recuperar" element={<Recuperar />} />
        <Route path="/invitacion/:token" element={<Invitacion />} />
        <Route element={<RequireAuth />}>
          <Route element={<Layout />}>
            <Route path="/" element={<Portada />} />
            <Route path="/agenda" element={<AgendaPage />} />
            {/* Espacios y Proyectos eran dos pantallas que contaban lo mismo de
                dos formas. Ahora es una: las direcciones viejas siguen valiendo. */}
            <Route path="/espacios" element={<Navigate to="/proyectos" replace />} />
            <Route path="/espacios/:id" element={<Navigate to="/proyectos" replace />} />
            <Route path="/proyectos" element={<ProjectsPage />} />
            <Route path="/proyectos/:id" element={<ProjectPage />} />
            <Route path="/tareas" element={<TasksPage />} />
            {/* Eventos vive dentro de Agenda: la dirección de antes sigue valiendo */}
            <Route path="/eventos" element={<Navigate to="/agenda?tab=eventos" replace />} />
            <Route path="/gimnasio" element={<GimnasioPage />} />
            <Route path="/salud/objetivos" element={<ObjetivosPage />} />
            <Route path="/gimnasio/sesion/:id" element={<SesionPage />} />
            <Route path="/tareas/:id" element={<TaskPage />} />
            <Route path="/autonomo" element={<Navigate to="/autonomo/facturas" replace />} />
            <Route path="/autonomo/facturas" element={<FacturasPage />} />
            <Route path="/autonomo/cuentas" element={<CuentasPage />} />
            {/* la vuelta del banco aterriza en /autonomo/banco/vuelta?code&state */}
            <Route path="/autonomo/banco" element={<BancoPage />} />
            <Route path="/autonomo/banco/vuelta" element={<BancoPage />} />
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
      </PerfilProvider>
    </BrowserRouter>
  );
}
