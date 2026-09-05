// Deja UNA sola conexión de Revolut, con las cuentas de siempre.
//
// Qué pasó: Enable Banking da un uid DISTINTO a la misma cuenta en cada
// sesión, así que al reautorizar entraron copias de todo —tres juegos de
// cuentas y 356 movimientos repetidos— y encima una cuenta conjunta que no
// debía estar.
//
// Qué hace: las cuentas viejas (con su historia, su alias, su marca de
// apartado y el objetivo que cuelga de ellas) se MUDAN a la sesión nueva, y
// las copias se borran con sus movimientos.
//
// De un solo uso. En seco por defecto:
//   node scripts/limpiar-revolut-duplicado.mjs
//   node scripts/limpiar-revolut-duplicado.mjs --va
import 'dotenv/config';
import mysql from 'mysql2/promise';

const VA = process.argv.includes('--va');
const USER = 1;
const BUENA = 90002; // la sesión nueva que se queda
const FUERA = [90001, 30006]; // la de la conjunta y la vieja de Revolut

// Qué cuenta vieja se queda con qué uid nuevo. Se casan a mano porque el uid
// no vale para casarlas: es lo que ha causado el problema.
const MUDANZA = [
  { vieja: 30003, uidNuevo: '452deab8-3f37-4aa7-9e3f-6cf65b58a1cd', que: 'cuenta principal ·9924' },
  { vieja: 30005, uidNuevo: '8645b7d9-3d99-4d46-ba79-2304562e1737', que: 'Hacienda 💶' },
  { vieja: 30004, uidNuevo: 'd629023f-7907-426e-96ec-c6fcd54ecfd8', que: 'Inversiones 🏗️' },
];
const COPIAS = [60001, 60002, 60003, 60004, 60005, 60006, 60007];

const conn = await mysql.createConnection({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT ?? 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  ssl: process.env.DB_SSL === 'true' ? { minVersion: 'TLSv1.2', rejectUnauthorized: true } : undefined,
  connectTimeout: 20000,
});

// --- comprobaciones antes de tocar: que lo que voy a borrar es lo que creo ---
const [copias] = await conn.query(
  `SELECT a.id, a.connection_id, a.name, a.alias, a.iban_tail,
          (SELECT COUNT(*) FROM bank_transactions t WHERE t.account_id = a.id) AS movs
     FROM bank_accounts a WHERE a.user_id = ? AND a.id IN (?)`,
  [USER, COPIAS],
);
console.log('\n  copias que se borran (con sus movimientos):');
console.table(copias);

const [[huerfanos]] = await conn.query(
  `SELECT COUNT(*) AS n FROM bank_transactions WHERE user_id = ? AND account_id IN (?)`,
  [USER, COPIAS],
);
console.log(`  movimientos a borrar: ${huerfanos.n}`);

const [quedan] = await conn.query(
  `SELECT a.id, a.alias, a.iban_tail, a.escrow,
          (SELECT COUNT(*) FROM bank_transactions t WHERE t.account_id = a.id) AS movs
     FROM bank_accounts a WHERE a.user_id = ? AND a.id IN (?)`,
  [USER, MUDANZA.map((m) => m.vieja)],
);
console.log('\n  cuentas que se quedan (y se mudan a la sesión nueva):');
console.table(quedan);

if (!VA) {
  console.log('\n  EN SECO. Nada escrito. Repite con --va.');
  await conn.end();
  process.exit(0);
}

// --- 1. borrar las copias y sus movimientos ---
// Primero las copias y luego la mudanza, no al revés: las copias ocupan los
// uids nuevos en esa misma conexión, y la clave única (conexión, uid) rebota.
const [mov] = await conn.query('DELETE FROM bank_transactions WHERE user_id = ? AND account_id IN (?)', [USER, COPIAS]);
console.log(`  borrados ${mov.affectedRows} movimientos duplicados`);
const [cu] = await conn.query('DELETE FROM bank_accounts WHERE user_id = ? AND id IN (?)', [USER, COPIAS]);
console.log(`  borradas ${cu.affectedRows} cuentas duplicadas (incluida la conjunta)`);

// --- 2. mudar las cuentas buenas a la sesión nueva ---
for (const m of MUDANZA) {
  await conn.execute('UPDATE bank_accounts SET connection_id = ?, account_uid = ? WHERE id = ? AND user_id = ?', [
    BUENA,
    m.uidNuevo,
    m.vieja,
    USER,
  ]);
  console.log(`  mudada ${m.vieja} → conexión ${BUENA} · ${m.que}`);
}

// --- 3. cerrar las conexiones que sobran ---
const [cx] = await conn.query('DELETE FROM bank_connections WHERE user_id = ? AND id IN (?)', [USER, FUERA]);
console.log(`  borradas ${cx.affectedRows} conexiones (la de la conjunta y la vieja)`);

const [final] = await conn.query(
  `SELECT c.id, c.aspsp_name, c.status,
          (SELECT COUNT(*) FROM bank_accounts a WHERE a.connection_id = c.id) AS cuentas
     FROM bank_connections c WHERE c.user_id = ? ORDER BY c.id`,
  [USER],
);
console.log('\n  cómo queda:');
console.table(final);

await conn.end();
