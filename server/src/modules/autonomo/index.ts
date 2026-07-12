import { Router } from 'express';
import { z } from 'zod';
import { and, asc, desc, eq, isNull, like } from 'drizzle-orm';
import { ah } from '../../lib/async';
import { db } from '../../db';
import { autonomoProfile, invoiceClients, invoices } from '../../db/schema';
import type { AuthedRequest } from '../../core/auth/middleware';
import { buildInvoicePdf } from './pdf';
import { sendInvoiceEmail, smtpConfigured } from './mailer';

// Módulo "Autónomo": facturación, cuentas y trimestrales.
export const autonomoModule = Router();

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
  res.json(rows);
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
