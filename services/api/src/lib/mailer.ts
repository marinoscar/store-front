import nodemailer, { type Transporter } from 'nodemailer';
import { env } from '../config.js';

let cached: Transporter | undefined;

export function mailer(): Transporter {
  if (cached) return cached;
  cached = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_PORT === 465,
    auth: env.SMTP_USER
      ? { user: env.SMTP_USER, pass: env.SMTP_PASS }
      : undefined,
  });
  return cached;
}

export type QuoteEmailInput = {
  to: string;
  cc?: string;
  brandName: string;
  fromOverride?: string;
  customerName: string;
  pdfBuffer: Buffer;
  pdfFilename: string;
  estimate?: { low: number; high: number; currency: string };
};

export async function sendQuoteEmail(input: QuoteEmailInput): Promise<void> {
  const estimateLine = input.estimate
    ? `Estimated range: ${input.estimate.currency} ${input.estimate.low}–${input.estimate.high}.\n\n`
    : '';

  const text =
    `Hi ${input.customerName},\n\n` +
    `Thanks for requesting a quote from ${input.brandName}. ` +
    `Your detailed quote is attached as a PDF.\n\n` +
    estimateLine +
    `We'll follow up shortly to confirm scheduling.\n\n` +
    `— The ${input.brandName} team`;

  await mailer().sendMail({
    from: input.fromOverride ?? env.SMTP_FROM,
    to: input.to,
    cc: input.cc,
    subject: `Your quote from ${input.brandName}`,
    text,
    attachments: [
      {
        filename: input.pdfFilename,
        content: input.pdfBuffer,
        contentType: 'application/pdf',
      },
    ],
  });
}
