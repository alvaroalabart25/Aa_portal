import nodemailer from 'nodemailer';

// Envío de correo del portal (buzón del dominio en Raiola). Un único sitio
// donde se construye el transporte, para no repetir la configuración.

export function correoConfigurado(): boolean {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}

export async function enviarCorreo(opts: {
  to: string;
  subject: string;
  text: string;
  fromName?: string;
}): Promise<void> {
  if (!correoConfigurado()) throw new Error('El envío de correo no está configurado');
  const port = Number(process.env.SMTP_PORT ?? 465);
  const transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: port === 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
  await transport.sendMail({
    from: `"${opts.fromName ?? 'Aa Portal'}" <${process.env.SMTP_USER}>`,
    to: opts.to,
    subject: opts.subject,
    text: opts.text,
  });
}
