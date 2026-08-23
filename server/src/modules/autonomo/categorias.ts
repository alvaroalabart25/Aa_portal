/**
 * EN QUÉ se va el dinero. El tipo dice el CÓMO (bizum, recibo, tarjeta); la
 * categoría dice en qué. Son dos preguntas distintas y hacen falta las dos:
 * saber que 819 € salieron por bizum no explica nada, saber que 518 € de esos
 * eran la deuda y 301 € pagos pendientes del piso, sí.
 *
 * Ningún banco manda la categoría del comercio —está vacía en los tres—, así
 * que se deduce del nombre. Y como deducir se equivoca, la regla del sitio es:
 * **lo que no se reconoce se queda SIN categoría y se ve**. Una lista con un
 * 12% de «Sin categoría» honesto vale más que una en la que todo cuadra porque
 * el resto se ha metido en «Otros».
 *
 * Dos capas, en este orden:
 *
 * 1. Las reglas del usuario (`bank_category_rules`): las que él corrige en
 *    pantalla. Mandan siempre, porque él sabe lo que compró y esto no.
 * 2. La semilla de aquí abajo, que viaja con el código y mejora en cada deploy.
 */

import type { Tipo } from './tipos';

export const CATEGORIAS = [
  'impuestos',
  'bizums',
  'deuda',
  'credito',
  'suscripciones',
  'comida',
  'transporte',
  'salud',
  'ahorro',
] as const;

export type Categoria = (typeof CATEGORIAS)[number];

export const NOMBRE_CATEGORIA: Record<Categoria, string> = {
  impuestos: 'Impuestos y cuota',
  bizums: 'Bizums',
  deuda: 'Deuda',
  credito: 'Liquidación tarjeta de crédito',
  suscripciones: 'Suscripciones',
  comida: 'Comida y bares',
  transporte: 'Transporte',
  salud: 'Salud y gimnasio',
  ahorro: 'Ahorro e inversión',
};

/**
 * Lo que se guarda NO es gasto: cambia de sitio, no desaparece. Meterlo en el
 * mismo saco que las cañas hace que un mes de ahorrar mucho parezca un mes de
 * gastar mucho, que es justo al revés.
 */
export const NO_ES_GASTO: Categoria[] = ['ahorro'];

export const esCategoria = (s: string): s is Categoria => (CATEGORIAS as readonly string[]).includes(s);

export interface Regla {
  /** trozo de texto que tiene que aparecer en el concepto o en la contraparte */
  patron?: string | null;
  /** y/o el tipo del movimiento; sin patrón, vale por sí solo */
  tipo?: string | null;
  categoria: Categoria;
}

/**
 * La semilla, sacada de sus 155 gastos reales de los últimos 90 días.
 *
 * EL ORDEN MANDA: gana la primera que encaja. Por eso la deuda con su padre va
 * antes que «todos los bizums son bizums» —si no, los 518 € de la deuda se
 * contarían dos veces—, y por eso los supermercados van antes que nada que
 * pudiera pillarlos por el camino.
 */
export const REGLAS_SEMILLA: Regla[] = [
  // -- Impuestos y cuota: lo que va al Estado -------------------------------
  { patron: 'TGSS', categoria: 'impuestos' },
  { patron: 'SEGURIDAD SOCIAL', categoria: 'impuestos' },
  { patron: 'DOMICILIACION IMPUESTO', categoria: 'impuestos' },
  { patron: 'AGENCIA TRIBUTARIA', categoria: 'impuestos' },
  { patron: 'AEAT', categoria: 'impuestos' },
  { patron: 'IVA AUTOLI', categoria: 'impuestos' },

  // -- Deuda: antes que los bizums, o se cuenta dos veces -------------------
  { patron: 'ALABART FERRER', categoria: 'deuda' },

  // -- Ahorro e inversión: sale de la vista, no de tu patrimonio ------------
  { patron: 'COINBASE', categoria: 'ahorro' },
  { patron: 'TRADE REPUBLIC', categoria: 'ahorro' },
  { patron: 'TRADEREPUBLIC', categoria: 'ahorro' },
  { patron: 'MYINVESTOR', categoria: 'ahorro' },
  { patron: 'INDEXA', categoria: 'ahorro' },
  { patron: 'COMISION ADMINISTRACION', categoria: 'ahorro' },
  { patron: 'CUSTODIA VALOR', categoria: 'ahorro' },
  { tipo: 'inversion', categoria: 'ahorro' },

  // -- Salud y gimnasio -----------------------------------------------------
  { patron: 'DUET SPORTS', categoria: 'salud' },
  { patron: 'ALTAFIT', categoria: 'salud' },
  // el recibo del Altafit venía a nombre de la sociedad que lo explota
  { patron: 'ACEBO 2000', categoria: 'salud' },
  { patron: 'GYM', categoria: 'salud' },
  { patron: 'FARMACIA', categoria: 'salud' },
  { patron: 'CLINICA', categoria: 'salud' },
  { patron: 'DENTAL', categoria: 'salud' },

  // -- Suscripciones: lo que se cobra solo todos los meses ------------------
  { patron: 'APPLE', categoria: 'suscripciones' },
  { patron: 'GODADDY', categoria: 'suscripciones' },
  { patron: 'MANAGEWP', categoria: 'suscripciones' },
  { patron: 'NOMADESIM', categoria: 'suscripciones' },
  { patron: 'GOOGLE', categoria: 'suscripciones' },
  { patron: 'OPENAI', categoria: 'suscripciones' },
  { patron: 'ANTHROPIC', categoria: 'suscripciones' },
  { patron: 'CLAUDE', categoria: 'suscripciones' },
  { patron: 'NETFLIX', categoria: 'suscripciones' },
  { patron: 'SPOTIFY', categoria: 'suscripciones' },
  { patron: 'AMAZON PRIME', categoria: 'suscripciones' },
  { patron: 'ADOBE', categoria: 'suscripciones' },
  { patron: 'NOTION', categoria: 'suscripciones' },
  { patron: 'FIGMA', categoria: 'suscripciones' },
  { patron: 'VERCEL', categoria: 'suscripciones' },
  { patron: 'CLOUDFLARE', categoria: 'suscripciones' },
  { patron: 'RENDER', categoria: 'suscripciones' },

  // -- Transporte -----------------------------------------------------------
  // «E.S.» es como los bancos escriben una estación de servicio
  { patron: 'E.S. ', categoria: 'transporte' },
  { patron: 'REPSOL', categoria: 'transporte' },
  { patron: 'CEPSA', categoria: 'transporte' },
  { patron: 'GALP', categoria: 'transporte' },
  { patron: 'COSTCO GAS', categoria: 'transporte' },
  { patron: 'GOJEK', categoria: 'transporte' },
  // GoPay es la cartera de Gojek: en Bali pagaba con ella las motos
  { patron: 'GOPAY', categoria: 'transporte' },
  { patron: 'GRAB', categoria: 'transporte' },
  { patron: 'UBER EATS', categoria: 'comida' },
  { patron: 'UBER', categoria: 'transporte' },
  { patron: 'CABIFY', categoria: 'transporte' },
  { patron: 'RENFE', categoria: 'transporte' },
  { patron: 'METRO DE MADRID', categoria: 'transporte' },
  { patron: 'EMT MADRID', categoria: 'transporte' },
  { patron: 'PARKING', categoria: 'transporte' },
  { patron: 'AUTOPISTA', categoria: 'transporte' },

  // -- Comida y bares: la compra y la calle ---------------------------------
  { patron: 'MERCADONA', categoria: 'comida' },
  { patron: 'CARREFOUR', categoria: 'comida' },
  { patron: 'LIDL', categoria: 'comida' },
  { patron: 'ALCAMPO', categoria: 'comida' },
  { patron: 'SUPERCOR', categoria: 'comida' },
  { patron: 'EL CORTE INGLES SUPER', categoria: 'comida' },
  { patron: 'SUPERMERCADOS DIA', categoria: 'comida' },
  { patron: 'DIA 3', categoria: 'comida' },
  { patron: 'ALDI', categoria: 'comida' },
  { patron: 'COSTCO', categoria: 'comida' },
  { patron: 'GLOVO', categoria: 'comida' },
  { patron: 'JUST EAT', categoria: 'comida' },
  { patron: 'DELIVEROO', categoria: 'comida' },
  { patron: 'MC DONALDS', categoria: 'comida' },
  { patron: 'MCDONALDS', categoria: 'comida' },
  { patron: 'BURGER KING', categoria: 'comida' },
  { patron: 'STARBUCKS', categoria: 'comida' },
  { patron: 'CAFETERIA', categoria: 'comida' },
  { patron: 'CAFE', categoria: 'comida' },
  { patron: 'RESTAURANT', categoria: 'comida' },
  { patron: 'BAR ', categoria: 'comida' },
  { patron: 'BREWERY', categoria: 'comida' },
  { patron: 'SUSHI', categoria: 'comida' },
  { patron: 'PIZZ', categoria: 'comida' },
  { patron: 'CERVEC', categoria: 'comida' },
  { patron: 'PANADERIA', categoria: 'comida' },
  { patron: 'CAVA PARQUE', categoria: 'comida' },
  // los tres meses de Bali: warungs, cafés y minimarkets
  { patron: 'WARUNG', categoria: 'comida' },
  { patron: 'ALFAMRT', categoria: 'comida' },
  { patron: 'INDOMARET', categoria: 'comida' },
  { patron: 'DAY MART', categoria: 'comida' },
  { patron: 'MERTA MART', categoria: 'comida' },
  { patron: 'GALIH MART', categoria: 'comida' },
  { patron: 'BOX MART', categoria: 'comida' },
  { patron: 'FRESH MARKET', categoria: 'comida' },
  { patron: 'MINIMARKET', categoria: 'comida' },
  { patron: 'CANTEEN', categoria: 'comida' },
  { patron: 'EATERY', categoria: 'comida' },
  { patron: 'RESTO', categoria: 'comida' },
  { patron: 'ULUWATU', categoria: 'comida' },
  { patron: 'BINGIN', categoria: 'comida' },
  { patron: 'PECATU', categoria: 'comida' },

  // -- La liquidación de la tarjeta de crédito ------------------------------
  // No es un gasto nuevo: es el cobro de golpe de compras que ya se hicieron.
  // Va casi al final para que un cargo de gasolina a crédito cuente como
  // gasolina si el banco lo detalla.
  { tipo: 'liquidacion', categoria: 'credito' },
  { patron: 'LIQUIDACION DE LAS TARJETAS', categoria: 'credito' },

  // -- Bizums: lo último, para no tragarse nada de lo de arriba -------------
  { tipo: 'bizum', categoria: 'bizums' },
];

/** Sin acentos, en mayúsculas y sin dobles espacios: los bancos escriben mal. */
export function llano(s: string | null | undefined): string {
  return (s ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * ¿La otra parte es una PERSONA y no una empresa?
 *
 * Hace falta porque sus pagos a gente no salen todos como bizum: los de Revolut
 * salen como transferencia con el nombre en la contraparte, y así se quedaban
 * fuera 1.181 € —el 21% de su gasto— en «Sin categoría». Se mira solo en
 * transferencias que ya no ha reconocido nadie, así que equivocarse aquí sale
 * barato: un nombre de dos o tres palabras, sin cifras, sin formas societarias
 * y sin pintas de comercio.
 */
export function pareceUnaPersona(nombre: string | null | undefined): boolean {
  // Revolut antepone «Jun Payment To …» al nombre del destinatario
  const t = llano(nombre).replace(/^[A-Z]{3} PAYMENT TO /, '').replace(/[.,]/g, ' ').trim();
  if (!t) return false;
  if (/[0-9*@]|\bWWW\b|\.COM|\.ES\b/.test(t)) return false;
  if (/\b(SL|SLU|SA|SAU|SL |LTD|LLC|INC|GMBH|BV|SRL|SPA|CORP|COOP|ASOC|FUNDACION|SOCIEDAD|SERVICIOS|GESTION|SEGUROS|BANCO|SEGURIDAD SOCIAL|TGSS|AEAT)\b/.test(t)) return false;
  const palabras = t.split(/\s+/).filter(Boolean);
  if (palabras.length < 2 || palabras.length > 5) return false;
  return palabras.every((p) => /^[A-ZÑ'-]{2,}$/.test(p));
}

export interface Categorizable {
  concept?: string | null;
  counterparty?: string | null;
  tipo?: string | null;
}

function encaja(r: Regla, texto: string, tipo: string): boolean {
  if (r.tipo && r.tipo !== tipo) return false;
  if (r.patron && !texto.includes(llano(r.patron))) return false;
  // una regla sin patrón ni tipo no filtra nada: se ignora en vez de tragárselo todo
  return Boolean(r.patron || r.tipo);
}

/**
 * La categoría de un movimiento, o null si no se sabe.
 *
 * `propias` son las reglas que ha corregido él y van primero: si dice que
 * GOPAYID es comida, es comida, aunque aquí ponga transporte.
 */
export function categoriaDe(m: Categorizable, propias: Regla[] = []): Categoria | null {
  // Un traspaso entre sus cuentas no es un gasto: no se categoriza.
  if (m.tipo === 'traspaso') return null;
  const texto = `${llano(m.concept)} ${llano(m.counterparty)}`;
  const tipo = m.tipo ?? '';
  for (const r of [...propias, ...REGLAS_SEMILLA]) if (encaja(r, texto, tipo)) return r.categoria;

  // Lo último: una transferencia a una persona es dinero a una persona, aunque
  // no sea literalmente un bizum. Los suyos son las deudas que arrastraba y el
  // piso, y sin esto se quedaban fuera del reparto.
  if (tipo === 'transferencia' && (pareceUnaPersona(m.counterparty) || pareceUnaPersona(m.concept))) {
    return 'bizums';
  }
  return null;
}

/**
 * El nombre del comercio TAL CUAL aparece en el texto del banco.
 *
 * Sirve para una cosa muy concreta: cuando él corrige la categoría de un
 * movimiento, esto saca el trozo de texto con el que se reconocerán los demás
 * del mismo sitio. Por eso NO se limpia la puntuación como en las analíticas:
 * el patrón tiene que seguir siendo un trozo literal del concepto, o no
 * encontraría nada («APPLE.COM/BILL» sí, «APPLECOM/BILL» no).
 */
export function comercioDe(m: Categorizable): string | null {
  if (m.counterparty) return llano(m.counterparty).slice(0, 120) || null;
  const t = llano(m.concept);
  const encontrado =
    /^PAGO MOVIL EN ([^,]+)/.exec(t) ??
    /^COMPRA ([^,]+)/.exec(t) ??
    /^TARJETA (?:VISA|MASTERCARD|DEBITO|CREDITO) (.+)/.exec(t) ??
    /^RECIBO ([^,]+)/.exec(t) ??
    /^BIZUM A FAVOR DE ([^,]+?)(?: CONCEPTO.*)?$/.exec(t) ??
    /^TRANSFERENCIA (?:INMEDIATA )?A FAVOR DE ([^,]+)/.exec(t);
  const nombre = (encontrado ? encontrado[1] : t).trim();
  // Un patrón de tres letras engancharía media cuenta: mejor no ofrecer regla
  return nombre.length >= 4 ? nombre.slice(0, 120) : null;
}
