// Separa dos cosas que hasta ahora iban juntas: cuánto pesa la parte fija de
// un ejercicio y si el peso que se apunta es de UN LADO.
//
// La barra las tenía pegadas —`bar_kg` significaba «pesa esto y va por lado»—
// y con la máquina de hip thrust dejan de ir juntas: su carro pesa 22,70 kg
// pero los discos van a un solo lado, así que el peso apuntado es el total.
//
// Uso:  node scripts/add-gym-peso-por-lado.mjs
//
// SQL directo (drizzle-kit push se cuelga con TiDB) e idempotente. Al crear la
// columna, TODO lo que ya tenía `bar_kg` se marca por lado: así el histórico
// de la barra sigue calculando exactamente igual que ayer.
import 'dotenv/config';
import mysql from 'mysql2/promise';

const conn = await mysql.createConnection({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT ?? 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  ssl: process.env.DB_SSL === 'true' ? { minVersion: 'TLSv1.2', rejectUnauthorized: true } : undefined,
  connectTimeout: 20000,
});

async function existe(tabla, columna) {
  const [[fila]] = await conn.query(
    `SELECT COUNT(*) AS n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [process.env.DB_NAME, tabla, columna],
  );
  return Number(fila.n) > 0;
}

for (const tabla of ['gym_catalog', 'gym_exercises']) {
  if (await existe(tabla, 'per_side')) {
    console.log(`  ya estaba: ${tabla}.per_side`);
    continue;
  }
  await conn.query(`ALTER TABLE ${tabla} ADD COLUMN per_side tinyint NOT NULL DEFAULT 0`);
  const [r] = await conn.query(`UPDATE ${tabla} SET per_side = 1 WHERE bar_kg IS NOT NULL`);
  console.log(`  añadida:   ${tabla}.per_side · ${r.affectedRows} filas marcadas por lado (las que llevan barra)`);
}

const [cat] = await conn.query(
  'SELECT name, bar_kg, per_side FROM gym_catalog WHERE bar_kg IS NOT NULL ORDER BY name',
);
console.log('\n  catálogo con peso fijo:');
for (const c of cat) {
  console.log(`    ${c.per_side ? 'por lado ' : 'total    '} +${c.bar_kg} kg · ${c.name}`);
}

await conn.end();
