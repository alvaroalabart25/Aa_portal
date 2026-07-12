// Seed del módulo Autónomo: perfil fiscal, cliente CSO Digital y la factura
// histórica 2026001 (emitida en Canva antes de existir el portal).
// Idempotente: no duplica si ya existe. Uso: node scripts/seed-autonomo.mjs
import 'dotenv/config';
import mysql from 'mysql2/promise';

const conn = await mysql.createConnection({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  ssl: process.env.DB_SSL === 'true' ? { minVersion: 'TLSv1.2', rejectUnauthorized: true } : undefined,
});

const [[user]] = await conn.query('SELECT id FROM users LIMIT 1');
const uid = user.id;

// Perfil fiscal (datos tomados de la factura de ejemplo)
const [profiles] = await conn.query('SELECT id FROM autonomo_profile WHERE user_id = ?', [uid]);
if (profiles.length === 0) {
  await conn.query(
    `INSERT INTO autonomo_profile (user_id, full_name, tax_id, address_line, city_line, iban, default_vat_pct, default_irpf_pct)
     VALUES (?, 'Álvaro Alabart', '05437698S', 'Av. Marsil,13', 'Las Rozas de Madrid (28290)', 'ES57 0049 1759 5422 1005 3174', 21.00, 15.00)`,
    [uid],
  );
  console.log('✅ perfil fiscal creado');
} else console.log('- perfil ya existía');

// Cliente CSO Digital
let [clients] = await conn.query("SELECT id FROM invoice_clients WHERE user_id = ? AND name = 'CSO Digital S.L.'", [uid]);
if (clients.length === 0) {
  await conn.query(
    `INSERT INTO invoice_clients (user_id, name, tax_id, address_line, city_line, phone, email)
     VALUES (?, 'CSO Digital S.L.', 'B-19934371', 'Calle Playa de Calafell, 9', 'Las Rozas de Madrid, 28290', '+34 677 38 87 09', 'jose@csodigital.tech')`,
    [uid],
  );
  [clients] = await conn.query("SELECT id FROM invoice_clients WHERE user_id = ? AND name = 'CSO Digital S.L.'", [uid]);
  console.log('✅ cliente CSO Digital creado');
} else console.log('- cliente ya existía');
const clientId = clients[0].id;

// Factura histórica 2026001 (25/05/2026, base 1800, IVA 21%, IRPF 15%)
const [existing] = await conn.query("SELECT id FROM invoices WHERE user_id = ? AND kind = 'income' AND number = '2026001'", [uid]);
if (existing.length === 0) {
  await conn.query(
    `INSERT INTO invoices (user_id, kind, client_id, origin, number, issue_date, concept, base, vat_pct, irpf_pct, vat_amount, irpf_amount, total)
     VALUES (?, 'income', ?, 'CSO Digital S.L.', '2026001', '2026-05-25', 'Mes Marzo (Base Imponible)', 1800.00, 21.00, 15.00, 378.00, 270.00, 1908.00)`,
    [uid, clientId],
  );
  console.log('✅ factura 2026001 importada');
} else console.log('- factura 2026001 ya existía');

await conn.end();
console.log('🎉 seed autónomo completado');
