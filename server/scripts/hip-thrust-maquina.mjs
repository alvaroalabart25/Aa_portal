// El Hip Thrust pasa de barra a máquina.
//
// Con el cambio de gimnasio lo hace en la máquina Binom BS111: el carro pesa
// 22,70 kg (medido por él) y los discos van a UN SOLO lado, así que el peso
// que apunta es el total de discos y hay que sumarle el carro. La cuenta de la
// barra —peso × 2 + 15— le estaba dando 50 kg donde había 40,2.
//
// De un solo uso. En seco por defecto:
//   node scripts/hip-thrust-maquina.mjs          (mira y no toca)
//   node scripts/hip-thrust-maquina.mjs --va     (lo hace)
import 'dotenv/config';
import mysql from 'mysql2/promise';

const VA = process.argv.includes('--va');
const CARRO = '22.70';
const NOMBRE = 'Hip Thrust (máquina)';
// El ejercicio suyo que tiene las series apuntadas (día «Biceps, Triceps &
// Hombro + Pierna»). El del día «Full body» no se toca: no tiene ni una serie
// y no me consta que lo haya hecho en esta máquina.
const EJERCICIO = 150001;
const NOTA =
  'Máquina Binom BS111. El carro pesa 22,70 kg y los discos van a un solo lado, ' +
  'así que aquí se apunta el total de discos. REVISAR el peso del carro en el gimnasio.';

const conn = await mysql.createConnection({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT ?? 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  ssl: process.env.DB_SSL === 'true' ? { minVersion: 'TLSv1.2', rejectUnauthorized: true } : undefined,
  connectTimeout: 20000,
});

const volumen = `sum(((case when e.per_side = 1 then s.weight * 2 else s.weight end) + coalesce(e.bar_kg, 0)) * s.reps)`;
const antes = async () => {
  const [[f]] = await conn.query(
    `select ${volumen} as v from gym_sets s join gym_exercises e on e.id = s.exercise_id where s.exercise_id = ?`,
    [EJERCICIO],
  );
  return Number(f.v);
};

console.log(`  volumen apuntado ahora: ${Math.round(await antes())} kg`);

// 1. La entrada de catálogo. Común (created_by NULL), como la de barra: es una
//    máquina de gimnasio, no un invento suyo. Idempotente por nombre.
const [[ya]] = await conn.query('select id from gym_catalog where name = ? limit 1', [NOMBRE]);
let catalogoId = ya?.id;
if (catalogoId) {
  console.log(`  catálogo: ya existía «${NOMBRE}» (id ${catalogoId})`);
} else if (VA) {
  const [[barra]] = await conn.query("select parts, parts_secondary, kind from gym_catalog where name = 'Hip Thrust (barra)'");
  const [r] = await conn.execute(
    `insert into gym_catalog (name, parts, parts_secondary, kind, bar_kg, per_side, created_by)
     values (?, ?, ?, ?, ?, 0, NULL)`,
    [NOMBRE, barra.parts, barra.parts_secondary, barra.kind, CARRO],
  );
  catalogoId = r.insertId;
  console.log(`  catálogo: creada «${NOMBRE}» (id ${catalogoId}) · carro ${CARRO} kg · peso total, no por lado`);
} else {
  console.log(`  catálogo: se crearía «${NOMBRE}» con carro ${CARRO} kg y peso total`);
}

// 2. Su ejercicio pasa a la máquina. Las series ya apuntadas no se tocan: sus
//    kilos son los discos que puso, y lo que cambia es la cuenta del total.
if (VA) {
  await conn.execute(
    `update gym_exercises set name = ?, catalog_id = ?, bar_kg = ?, per_side = 0, notes = ?
      where id = ? and user_id = 1`,
    [NOMBRE, catalogoId, CARRO, NOTA, EJERCICIO],
  );
  // El nombre viaja copiado en cada serie: si no, el histórico seguiría
  // diciendo «(barra)» para sesiones que fueron en máquina.
  const [s] = await conn.execute('update gym_sets set exercise_name = ? where exercise_id = ? and user_id = 1', [
    NOMBRE,
    EJERCICIO,
  ]);
  console.log(`  ejercicio ${EJERCICIO} → máquina · ${s.affectedRows} series renombradas`);
  console.log(`  volumen recalculado:    ${Math.round(await antes())} kg`);
} else {
  console.log(`  ejercicio ${EJERCICIO} pasaría a «${NOMBRE}» con la nota de revisar`);
}

if (!VA) console.log('\n  EN SECO. Nada escrito. Repite con --va.');

await conn.end();
