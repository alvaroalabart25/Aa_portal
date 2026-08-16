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

/** La clave llega de Render en una sola línea: los \n vienen escapados. */
function clavePrivada(): string {
  return (process.env.ENABLEBANKING_KEY ?? '').replace(/\\n/g, '\n');
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
  const firma = createSign('RSA-SHA256').update(cuerpo).sign(clavePrivada());
  return `${cuerpo}.${base64url(firma)}`;
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

/** Paso 2: canjear el código de vuelta por una sesión y sus cuentas. */
export async function canjearSesion(code: string): Promise<{
  session_id: string;
  accounts: CuentaAutorizada[];
  access?: { valid_until?: string };
}> {
  return llamar('/sessions', { method: 'POST', body: JSON.stringify({ code }) });
}

// ---------------------------------------------------------------- leer

export interface SaldoApi {
  balance_amount?: { currency?: string; amount?: string };
  balance_type?: string;
  reference_date?: string;
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
