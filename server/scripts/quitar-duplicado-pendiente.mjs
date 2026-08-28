/**
 * El mismo movimiento, dos veces: el pendiente y el contabilizado.
 *
 * Un movimiento PENDIENTE llega del banco sin referencia, así que se guarda con
 * una compuesta (fecha|importe|concepto). Cuando se contabiliza, el banco ya le
 * pone una referencia de verdad, la clave única deja de reconocerlo y entra
 * otra vez. Resultado: un cobro contado dos veces —y con él, el reparto del
 * ciclo y la curva del patrimonio—.
 *
 * A partir de ahora no vuelve a pasar (la sincronización adopta la fila vieja),
 * pero los que ya entraron hay que quitarlos. Se borra SIEMPRE el pendiente y
 * se queda el contabilizado, que es el bueno: mismo día, mismo importe, mismo
 * concepto y misma cuenta, así que no se pierde nada.
 *
 * Por defecto NO borra: enseña lo que haría.
 *
 *   node scripts/quitar-duplicado-pendiente.mjs
 *   node scripts/quitar-duplicado-pendiente.mjs --aplicar
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

// Un pendiente es sobrante solo si existe su gemelo contabilizado: misma
// cuenta, mismo día, mismo importe, mismo sentido y mismo concepto.
const [sobran] = await conn.query(
  `select p.id, p.user_id, p.account_id, date_format(p.booking_date,'%Y-%m-%d') dia,
          p.amount, p.direction, p.concept, p.entry_reference ref_pendiente,
          b.id id_bueno, b.entry_reference ref_buena
     from bank_transactions p
     join bank_transactions b
       on b.account_id = p.account_id
      and b.booking_date = p.booking_date
      and b.amount = p.amount
      and b.direction = p.direction
      and coalesce(b.concept,'') = coalesce(p.concept,'')
      and b.status = 'BOOK'
      and b.id <> p.id
    where p.status = 'PDNG'`,
);

if (!sobran.length) {
  console.log('No hay ningún pendiente duplicado. Nada que hacer.');
  await conn.end();
  process.exit(0);
}

console.log(`${sobran.length} pendiente(s) que ya están contabilizados:\n`);
for (const s of sobran) {
  console.log(`  ${s.dia}  ${String(s.amount).padStart(9)} €  ${s.direction}  ${String(s.concept).slice(0, 46)}`);
  console.log(`     se borra  #${s.id} (PDNG, ref «${s.ref_pendiente}»)`);
  console.log(`     se queda  #${s.id_bueno} (BOOK, ref «${s.ref_buena}»)`);
}

if (!APLICAR) {
  console.log('\nEn seco. Para aplicarlo: node scripts/quitar-duplicado-pendiente.mjs --aplicar');
  await conn.end();
  process.exit(0);
}

for (const s of sobran) {
  await conn.query('DELETE FROM bank_transactions WHERE id = ? AND status = ?', [s.id, 'PDNG']);
}
console.log(`\n✓ ${sobran.length} movimiento(s) duplicado(s) fuera.`);
console.log('Sincroniza el banco para que se rehagan traspasos, categorías y el retrato del patrimonio.');
await conn.end();
