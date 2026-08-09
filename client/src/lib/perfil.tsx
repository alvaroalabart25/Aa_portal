import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api } from './api';
import { isLoggedIn } from './auth';

/**
 * Quién eres, para el portal.
 *
 * Se pide una vez al entrar y vive en un contexto, porque lo necesitan sitios
 * muy separados: el menú (qué módulos pinta), las rutas (a dónde te manda «/»)
 * y Configuración (si te enseña la pestaña de usuarios).
 *
 * Ojo con una cosa: el rol que llega aquí decide qué se PINTA, nunca qué se
 * PUEDE. Quien decide es el servidor. Si alguien se cambiara el rol en la
 * memoria del navegador vería una pestaña más y todas sus llamadas darían 403.
 */
export interface Perfil {
  id: number;
  username: string;
  displayName: string | null;
  role: 'admin' | 'user';
  modules: string[];
}

interface Estado {
  perfil: Perfil | null;
  cargando: boolean;
  recargar: () => Promise<void>;
}

const Ctx = createContext<Estado>({ perfil: null, cargando: true, recargar: async () => {} });

export function PerfilProvider({ children }: { children: ReactNode }) {
  const [perfil, setPerfil] = useState<Perfil | null>(null);
  const [cargando, setCargando] = useState(true);

  const recargar = useCallback(async () => {
    // Sin sesión no hay perfil que pedir. Y con `skipAuthRedirect` porque este
    // proveedor envuelve TODO el portal, incluidas las pantallas públicas: sin
    // eso, abrir una invitación dispararía un 401 que te echa al login antes de
    // poder crear la cuenta.
    if (!isLoggedIn()) {
      setPerfil(null);
      setCargando(false);
      return;
    }
    try {
      setPerfil(await api<Perfil>('/auth/me', { skipAuthRedirect: true }));
    } catch {
      setPerfil(null);
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    void recargar();
  }, [recargar]);

  return <Ctx.Provider value={{ perfil, cargando, recargar }}>{children}</Ctx.Provider>;
}

export function usePerfil() {
  return useContext(Ctx);
}

/** ¿Tiene esta cuenta el módulo puesto? Mientras carga se dice que sí, para no
 *  parpadear enseñando un portal a medias que enseguida cambia. */
export function useModulo(id: string): boolean {
  const { perfil, cargando } = usePerfil();
  if (cargando || !perfil) return true;
  return perfil.modules.includes(id);
}
