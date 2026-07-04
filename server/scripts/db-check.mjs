// Test de conexión a la MySQL de Raiola. Uso:  node scripts/db-check.mjs
import 'dotenv/config';
import mysql from 'mysql2/promise';

const { DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD } = process.env;

console.log('🔌 Probando conexión a MySQL de Raiola...');
console.log(`   host: ${DB_HOST}:${DB_PORT ?? 3306}`);
console.log(`   db:   ${DB_NAME}`);
console.log(`   user: ${DB_USER}`);

if (!DB_HOST || DB_HOST.startsWith('PON_AQUI') || !DB_PASSWORD || DB_PASSWORD.startsWith('PON_AQUI')) {
  console.error('\n⚠️  Falta rellenar DB_HOST y/o DB_PASSWORD en server/.env');
  process.exit(1);
}

try {
  const conn = await mysql.createConnection({
    host: DB_HOST,
    port: Number(DB_PORT ?? 3306),
    user: DB_USER,
    password: DB_PASSWORD,
    database: DB_NAME,
    connectTimeout: 10000,
  });
  const [rows] = await conn.query(
    'SELECT 1 AS ok, VERSION() AS version, DATABASE() AS db, CURRENT_USER() AS connected_as',
  );
  console.log('\n✅ CONEXIÓN OK');
  console.table(rows);
  await conn.end();
  process.exit(0);
} catch (e) {
  console.error('\n❌ FALLO DE CONEXIÓN');
  console.error(`   ${e.code ?? ''} — ${e.message}`);
  console.error('\nPistas según el error:');
  console.error('   • ETIMEDOUT / ECONNREFUSED  → host/puerto mal, o tu IP no está en Remote MySQL.');
  console.error('   • ER_ACCESS_DENIED_ERROR    → usuario/contraseña/BD incorrectos o sin privilegios.');
  console.error('   • ENOTFOUND                 → el DB_HOST no resuelve (revisa el nombre).');
  process.exit(1);
}
