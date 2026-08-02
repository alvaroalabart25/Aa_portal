/**
 * Portadas de Espacios y Proyectos.
 *
 * Son fotos de stock de Pexels (licencia libre, sin atribución obligatoria)
 * descargadas y reducidas a 900×600, servidas desde el propio portal. NO se
 * enlazan desde el dominio de Pexels a propósito: eso obligaría a abrir la
 * política de contenido a un tercero y le contaría a Pexels tu IP cada vez que
 * abres el portal.
 *
 * La foto de cada espacio o proyecto sale de su id, así que siempre es la misma
 * para el mismo elemento: aleatoria a la vista, estable en la práctica.
 */
const PORTADAS = [
  '/covers/fotografia-1.jpg',
  '/covers/ciudad-1.jpg',
  '/covers/ensenanza-1.jpg',
  '/covers/fotografia-2.jpg',
  '/covers/ciudad-2.jpg',
  '/covers/ensenanza-2.jpg',
  '/covers/fotografia-3.jpg',
  '/covers/ciudad-3.jpg',
  '/covers/ensenanza-3.jpg',
  '/covers/ensenanza-4.jpg',
  '/covers/ensenanza-5.jpg',
];

/**
 * Reparto. El multiplicador y el número de portadas son primos entre sí, así
 * que a ids consecutivos les tocan portadas SIEMPRE distintas (y salteadas, no
 * en fila). Si algún día se añaden o quitan fotos, hay que comprobar que
 * `PASO` siga sin compartir divisores con `PORTADAS.length`; si no, empezarán a
 * repetirse.
 */
const PASO = 7;

export function portadaPara(id: number): string {
  return PORTADAS[(Math.abs(id) * PASO) % PORTADAS.length];
}

/**
 * Reparte portadas a una lista entera sin repetir.
 *
 * Hace falta porque el id solo no basta: los ids no son consecutivos (la base
 * los reparte a saltos), así que dos elementos de la misma lista pueden caer en
 * la misma foto, y dos tarjetas idénticas una al lado de otra parecen un error.
 *
 * Cada elemento arranca por la portada que le tocaría por su id y, si ya está
 * cogida en esta lista, avanza a la siguiente libre. Con más elementos que
 * fotos se vuelve a empezar, que es lo único que se puede hacer.
 */
export function repartirPortadas(ids: number[]): Map<number, string> {
  const usadas = new Set<number>();
  const reparto = new Map<number, string>();
  for (const id of ids) {
    let i = (Math.abs(id) * PASO) % PORTADAS.length;
    let intentos = 0;
    while (usadas.has(i) && intentos < PORTADAS.length) {
      i = (i + 1) % PORTADAS.length;
      intentos += 1;
    }
    if (intentos >= PORTADAS.length) usadas.clear(); // más elementos que fotos
    usadas.add(i);
    reparto.set(id, PORTADAS[i]);
  }
  return reparto;
}
