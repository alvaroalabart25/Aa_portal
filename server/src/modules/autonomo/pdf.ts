import { readFileSync } from 'node:fs';
import path from 'node:path';
import { PDFDocument, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import type { AutonomoProfile, Invoice } from '../../db/schema';

// Réplica del diseño de factura del usuario (Canva): A4, fondo crema,
// serif Playfair para "AL"/"FACTURA"/pie, Inter para el cuerpo.

const A4: [number, number] = [595.28, 841.89];
const CREAM = rgb(0.955, 0.949, 0.925);
const INK = rgb(0.08, 0.08, 0.08);
const SOFT = rgb(0.25, 0.25, 0.25);

const FONTS_DIR = path.join(process.cwd(), 'assets', 'fonts');

function eur(cents: number, sign: '+' | '-' | '' = ''): string {
  const abs = Math.abs(cents);
  const units = Math.floor(abs / 100).toString();
  const dec = String(abs % 100).padStart(2, '0');
  const miles = units.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${sign}${miles},${dec}€`;
}

function fechaLarga(iso: string): string {
  const d = new Date(`${iso}T12:00:00`);
  const s = d.toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' });
  // "25 de mayo de 2026" -> "25 de Mayo de 2026" (como el diseño original)
  return s.replace(/ de ([a-záéíóúñ])/, (_, l: string) => ` de ${l.toUpperCase()}`);
}

function pct(v: string): string {
  const n = Number(v);
  return `${Number.isInteger(n) ? n : n.toFixed(2).replace('.', ',')}%`;
}

interface Ctx {
  page: PDFPage;
  serif: PDFFont;
  sans: PDFFont;
  sansSemi: PDFFont;
  sansBold: PDFFont;
}

function drawRight(ctx: Ctx, text: string, font: PDFFont, size: number, rightX: number, topY: number, color = INK) {
  const w = font.widthOfTextAtSize(text, size);
  ctx.page.drawText(text, { x: rightX - w, y: A4[1] - topY - size, size, font, color });
}

function draw(ctx: Ctx, text: string, font: PDFFont, size: number, x: number, topY: number, color = INK) {
  ctx.page.drawText(text, { x, y: A4[1] - topY - size, size, font, color });
}

function drawCenter(ctx: Ctx, text: string, font: PDFFont, size: number, centerX: number, topY: number, color = INK) {
  const w = font.widthOfTextAtSize(text, size);
  ctx.page.drawText(text, { x: centerX - w / 2, y: A4[1] - topY - size, size, font, color });
}

export async function buildInvoicePdf(inv: Invoice, profile: AutonomoProfile, payer: {
  name: string;
  taxId: string | null;
  addressLine: string | null;
  cityLine: string | null;
  phone: string | null;
}): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const serif = await doc.embedFont(readFileSync(path.join(FONTS_DIR, 'playfair-600.ttf')));
  const sans = await doc.embedFont(readFileSync(path.join(FONTS_DIR, 'inter-400.ttf')));
  const sansSemi = await doc.embedFont(readFileSync(path.join(FONTS_DIR, 'inter-600.ttf')));
  const sansBold = await doc.embedFont(readFileSync(path.join(FONTS_DIR, 'inter-700.ttf')));

  const page = doc.addPage(A4);
  page.drawRectangle({ x: 0, y: 0, width: A4[0], height: A4[1], color: CREAM });
  const ctx: Ctx = { page, serif, sans, sansSemi, sansBold };

  const L = 58; // margen izquierdo
  const R = 537; // borde derecho de contenido

  // Cabecera
  draw(ctx, 'AL', serif, 58, L, 48);
  drawRight(ctx, 'FACTURA', serif, 32, R, 66);

  // Bloque pagador (izquierda)
  let y = 143;
  draw(ctx, 'COBRADA A:', sans, 11, L, y, SOFT);
  y += 22;
  draw(ctx, payer.name, sansBold, 11.5, L, y);
  y += 16;
  if (payer.taxId) { draw(ctx, `CIF: ${payer.taxId}`, sans, 11, L, y); y += 16; }
  if (payer.addressLine) { draw(ctx, payer.addressLine, sans, 11, L, y); y += 16; }
  if (payer.cityLine) { draw(ctx, payer.cityLine, sans, 11, L, y); y += 16; }
  if (payer.phone) { draw(ctx, payer.phone, sans, 11, L, y); y += 16; }

  // Bloque meta (derecha)
  let ym = 168;
  drawRight(ctx, `Factura N.º ${inv.number}`, sans, 11, R, ym); ym += 16;
  drawRight(ctx, fechaLarga(inv.issueDate), sans, 11, R, ym); ym += 16;
  drawRight(ctx, profile.fullName, sans, 11, R, ym); ym += 16;
  drawRight(ctx, `NIF: ${profile.taxId}.`, sans, 11, R, ym);

  // Títulos de tabla
  draw(ctx, 'DESCRIPCIÓN', sansBold, 13, 62, 289);
  draw(ctx, 'Importe a pagar', sansBold, 13, 365, 289);

  // Tabla (bordes)
  const tTop = 330;
  const tBottom = 632;
  const tMid = 493; // separador filas
  const cols = [L, 220, 274, 353, R];
  const toY = (top: number) => A4[1] - top;
  const border = { color: INK, thickness: 0.8 };
  // marco y líneas
  page.drawRectangle({ x: L, y: toY(tBottom), width: R - L, height: tBottom - tTop, borderColor: INK, borderWidth: 0.8 });
  for (const cx of cols.slice(1, 4)) {
    page.drawLine({ start: { x: cx, y: toY(tTop) }, end: { x: cx, y: toY(tBottom) }, ...border });
  }
  page.drawLine({ start: { x: L, y: toY(tMid) }, end: { x: R, y: toY(tMid) }, ...border });

  // Fila 1: concepto + base
  const c1 = (cols[0] + cols[1]) / 2;
  const c2 = (cols[1] + cols[2]) / 2;
  const c3 = (cols[2] + cols[3]) / 2;
  const c4 = (cols[3] + cols[4]) / 2;
  const concept = inv.concept ?? '';
  const row1Y = 398;
  // el concepto puede llevar el sufijo "(Base Imponible)" en línea aparte
  const m = concept.match(/^(.*?)\s*(\(.*\))$/);
  if (m) {
    drawCenter(ctx, m[1], sans, 11.5, c1, row1Y - 9);
    drawCenter(ctx, m[2], sans, 11.5, c1, row1Y + 9);
  } else {
    drawCenter(ctx, concept, sans, 11.5, c1, row1Y);
  }
  drawCenter(ctx, '1', sans, 11.5, c2, row1Y);
  drawCenter(ctx, eur(Math.round(Number(inv.base) * 100), '+'), sans, 11.5, c4, row1Y);

  // Fila 2: IVA e IRPF
  drawCenter(ctx, '+ IVA', sans, 11.5, c1, 519);
  drawCenter(ctx, '1', sans, 11.5, c2, 519);
  drawCenter(ctx, pct(inv.vatPct), sans, 11.5, c3, 519);
  drawCenter(ctx, eur(Math.round(Number(inv.vatAmount) * 100), '+'), sans, 11.5, c4, 519);

  drawCenter(ctx, '- IRPF', sans, 11.5, c1, 563);
  drawCenter(ctx, '1', sans, 11.5, c2, 563);
  drawCenter(ctx, pct(inv.irpfPct), sans, 11.5, c3, 563);
  drawCenter(ctx, eur(Math.round(Number(inv.irpfAmount) * 100), '-'), sans, 11.5, c4, 563);

  // Bloque de pago
  draw(ctx, 'Por favor, efectúe pagos a:', sansBold, 11.5, L, 664);
  draw(ctx, profile.fullName, sans, 11, L, 682);
  if (profile.iban) draw(ctx, `Número de cuenta: ${profile.iban}`, sans, 11, L, 699);

  // Importe total
  draw(ctx, 'Importe total', sansBold, 13.5, 391, 663);
  draw(ctx, eur(Math.round(Number(inv.total) * 100)), sansBold, 23, 391, 685);

  // Pie
  page.drawLine({ start: { x: L, y: toY(749) }, end: { x: R, y: toY(749) }, color: INK, thickness: 0.8 });
  draw(ctx, profile.fullName, serif, 14, L, 757);
  if (profile.addressLine || profile.cityLine) {
    drawRight(ctx, `${profile.addressLine ?? ''} . ${profile.cityLine ?? ''}`, sans, 10.5, R, 760);
  }

  return doc.save();
}
