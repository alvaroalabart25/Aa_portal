import jwt from 'jsonwebtoken';
import type { NextFunction, Response } from 'express';
import type { AuthedRequest } from './middleware';

/**
 * El pase: la segunda puerta.
 *
 * Hay sitios del portal donde tener la sesión abierta no debería bastar —el
 * diario de Persona, el dinero—. Para entrar ahí hace falta volver a firmar con
 * Face ID, y lo que se consigue al firmar es esto: un pase corto, de un solo
 * ámbito y atado al usuario.
 *
 * Se comprueba en el SERVIDOR en cada llamada. Un candado que solo vive en la
 * pantalla se salta llamando a la API con la sesión de siempre, así que no es
 * un candado: es un cartel.
 *
 * Dura poco y el navegador lo guarda solo en memoria: al recargar la pestaña la
 * puerta vuelve a estar cerrada.
 */
export const MINUTOS_DE_PASE = 20;

export type Ambito = 'persona' | 'finanzas';

export function firmarPase(userId: number, scope: Ambito): string {
  return jwt.sign({ sub: String(userId), scope }, process.env.JWT_SECRET as string, {
    algorithm: 'HS256',
    expiresIn: `${MINUTOS_DE_PASE}m`,
  });
}

/**
 * Exige el pase de un ámbito además de la sesión.
 *
 * 423 (bloqueado) y no 401 a propósito: 401 haría que el cliente te echase al
 * login, y aquí la sesión está perfectamente bien. Lo que falta es la cara.
 */
export function requierePase(scope: Ambito) {
  return function (req: AuthedRequest, res: Response, next: NextFunction) {
    const cabecera = req.headers['x-pase'];
    const pase = typeof cabecera === 'string' ? cabecera : '';
    if (!pase) return res.status(423).json({ error: 'Esta parte está cerrada', ambito: scope });
    try {
      const payload = jwt.verify(pase, process.env.JWT_SECRET as string, { algorithms: ['HS256'] }) as {
        sub?: string;
        scope?: string;
      };
      // El ámbito importa tanto como la firma: el pase del diario no puede
      // abrir el dinero, y el token de sesión no vale como pase de nada.
      if (payload.scope !== scope || Number(payload.sub) !== req.userId) {
        return res.status(423).json({ error: 'Esta parte está cerrada', ambito: scope });
      }
    } catch {
      return res.status(423).json({ error: 'El pase ha caducado', ambito: scope });
    }
    next();
  };
}
