import nodemailer from 'nodemailer';

// Envío de facturas por email vía SMTP (buzón del dominio en Raiola).
// Si faltan las credenciales, el envío devuelve un error claro y el resto
// del flujo (crear/revisar) sigue funcionando.

export function smtpConfigured(): boolean {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}

export async function sendInvoiceEmail(opts: {
  to: string;
  subject: string;
  message: string;
  fromName: string;
  pdfName: string;
  pdfBytes: Uint8Array;
}) {
  const port = Number(process.env.SMTP_PORT ?? 465);
  const transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: port === 465,
    auth: { user: process.env.SMTP_USER!, pass: process.env.SMTP_PASS! },
  });

  await transport.sendMail({
    from: `"${opts.fromName}" <${process.env.SMTP_USER}>`,
    to: opts.to,
    bcc: process.env.SMTP_USER, // copia para el propio buzón (registro de enviados)
    subject: opts.subject,
    text: opts.message,
    attachments: [{ filename: opts.pdfName, content: Buffer.from(opts.pdfBytes) }],
  });
}
