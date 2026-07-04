import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';
import { db, pool } from './db';
import { users } from './db/schema';

// Crea (o actualiza la contraseña de) tu usuario único a partir del .env.
// Uso: npm run seed
async function main() {
  const username = process.env.ADMIN_USERNAME;
  const password = process.env.ADMIN_PASSWORD;
  if (!username || !password) {
    throw new Error('Faltan ADMIN_USERNAME y/o ADMIN_PASSWORD en el .env');
  }
  const passwordHash = await bcrypt.hash(password, 12);
  const [existing] = await db.select().from(users).where(eq(users.username, username));
  if (existing) {
    await db.update(users).set({ passwordHash }).where(eq(users.id, existing.id));
    console.log(`✅ Usuario "${username}" ya existía: contraseña actualizada.`);
  } else {
    await db.insert(users).values({ username, passwordHash });
    console.log(`✅ Usuario "${username}" creado.`);
  }
  await pool.end();
}

main().catch((e) => {
  console.error('❌', e.message);
  process.exit(1);
});
