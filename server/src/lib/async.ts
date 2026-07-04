import type { NextFunction, Request, RequestHandler, Response } from 'express';

// Express 4 no captura errores lanzados en handlers async (el proceso muere
// con unhandledRejection). Este wrapper los redirige al middleware de error.
export function ah<R extends Request>(
  fn: (req: R, res: Response, next: NextFunction) => Promise<unknown> | unknown,
): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(fn(req as R, res, next)).catch(next);
  };
}
