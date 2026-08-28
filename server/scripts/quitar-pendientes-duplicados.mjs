/**
 * Los pendientes que ya se contabilizaron y se quedaron dentro.
 *
 * A partir de ahora la sincronización los barre sola (banco-routes: un
 * pendiente que el banco ya no devuelve, sobra). Esto es solo para los que ya
 * estaban antes de ese arreglo, cuando no se puede esperar a la siguiente
 * sincronización —el cupo diario del banco se agota y hay que esperar horas—.
 *
 * Un pendiente sobra cuando existe su gemelo CONTABILIZADO: misma cuenta, mismo
 * día, mismo importe y mismo sentido. NO se compara el concepto a propósito: el
 * banco lo cambia al contabilizar («BIZUM A FAVOR DE…» se le añade el número de
 * operación) y comparándolo se escapaban justo los que hay que quitar.
 *
 * Por defecto NO borra: enseña lo que haría.
 *
 *   node scripts/quitar-pendientes-duplicados.mjs
 *   node scripts/quitar-pendientes-duplicados.mjs --aplicar
 */
import 'dotenv/config';
import mysql from 'mysql2/promise';

const APLICAR = process.argv.includes('--aplicar');

const conn = await mysql.createConnection({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT ?? 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  ssl: process.env.DB_SSL === 'true' ? { minVersion: 'TLSv1.2', rejectUnauthorized: true } : undefined,
});

const [sobran] = await conn.query(
  `select p.id, date_format(p.booking_date,'%Y-%m-%d') dia, p.amount, p.direction,
          left(p.concept, 46) concepto, p.entry_reference ref,
          b.id id_bueno, b.entry_reference ref_buena, left(b.concept, 46) concepto_bueno
     from bank_transactions p
     join bank_transactions b
       on b.account_id = p.account_id
      and b.booking_date = p.booking_date
      and b.amount = p.amount
      and b.direction = p.direction
      and b.status = 'BOOK'
      and b.id <> p.id
    where p.status = 'PDNG'
    order by p.booking_date`,
);

if (!sobran.length) {
  console.log('Ningún pendiente tiene un gemelo contabilizado. Nada que quitar.');
  await conn.end();
  process.exit(0);
}

console.log(`${sobran.length} pendiente(s) que ya están contabilizados:\n`);
for (const s of sobran) {
  console.log(`  ${s.dia}  ${String(s.amount).padStart(9)} €  ${s.direction}`);
  console.log(`     se borra  #${s.id}  «${s.concepto}»  ref «${s.ref}»`);
  console.log(`     se queda  #${s.id_bueno}  «${s.concepto_bueno}»  ref «${s.ref_buena}»\n`);
}

if (!APLICAR) {
  console.log('En seco. Para aplicarlo: node scripts/quitar-pendientes-duplicados.mjs --aplicar');
  await conn.end();
  process.exit(0);
}

for (const s of sobran) {
  await conn.query('DELETE FROM bank_transactions WHERE id = ? AND status = ?', [s.id, 'PDNG']);
}
console.log(`✓ ${sobran.length} fuera. Falta rehacer traspasos, categorías y el retrato del patrimonio.`);
await conn.end();
