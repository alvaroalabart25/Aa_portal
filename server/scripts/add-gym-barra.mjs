/**
 * Los ejercicios de barra se apuntan POR UN LADO.
 *
 * Cuando cargas 40 kg en un peso muerto, esos 40 son de un extremo: el peso
 * real son 40 × 2 más la barra. Apuntar el total obliga a hacer la cuenta de
 * cabeza en medio de la serie, y es justo cuando peor se hace.
 *
 * Así que la regla es: **en barra se apunta un lado** y el portal suma. Se
 * guarda `bar_kg` en el ejercicio; si tiene valor, el peso apuntado es por lado
 * y esa es la barra. Si es NULL, el peso es el total (mancuernas, máquinas,
 * poleas) y no cambia nada.
 *
 * Va en las DOS tablas por lo mismo que ya pasa con el nombre y el tipo: el
 * catálogo es la identidad y el ejercicio de la rutina se queda con su copia,
 * para que cambiar el catálogo no reescriba el histórico de nadie.
 *
 * Idempotente. Ejecutar DESDE server/:  node scripts/add-gym-barra.mjs
 */
import 'dotenv/config';
import mysql from 'mysql2/promise';

const BD = process.env.DB_NAME;
const conn = await mysql.createConnection({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT ?? 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: BD,
  ssl: process.env.DB_SSL === 'true' ? { minVersion: 'TLSv1.2', rejectUnauthorized: true } : undefined,
});

const existeCol = async (t, col) =>
  (
    await conn.query(
      'SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME=? AND COLUMN_NAME=?',
      [BD, t, col],
    )
  )[0].length > 0;

for (const tabla of ['gym_catalog', 'gym_exercises']) {
  if (await existeCol(tabla, 'bar_kg')) {
    console.log(`· ${tabla}.bar_kg ya existía`);
  } else {
    await conn.query(`ALTER TABLE ${tabla} ADD COLUMN bar_kg decimal(5,2) NULL`);
    console.log(`+ ${tabla}.bar_kg`);
  }
}

/**
 * Los que llevan barra y se cargan por los dos extremos. Solo los que no dejan
 * duda: el remo en barra T lleva los discos en UN extremo, así que no entra, y
 * los que el nombre no aclara (press francés, sentadilla sumo) tampoco — se
 * marcan a mano cuando toque, que es mejor que suponer y falsear un peso.
 */
const DE_BARRA = [
  [1, 'Press banca (barra)'],
  [3, 'Press inclinado (barra)'],
  [20, 'Remo con barra'],
  [26, 'Peso muerto'],
  [29, 'Press militar (barra)'],
  [40, 'Curl con barra'],
  [64, 'Sentadilla con Barra'],
  [72, 'Peso Muerto Rumano'],
  [75, 'Hip Thrust (barra)'],
];

// La barra de su gimnasio. La de curl suele pesar menos: se corrige desde la
// ficha del ejercicio, que para eso el campo es editable.
const BARRA = 15;

for (const [id, nombre] of DE_BARRA) {
  const [r] = await conn.query('UPDATE gym_catalog SET bar_kg=? WHERE id=? AND bar_kg IS NULL', [BARRA, id]);
  console.log(r.affectedRows ? `  → ${nombre}: barra de ${BARRA} kg` : `  · ${nombre}: ya estaba`);
}

// Y los ejercicios de rutina que ya apuntan a esos del catálogo
const [prop] = await conn.query(
  `UPDATE gym_exercises e JOIN gym_catalog c ON c.id = e.catalog_id
     SET e.bar_kg = c.bar_kg
   WHERE c.bar_kg IS NOT NULL AND e.bar_kg IS NULL`,
);
console.log(`+ ${prop.affectedRows} ejercicios de rutina heredan su barra`);

await conn.end();
console.log('listo.');
