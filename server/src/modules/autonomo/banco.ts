import { createSign } from 'node:crypto';

/**
 * Conector con Enable Banking: leer el banco, nada más.
 *
 * Enable Banking es una pasarela: no guarda tus datos ni tus credenciales, y
 * nosotros tampoco las vemos nunca. Quien te identifica es tu propio banco, en
 * su web. De vuelta solo traemos un identificador de sesión con caducidad.
 *
 * Cómo se autentica el portal contra ellos: un JWT firmado con NUESTRA clave
 * privada RSA (la pública va en el certificado que se sube a su panel). El
 * `kid` es el identificador de la aplicación. Sin esas dos cosas en el entorno
 * el conector se declara APAGADO y lo dice claro, en vez de fallar con un 500
 * incomprensible.
 *
 * Variables de entorno (en Render, nunca en el repositorio):
 *   ENABLEBANKING_APP_ID   — id de la aplicación registrada
 *   ENABLEBANKING_KEY      — clave privada RSA en PEM (con \n reales o escapados)
 *   ENABLEBANKING_BASE     — opcional; por defecto https://api.enablebanking.com
 */

const BASE = process.env.ENABLEBANKING_BASE || 'https://api.enablebanking.com';

/** ¿Hay credenciales? Sin esto el módulo se enseña, pero desactivado. */
export function bancoConfigurado(): boolean {
  return Boolean(process.env.ENABLEBANKING_APP_ID && process.env.ENABLEBANKING_KEY);
}

/**
 * La clave privada, reconstruida venga como venga.
 *
 * Al pegarla en el panel de Render los saltos de línea sobreviven de tres
 * formas distintas: reales, escapados como \n, o directamente convertidos en
 * espacios. OpenSSL solo acepta la primera y con las otras dos responde
 * «DECODER routines::unsupported», que no dice nada de lo que pasa de verdad.
 * Así que no confiamos en el formato: nos quedamos con el tipo de clave y su
 * base64, y volvemos a montar el PEM a 64 caracteres por línea.
 */
function clavePrivada(): string {
  const bruto = process.env.ENABLEBANKING_KEY ?? '';
  const crudo = bruto.replace(/\\n/g, '\n').trim();
  const m = /-----BEGIN ([A-Z ]+?)-----([\s\S]*?)-----END \1-----/.exec(crudo);
  if (!m) throw new ClaveIlegible(formaDeLaClave(bruto));
  const cuerpo = m[2].replace(/[^A-Za-z0-9+/=]/g, '');
  if (!cuerpo) throw new ClaveIlegible(formaDeLaClave(bruto));
  const lineas = cuerpo.match(/.{1,64}/g) ?? [];
  return `-----BEGIN ${m[1]}-----\n${lineas.join('\n')}\n-----END ${m[1]}-----\n`;
}

/**
 * Cómo es la clave que ha llegado, SIN decir lo que dice.
 *
 * Cuando el PEM no se puede leer hay que saber si llegó cortada, con la
 * cabecera de otro formato o vacía, y eso no se puede averiguar desde fuera.
 * Se cuentan caracteres y se mira la cabecera —que no es secreta—; nunca sale
 * un solo carácter del cuerpo de la clave.
 */
function formaDeLaClave(bruto: string): string {
  const cabecera = /-----BEGIN ([A-Z ]+?)-----/.exec(bruto);
  const base64 = (bruto.match(/[A-Za-z0-9+/=]/g) ?? []).length;
  return [
    `${bruto.length} caracteres`,
    cabecera ? `cabecera «${cabecera[1]}»` : 'sin cabecera BEGIN',
    /-----END /.test(bruto) ? 'con cierre END' : 'SIN cierre END (llegó cortada)',
    `${base64} caracteres de clave`,
    bruto.includes('\n') ? 'con saltos reales' : bruto.includes('\\n') ? 'con saltos escapados' : 'sin saltos',
  ].join(', ');
}

const base64url = (b: Buffer | string) =>
  Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/**
 * El JWT de acceso. Se firma en cada tanda de llamadas y vive una hora: no se
 * cachea en base de datos porque generarlo cuesta microsegundos y un token
 * guardado es un token que alguien puede robar.
 */
function firmarJwt(): string {
  const header = { typ: 'JWT', alg: 'RS256', kid: process.env.ENABLEBANKING_APP_ID };
  const ahora = Math.floor(Date.now() / 1000);
  const payload = {
    iss: 'enablebanking.com',
    aud: 'api.enablebanking.com',
    iat: ahora,
    exp: ahora + 3600,
  };
  const cuerpo = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}`;
  let firma: Buffer;
  try {
    firma = createSign('RSA-SHA256').update(cuerpo).sign(clavePrivada());
  } catch (e) {
    if (e instanceof ClaveIlegible) throw e;
    throw new ClaveIlegible(formaDeLaClave(process.env.ENABLEBANKING_KEY ?? ''));
  }
  return `${cuerpo}.${base64url(firma)}`;
}

/** La clave está puesta pero no se puede leer: casi siempre, mal pegada. */
export class ClaveIlegible extends Error {
  constructor(forma?: string) {
    super(
      `La clave privada del banco no se lee${forma ? ` (${forma})` : ''}: revisa que esté pegada completa, desde BEGIN hasta END`,
    );
  }
}

export class BancoApagado extends Error {
  constructor() {
    super('La conexión con el banco no está configurada en el servidor');
  }
}

/** Una llamada a su API, con el error legible si viene mal. */
async function llamar<T>(ruta: string, opciones: RequestInit = {}): Promise<T> {
  if (!bancoConfigurado()) throw new BancoApagado();
  const res = await fetch(`${BASE}${ruta}`, {
    ...opciones,
    headers: {
      Authorization: `Bearer ${firmarJwt()}`,
      'Content-Type': 'application/json',
      ...(opciones.headers ?? {}),
    },
    // el banco a veces tarda; más de 30 s es que algo va mal
    signal: AbortSignal.timeout(30_000),
  });
  const texto = await res.text();
  if (!res.ok) {
    // su mensaje suele ser JSON con `message`; si no, el texto crudo recortado
    let detalle = texto.slice(0, 200);
    try {
      const j = JSON.parse(texto);
      detalle = j.message || j.error || detalle;
    } catch {
      /* el texto crudo ya vale */
    }
    throw new Error(`Enable Banking (${res.status}): ${detalle}`);
  }
  return texto ? (JSON.parse(texto) as T) : ({} as T);
}

// ---------------------------------------------------------------- bancos

export interface Aspsp {
  name: string;
  country: string;
  logo?: string;
  /** cuánto puede durar el consentimiento, en segundos (~180 días) */
  maximum_consent_validity?: number;
}

/** Los bancos disponibles para leer cuentas en un país. */
export async function bancosDisponibles(country = 'ES'): Promise<Aspsp[]> {
  const r = await llamar<{ aspsps: Aspsp[] }>(`/aspsps?country=${encodeURIComponent(country)}`);
  return r.aspsps ?? [];
}

// ---------------------------------------------------------------- autorizar

/**
 * Paso 1: pedir la dirección donde el usuario autoriza EN SU BANCO.
 * `state` es nuestro y vuelve tal cual: es lo que permite saber a qué conexión
 * pertenece la vuelta sin fiarnos de nada más.
 */
export async function iniciarAutorizacion(opciones: {
  aspspName: string;
  country: string;
  state: string;
  redirectUrl: string;
  /** segundos de validez del consentimiento; el banco puede recortarlo */
  validez?: number;
}): Promise<{ url: string; authorization_id: string }> {
  const validez = Math.min(opciones.validez ?? 180 * 86400, 180 * 86400);
  return llamar('/auth', {
    method: 'POST',
    body: JSON.stringify({
      access: { valid_until: new Date(Date.now() + validez * 1000).toISOString() },
      aspsp: { name: opciones.aspspName, country: opciones.country },
      state: opciones.state,
      redirect_url: opciones.redirectUrl,
      psu_type: 'personal',
    }),
  });
}

export interface CuentaAutorizada {
  uid: string;
  name?: string;
  currency?: string;
  account_id?: { iban?: string };
  identification_hash?: string;
}

/**
 * Las cuentas que tiene AHORA una sesión ya abierta.
 *
 * Hace falta porque el permiso de un banco no es una foto fija: al vincular
 * una cuenta nueva en el panel de Enable Banking, la sesión de siempre pasa a
 * incluirla. Sin esto no había forma de enterarse más que volviendo a
 * autorizar el banco entero.
 */
export async function cuentasDeSesion(sessionId: string): Promise<CuentaAutorizada[]> {
  const s = (await llamar(`/sessions/${encodeURIComponent(sessionId)}`)) as {
    accounts?: (CuentaAutorizada | string)[];
    accounts_data?: CuentaAutorizada[];
  };
  /**
   * OJO con la forma de la respuesta, que no es la misma que al canjear:
   *
   *  - al CANJEAR (`POST /sessions`), `accounts` trae las cuentas enteras;
   *  - al PREGUNTAR por una sesión abierta, `accounts` son solo los
   *    identificadores y las cuentas van en `accounts_data`.
   *
   * Leer el primero aquí devolvía una lista de textos, así que se intentaban
   * dar de alta cuentas sin uid y la base de datos las rechazaba una por una.
   */
  if (s.accounts_data?.length) return s.accounts_data.filter((a) => Boolean(a?.uid));
  return (s.accounts ?? [])
    .map((a) => (typeof a === 'string' ? ({ uid: a } as CuentaAutorizada) : a))
    .filter((a) => Boolean(a?.uid));
}

/** Paso 2: canjear el código de vuelta por una sesión y sus cuentas. */
export async function canjearSesion(code: string): Promise<{
  session_id: string;
  accounts: CuentaAutorizada[];
  access?: { valid_until?: string };
}> {
  return llamar('/sessions', { method: 'POST', body: JSON.stringify({ code }) });
}

// ---------------------------------------------------------------- leer

/**
 * La respuesta CRUDA de una ruta suya, sin interpretar.
 *
 * Está para la pregunta previa a diseñar nada: qué campos rellena de verdad
 * cada banco (unos mandan el concepto en `remittance_information`, otros lo
 * dejan vacío y ponen el nombre en `creditor`, y el histórico va de 3 a 12
 * meses según la casa). Verlo antes evita construir sobre suposiciones.
 */
export async function crudo(ruta: string): Promise<unknown> {
  return llamar(ruta);
}

export interface SaldoApi {
  balance_amount?: { currency?: string; amount?: string };
  balance_type?: string;
  reference_date?: string;
}

/**
 * Cuál de los saldos es EL saldo.
 *
 * Cada banco manda los que quiere y en el orden que quiere. Santander manda dos
 * y pone primero el de APERTURA del día, así que quedarse con el primero es
 * quedarse con el saldo de las 00:00 — se veía 317,13 € cuando quedaban 2. Se
 * elige por tipo, nunca por posición:
 *
 *   ITAV  disponible en el día (Revolut)
 *   CLBD  contable / cierre (Ibercaja, y el bueno de Santander)
 *   ITBD  contable en el día
 *   XPCD  esperado
 *
 * Y OPBD —apertura— no se usa NUNCA para decir cuánto tienes. Si no se reconoce
 * ninguno, se coge el último: el primero suele ser el de apertura.
 */
const PRIORIDAD_SALDO = ['ITAV', 'CLBD', 'ITBD', 'XPCD', 'PRCD', 'VALU'];

export function saldoPrincipal(saldos: SaldoApi[]): SaldoApi | undefined {
  const tiene = (s: SaldoApi) => s.balance_amount?.amount != null;
  for (const tipo of PRIORIDAD_SALDO) {
    const s = saldos.find((x) => (x.balance_type ?? '').toUpperCase() === tipo && tiene(x));
    if (s) return s;
  }
  return [...saldos].reverse().find(tiene);
}

export async function saldosDe(accountUid: string): Promise<SaldoApi[]> {
  const r = await llamar<{ balances: SaldoApi[] }>(`/accounts/${encodeURIComponent(accountUid)}/balances`);
  return r.balances ?? [];
}

export interface MovimientoApi {
  entry_reference?: string;
  booking_date?: string;
  value_date?: string;
  transaction_amount?: { currency?: string; amount?: string };
  credit_debit_indicator?: 'CRDT' | 'DBIT';
  status?: string;
  creditor?: { name?: string };
  debtor?: { name?: string };
  remittance_information?: string[];
  reference_number?: string;
  // Revolut lo manda en TODOS sus movimientos (TRANSFER, CARD_PAYMENT, TOPUP…);
  // Santander e Ibercaja, nunca. Medido, no supuesto.
  bank_transaction_code?: { code?: string; sub_code?: string; description?: string };
}

/**
 * Los movimientos desde una fecha. La API pagina con `continuation_key`; aquí
 * se recorren todas las páginas, con un tope de vueltas por si algún banco
 * devolviera una cadena infinita.
 */
export async function movimientosDe(accountUid: string, desde: string): Promise<MovimientoApi[]> {
  const todos: MovimientoApi[] = [];
  let clave: string | undefined;
  for (let vuelta = 0; vuelta < 20; vuelta += 1) {
    const params = new URLSearchParams({ date_from: desde });
    if (clave) params.set('continuation_key', clave);
    const r = await llamar<{ transactions: MovimientoApi[]; continuation_key?: string }>(
      `/accounts/${encodeURIComponent(accountUid)}/transactions?${params}`,
    );
    todos.push(...(r.transactions ?? []));
    if (!r.continuation_key) break;
    clave = r.continuation_key;
  }
  return todos;
}
