import { Router } from 'express';
import express from 'express';
import crypto from 'node:crypto';
import { z } from 'zod';
import { and, asc, desc, eq, inArray, isNull, like, max } from 'drizzle-orm';
import { ah } from '../../lib/async';
import { db } from '../../db';
import { autonomoProfile, invoiceClients, invoiceImageData, invoiceImages, invoices } from '../../db/schema';
import type { AuthedRequest } from '../../core/auth/middleware';
import { buildInvoicePdf } from './pdf';
import { sendInvoiceEmail, smtpConfigured } from './mailer';
import { bancoRouter } from './banco-routes';
import { obligacionesRouter } from './obligaciones-routes';
import { analiticaRouter } from './analitica-routes';
import { opcionesDeLlave, verificarLlaveDe } from '../../core/auth/passkeys';
import { firmarPase, MINUTOS_DE_PASE, requierePase } from '../../core/auth/pase';

// Módulo "Autónomo": facturación, cuentas y trimestrales.
export const autonomoModule = Router();

/**
 * Aquí está el dinero, así que tener la sesión abierta no basta: hace falta
 * volver a firmar con Face ID. Es la misma puerta que Persona —el mismo pase,
 * corto y en memoria— con su propio ámbito: el del diario no abre esto.
 *
 * Se pide en el SERVIDOR y en todas las rutas del módulo. Las dos excepciones
 * están abajo y son de puerta, no de datos: pedir la firma y volver del banco.
 */
autonomoModule.post('/llave/opciones', ah(async (req: AuthedRequest, res) => {
  const r = await opcionesDeLlave(req.userId!, req.body?.otro === true);
  if (!r) return res.status(400).json({ error: 'Necesitas una llave de acceso registrada para abrir Finanzas' });
  res.json(r);
}));

autonomoModule.post('/llave/abrir', ah(async (req: AuthedRequest, res) => {
  const parsed = z.object({ flowId: z.string().min(1), response: z.any() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Datos incompletos' });
  const vale = await verificarLlaveDe(req.userId!, parsed.data.flowId, parsed.data.response);
  if (!vale) return res.status(401).json({ error: 'No se pudo verificar' });
  res.json({ pase: firmarPase(req.userId!, 'finanzas'), minutos: MINUTOS_DE_PASE });
}));

/**
 * La vuelta del banco se queda FUERA del pase a propósito: el navegador acaba
 * de volver de la web del banco con un código de un solo uso y la pestaña se ha
 * recargado, así que el pase —que vive en memoria— ya no está. Pedir la cara
 * justo ahí tiraría la autorización que acabas de dar. Sigue exigiendo sesión,
 * y lo que hace es cerrar un permiso que tú mismo has concedido hace un segundo.
 */
autonomoModule.use((req, res, next) =>
  req.method === 'POST' && req.path === '/banco/vuelta' ? next() : requierePase('finanzas')(req as AuthedRequest, res, next),
);

// La lectura del banco vive aparte (es otro mundo: PSD2, consentimientos,
// sincronización) pero cuelga de aquí porque es la misma parcela del portal.
autonomoModule.use('/banco', bancoRouter);

// Obligaciones cruza las dos mitades del módulo: las facturas dicen lo que
// debes a Hacienda y el banco dice lo que tienes apartado para pagarlo.
autonomoModule.use('/obligaciones', obligacionesRouter);

// Analíticas: si el patrimonio crece o no. Cuelga del banco porque de ahí salen
// todos sus datos.
autonomoModule.use('/analitica', analiticaRouter);

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha inválida (YYYY-MM-DD)');
const money = z.number().positive().max(9_999_999);
const pctField = z.number().min(0).max(99.99);

// Importes SIEMPRE en céntimos y redondeo estándar: es la parte delicada.
function computeAmounts(base: number, vatPct: number, irpfPct: number) {
  const baseCents = Math.round(base * 100);
  const vatCents = Math.round((baseCents * vatPct) / 100);
  const irpfCents = Math.round((baseCents * irpfPct) / 100);
  const totalCents = baseCents + vatCents - irpfCents;
  const f = (c: number) => (c / 100).toFixed(2);
  return { base: f(baseCents), vatAmount: f(vatCents), irpfAmount: f(irpfCents), total: f(totalCents) };
}

// Numeración correlativa YYYYNNN por año de emisión (2026001, 2026002...)
async function nextNumber(userId: number, year: number): Promise<string> {
  const rows = await db
    .select({ number: invoices.number })
    .from(invoices)
    .where(and(eq(invoices.userId, userId), eq(invoices.kind, 'income'), like(invoices.number, `${year}%`)))
    .orderBy(desc(invoices.number))
    .limit(1);
  const last = rows[0]?.number;
  const seq = last ? Number(last.slice(4)) + 1 : 1;
  return `${year}${String(seq).padStart(3, '0')}`;
}

// ---------- Perfil fiscal ----------
autonomoModule.get('/profile', ah(async (req: AuthedRequest, res) => {
  const [row] = await db.select().from(autonomoProfile).where(eq(autonomoProfile.userId, req.userId!));
  res.json(row ?? null);
}));

// ---------- Clientes/pagadores ----------
autonomoModule.get('/clients', ah(async (req: AuthedRequest, res) => {
  const rows = await db
    .select()
    .from(invoiceClients)
    .where(and(eq(invoiceClients.userId, req.userId!), isNull(invoiceClients.archivedAt)))
    .orderBy(asc(invoiceClients.name));
  res.json(rows);
}));

const clientInput = z.object({
  name: z.string().trim().min(1).max(160),
  taxId: z.string().trim().max(20).nullish(),
  addressLine: z.string().trim().max(200).nullish(),
  cityLine: z.string().trim().max(200).nullish(),
  phone: z.string().trim().max(40).nullish(),
  email: z.string().trim().email().max(160).nullish(),
});

autonomoModule.post('/clients', ah(async (req: AuthedRequest, res) => {
  const parsed = clientInput.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  const [result] = await db.insert(invoiceClients).values({ ...parsed.data, userId: req.userId! });
  const [row] = await db.select().from(invoiceClients).where(eq(invoiceClients.id, result.insertId));
  res.status(201).json(row);
}));

autonomoModule.patch('/clients/:id', ah(async (req: AuthedRequest, res) => {
  const id = Number(req.params.id);
  const parsed = clientInput.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  const [result] = await db
    .update(invoiceClients)
    .set(parsed.data)
    .where(and(eq(invoiceClients.id, id), eq(invoiceClients.userId, req.userId!)));
  if (result.affectedRows === 0) return res.status(404).json({ error: 'Empresa no encontrada' });
  const [row] = await db.select().from(invoiceClients).where(eq(invoiceClients.id, id));
  res.json(row);
}));

// ---------- Facturas ----------
// ---------- El escaneo de una factura ----------

/**
 * Firma de una foto. No caduca a propósito: si caducara, el navegador no podría
 * cachearla y cada visita volvería a pedir los bytes. Lo que protege es que sin
 * el secreto del servidor la dirección no se puede fabricar. Es la misma pieza
 * que ya usan las imágenes de Metas.
 */
function firmaFoto(id: number, size: 'thumb' | 'full'): string {
  return crypto
    .createHmac('sha256', process.env.JWT_SECRET as string)
    .update(`invoice-img:${id}:${size}`)
    .digest('hex')
    .slice(0, 32);
}

const urlFoto = (id: number, size: 'thumb' | 'full') =>
  `/api/autonomo/facturas/foto/${id}/${size}?t=${firmaFoto(id, size)}`;

/** Las fotos de un puñado de facturas, agrupadas. Una consulta, no una por factura. */
async function fotosDe(userId: number, facturas: number[]) {
  if (!facturas.length) return new Map<number, { id: number; thumbUrl: string; fullUrl: string }[]>();
  const filas = await db
    .select({ id: invoiceImages.id, invoiceId: invoiceImages.invoiceId })
    .from(invoiceImages)
    .where(and(eq(invoiceImages.userId, userId), inArray(invoiceImages.invoiceId, facturas)))
    .orderBy(asc(invoiceImages.sortOrder), asc(invoiceImages.id));

  const por = new Map<number, { id: number; thumbUrl: string; fullUrl: string }[]>();
  for (const f of filas) {
    const lista = por.get(f.invoiceId) ?? por.set(f.invoiceId, []).get(f.invoiceId)!;
    lista.push({ id: f.id, thumbUrl: urlFoto(f.id, 'thumb'), fullUrl: urlFoto(f.id, 'full') });
  }
  return por;
}

// La dirección de los bytes va firmada y NO exige sesión: el <img> del
// navegador no manda la cabecera de autorización. Sin la firma no se puede
// fabricar, y la firma solo sale en respuestas que sí exigieron sesión.
export const facturaFotosRouter = Router();
facturaFotosRouter.get('/facturas/foto/:id(\\d+)/:size', ah(async (req, res) => {
  const id = Number(req.params.id);
  const size = req.params.size === 'full' ? 'full' : 'thumb';

  const esperada = firmaFoto(id, size);
  const recibida = String(req.query.t ?? '');
  const ok =
    recibida.length === esperada.length &&
    crypto.timingSafeEqual(Buffer.from(recibida), Buffer.from(esperada));
  if (!ok) return res.status(403).json({ error: 'Firma inválida' });

  const [ficha] = await db.select({ mime: invoiceImages.mime }).from(invoiceImages).where(eq(invoiceImages.id, id));
  if (!ficha) return res.status(404).json({ error: 'Foto no encontrada' });

  const [datos] = await db
    .select(size === 'full' ? { bytes: invoiceImageData.full } : { bytes: invoiceImageData.thumb })
    .from(invoiceImageData)
    .where(eq(invoiceImageData.imageId, id));
  if (!datos) return res.status(404).json({ error: 'Foto no encontrada' });

  res.setHeader('Content-Type', ficha.mime);
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  // el front vive en otro dominio que la API: sin esto el navegador no la pinta
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  res.send(datos.bytes);
}));

// El navegador manda la foto ya reducida en base64, en dos tamaños. Este cuerpo
// es más grande que el resto de la API y por eso lleva su propio analizador.
const subirFoto = z.object({
  mime: z.enum(['image/webp', 'image/jpeg', 'image/png']).default('image/webp'),
  thumb: z.string().min(1),
  full: z.string().min(1),
});
const LIMITE_FOTO = 1_500_000; // bytes por versión, ya reducida

autonomoModule.post(
  '/invoices/:id(\\d+)/fotos',
  express.json({ limit: '4mb' }),
  ah(async (req: AuthedRequest, res) => {
    const facturaId = Number(req.params.id);
    const parsed = subirFoto.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });

    const [suya] = await db
      .select({ id: invoices.id })
      .from(invoices)
      .where(and(eq(invoices.id, facturaId), eq(invoices.userId, req.userId!)));
    if (!suya) return res.status(404).json({ error: 'Factura no encontrada' });

    const thumb = Buffer.from(parsed.data.thumb, 'base64');
    const full = Buffer.from(parsed.data.full, 'base64');
    if (!thumb.length || !full.length) return res.status(400).json({ error: 'La foto llegó vacía' });
    if (thumb.length > LIMITE_FOTO || full.length > LIMITE_FOTO) {
      return res.status(413).json({ error: 'La foto es demasiado grande' });
    }

    const [{ n }] = await db
      .select({ n: max(invoiceImages.sortOrder) })
      .from(invoiceImages)
      .where(eq(invoiceImages.invoiceId, facturaId));

    const [r] = await db.insert(invoiceImages).values({
      userId: req.userId!,
      invoiceId: facturaId,
      mime: parsed.data.mime,
      bytes: full.length,
      sortOrder: (n ?? 0) + 1,
    });
    await db.insert(invoiceImageData).values({ imageId: r.insertId, thumb, full });

    res.status(201).json({ id: r.insertId, thumbUrl: urlFoto(r.insertId, 'thumb'), fullUrl: urlFoto(r.insertId, 'full') });
  }),
);

autonomoModule.delete('/invoices/fotos/:id(\\d+)', ah(async (req: AuthedRequest, res) => {
  const id = Number(req.params.id);
  const [r] = await db
    .delete(invoiceImages)
    .where(and(eq(invoiceImages.id, id), eq(invoiceImages.userId, req.userId!)));
  if (!r.affectedRows) return res.status(404).json({ error: 'Foto no encontrada' });
  await db.delete(invoiceImageData).where(eq(invoiceImageData.imageId, id));
  res.json({ deleted: true });
}));

// GET /invoices?year=&kind= — no archivadas, más recientes primero
autonomoModule.get('/invoices', ah(async (req: AuthedRequest, res) => {
  const conds = [eq(invoices.userId, req.userId!), isNull(invoices.archivedAt)];
  const year = req.query.year ? Number(req.query.year) : undefined;
  if (year) conds.push(like(invoices.issueDate, `${year}-%`));
  const kind = req.query.kind ? String(req.query.kind) : undefined;
  if (kind === 'income' || kind === 'expense') conds.push(eq(invoices.kind, kind));
  const rows = await db
    .select()
    .from(invoices)
    .where(and(...conds))
    .orderBy(desc(invoices.issueDate), desc(invoices.number));

  const fotos = await fotosDe(req.userId!, rows.map((r) => r.id));
  res.json(rows.map((r) => ({ ...r, fotos: fotos.get(r.id) ?? [] })));
}));

autonomoModule.get('/invoices/next-number', ah(async (req: AuthedRequest, res) => {
  const year = req.query.year ? Number(req.query.year) : new Date().getFullYear();
  res.json({ number: await nextNumber(req.userId!, year) });
}));

const incomeInput = z.object({
  kind: z.literal('income'),
  clientId: z.number().int().positive(),
  issueDate: isoDate,
  concept: z.string().trim().min(1).max(255),
  base: money,
  vatPct: pctField,
  irpfPct: pctField,
});

const expenseInput = z.object({
  kind: z.literal('expense'),
  origin: z.string().trim().min(1).max(200),
  number: z.string().trim().min(1).max(40),
  issueDate: isoDate,
  concept: z.string().trim().max(255).nullish(),
  base: money,
  vatPct: pctField,
  irpfPct: pctField.default(0),
});

autonomoModule.post('/invoices', ah(async (req: AuthedRequest, res) => {
  const parsed = z.discriminatedUnion('kind', [incomeInput, expenseInput]).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  const data = parsed.data;
  const amounts = computeAmounts(data.base, data.vatPct, data.irpfPct);

  let origin: string;
  let clientId: number | null = null;
  let number: string;
  if (data.kind === 'income') {
    const [client] = await db
      .select()
      .from(invoiceClients)
      .where(and(eq(invoiceClients.id, data.clientId), eq(invoiceClients.userId, req.userId!)));
    if (!client) return res.status(400).json({ error: 'El cliente indicado no existe' });
    origin = client.name;
    clientId = client.id;
    number = await nextNumber(req.userId!, Number(data.issueDate.slice(0, 4)));
  } else {
    origin = data.origin;
    number = data.number;
  }

  const [result] = await db.insert(invoices).values({
    userId: req.userId!,
    kind: data.kind,
    clientId,
    origin,
    number,
    issueDate: data.issueDate,
    concept: data.concept ?? null,
    vatPct: data.vatPct.toFixed(2),
    irpfPct: data.irpfPct.toFixed(2),
    ...amounts,
  });
  const [row] = await db.select().from(invoices).where(eq(invoices.id, result.insertId));
  res.status(201).json(row);
}));

const invoiceUpdate = z.object({
  issueDate: isoDate.optional(),
  concept: z.string().trim().max(255).nullish(),
  origin: z.string().trim().min(1).max(200).optional(), // solo gastos
  number: z.string().trim().min(1).max(40).optional(), // solo gastos
  base: money.optional(),
  vatPct: pctField.optional(),
  irpfPct: pctField.optional(),
});

autonomoModule.patch('/invoices/:id', ah(async (req: AuthedRequest, res) => {
  const id = Number(req.params.id);
  const parsed = invoiceUpdate.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  const [current] = await db
    .select()
    .from(invoices)
    .where(and(eq(invoices.id, id), eq(invoices.userId, req.userId!)));
  if (!current) return res.status(404).json({ error: 'Factura no encontrada' });

  const d = parsed.data;
  if (current.kind === 'income' && current.status === 'sent') {
    return res.status(400).json({ error: 'Una factura enviada está congelada y no se puede editar' });
  }
  if (current.kind === 'income' && (d.origin || d.number)) {
    return res.status(400).json({ error: 'El nº y el cliente de una factura emitida no se cambian (numeración correlativa)' });
  }
  const base = d.base ?? Number(current.base);
  const vatPct = d.vatPct ?? Number(current.vatPct);
  const irpfPct = d.irpfPct ?? Number(current.irpfPct);
  const amounts = computeAmounts(base, vatPct, irpfPct);

  await db
    .update(invoices)
    .set({
      issueDate: d.issueDate ?? current.issueDate,
      concept: d.concept === undefined ? current.concept : d.concept,
      origin: d.origin ?? current.origin,
      number: d.number ?? current.number,
      vatPct: vatPct.toFixed(2),
      irpfPct: irpfPct.toFixed(2),
      ...amounts,
    })
    .where(eq(invoices.id, id));
  const [row] = await db.select().from(invoices).where(eq(invoices.id, id));
  res.json(row);
}));

// DELETE — archiva (ojo: en emitidas deja hueco en la numeración; responsabilidad del usuario)
autonomoModule.delete('/invoices/:id', ah(async (req: AuthedRequest, res) => {
  const id = Number(req.params.id);
  const [result] = await db
    .update(invoices)
    .set({ archivedAt: new Date() })
    .where(and(eq(invoices.id, id), eq(invoices.userId, req.userId!), isNull(invoices.archivedAt)));
  if (result.affectedRows === 0) return res.status(404).json({ error: 'Factura no encontrada' });
  res.json({ archived: true });
}));

// PDF de una factura emitida (se regenera al vuelo, no se almacena)
autonomoModule.get('/invoices/:id/pdf', ah(async (req: AuthedRequest, res) => {
  const id = Number(req.params.id);
  const [inv] = await db
    .select()
    .from(invoices)
    .where(and(eq(invoices.id, id), eq(invoices.userId, req.userId!)));
  if (!inv) return res.status(404).json({ error: 'Factura no encontrada' });
  if (inv.kind !== 'income') return res.status(400).json({ error: 'Solo las facturas emitidas tienen PDF' });

  const [profile] = await db.select().from(autonomoProfile).where(eq(autonomoProfile.userId, req.userId!));
  if (!profile) return res.status(400).json({ error: 'Falta el perfil fiscal' });
  const [client] = inv.clientId
    ? await db.select().from(invoiceClients).where(eq(invoiceClients.id, inv.clientId))
    : [];
  const payer = client ?? { name: inv.origin, taxId: null, addressLine: null, cityLine: null, phone: null };

  const bytes = await buildInvoicePdf(inv, profile, payer);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="Factura-${inv.number}.pdf"`);
  res.send(Buffer.from(bytes));
}));

// Paso 2 del flujo: aprobar tras revisar (draft -> reviewed)
autonomoModule.post('/invoices/:id/approve', ah(async (req: AuthedRequest, res) => {
  const id = Number(req.params.id);
  const [inv] = await db
    .select()
    .from(invoices)
    .where(and(eq(invoices.id, id), eq(invoices.userId, req.userId!)));
  if (!inv) return res.status(404).json({ error: 'Factura no encontrada' });
  if (inv.kind !== 'income') return res.status(400).json({ error: 'Solo aplica a facturas emitidas' });
  if (inv.status === 'sent') return res.status(400).json({ error: 'La factura ya está enviada' });
  await db.update(invoices).set({ status: 'reviewed' }).where(eq(invoices.id, id));
  const [row] = await db.select().from(invoices).where(eq(invoices.id, id));
  res.json(row);
}));

// Paso 3 del flujo: enviar por email con el PDF adjunto (reviewed -> sent)
const sendInput = z.object({
  to: z.string().trim().email(),
  subject: z.string().trim().min(1).max(200),
  message: z.string().trim().min(1).max(5000),
});

autonomoModule.post('/invoices/:id/send', ah(async (req: AuthedRequest, res) => {
  const id = Number(req.params.id);
  const parsed = sendInput.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });

  const [inv] = await db
    .select()
    .from(invoices)
    .where(and(eq(invoices.id, id), eq(invoices.userId, req.userId!)));
  if (!inv) return res.status(404).json({ error: 'Factura no encontrada' });
  if (inv.kind !== 'income') return res.status(400).json({ error: 'Solo aplica a facturas emitidas' });
  if (inv.status === 'draft') return res.status(400).json({ error: 'Revisa y aprueba la factura antes de enviarla' });
  if (inv.status === 'sent') return res.status(400).json({ error: 'La factura ya fue enviada' });
  if (!smtpConfigured()) {
    return res.status(503).json({ error: 'El envío por email aún no está configurado (falta el buzón SMTP)' });
  }

  const [profile] = await db.select().from(autonomoProfile).where(eq(autonomoProfile.userId, req.userId!));
  if (!profile) return res.status(400).json({ error: 'Falta el perfil fiscal' });
  const [client] = inv.clientId
    ? await db.select().from(invoiceClients).where(eq(invoiceClients.id, inv.clientId))
    : [];
  const payer = client ?? { name: inv.origin, taxId: null, addressLine: null, cityLine: null, phone: null };

  const pdfBytes = await buildInvoicePdf(inv, profile, payer);
  await sendInvoiceEmail({
    to: parsed.data.to,
    subject: parsed.data.subject,
    message: parsed.data.message,
    fromName: profile.fullName,
    pdfName: `Factura-${inv.number}.pdf`,
    pdfBytes,
  });

  await db
    .update(invoices)
    .set({ status: 'sent', emailedTo: parsed.data.to, emailedAt: new Date() })
    .where(eq(invoices.id, id));
  const [row] = await db.select().from(invoices).where(eq(invoices.id, id));
  res.json(row);
}));

// ---------- Resumen trimestral ----------
// GET /summary?year= — por trimestre: bases y cuotas de ingresos y gastos
autonomoModule.get('/summary', ah(async (req: AuthedRequest, res) => {
  const year = req.query.year ? Number(req.query.year) : new Date().getFullYear();
  const rows = await db
    .select()
    .from(invoices)
    .where(and(eq(invoices.userId, req.userId!), isNull(invoices.archivedAt), like(invoices.issueDate, `${year}-%`)));

  const zero = () => ({
    incomeBase: 0, incomeVat: 0, incomeIrpf: 0,
    expenseBase: 0, expenseVat: 0,
  });
  const quarters = [zero(), zero(), zero(), zero()];
  for (const inv of rows) {
    const q = Math.floor((Number(inv.issueDate.slice(5, 7)) - 1) / 3);
    const t = quarters[q];
    if (inv.kind === 'income') {
      t.incomeBase += Math.round(Number(inv.base) * 100);
      t.incomeVat += Math.round(Number(inv.vatAmount) * 100);
      t.incomeIrpf += Math.round(Number(inv.irpfAmount) * 100);
    } else {
      t.expenseBase += Math.round(Number(inv.base) * 100);
      t.expenseVat += Math.round(Number(inv.vatAmount) * 100);
    }
  }
  const fmt = (t: ReturnType<typeof zero>) => ({
    incomeBase: t.incomeBase / 100,
    incomeVat: t.incomeVat / 100,
    incomeIrpf: t.incomeIrpf / 100,
    expenseBase: t.expenseBase / 100,
    expenseVat: t.expenseVat / 100,
    vatResult: (t.incomeVat - t.expenseVat) / 100, // IVA a pagar (303)
  });
  res.json({ year, quarters: quarters.map(fmt) });
}));
