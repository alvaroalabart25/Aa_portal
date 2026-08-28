/**
 * Los módulos del portal, en el servidor.
 *
 * La lista existe dos veces a propósito: aquí (para validar lo que se guarda) y
 * en `client/src/shell/modules.tsx` (para pintar el menú, con sus iconos). Los
 * ids TIENEN que coincidir. Se valida en el servidor porque un módulo que no
 * existe guardado en la base deja una cuenta con un menú roto y sin forma
 * evidente de arreglarlo.
 */
export const MODULOS = ['agenda', 'persona', 'org', 'salud', 'suenos', 'autonomo', 'roadmap'] as const;
export type Modulo = (typeof MODULOS)[number];

/** Con lo que arranca una cuenta nueva si no se le dice otra cosa. */
export const MODULOS_POR_DEFECTO: Modulo[] = ['agenda', 'org', 'salud'];

/**
 * Limpia una lista de módulos: quita lo que no existe y lo repetido, y respeta
 * el orden del menú. Devuelve null si no queda nada válido, para que quien
 * llama decida (guardar los de por defecto o rechazar la petición).
 */
export function limpiarModulos(entrada: unknown): Modulo[] | null {
  const bruto = Array.isArray(entrada)
    ? entrada
    : typeof entrada === 'string'
      ? entrada.split(',')
      : [];
  const pedidos = new Set(bruto.map((m) => String(m).trim()));
  const limpios = MODULOS.filter((m) => pedidos.has(m));
  return limpios.length ? [...limpios] : null;
}

/** Lo que se guarda en la columna `users.modules`. */
export function aTexto(modulos: Modulo[]): string {
  return modulos.join(',');
}
