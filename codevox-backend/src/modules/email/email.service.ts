import { Injectable, Logger } from '@nestjs/common';
import * as nodemailer from 'nodemailer';

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private transporter: nodemailer.Transporter | null = null;

  constructor() {
    const host = process.env.SMTP_HOST;
    const port = Number(process.env.SMTP_PORT) || 587;
    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASS;

    if (!host || !user) {
      this.logger.warn(
        'SMTP_HOST or SMTP_USER not configured — email sending will be disabled.',
      );
      return;
    }

    this.transporter = nodemailer.createTransport({
      host,
      port,
      secure: port === 465, // true for 465, false for 587 STARTTLS
      auth: {
        user,
        pass: pass || '',
      },
      tls: {
        // STARTTLS — upgrade plain connection to TLS
        rejectUnauthorized: false,
      },
    });

    this.logger.log(`Email transport configured: ${host}:${port} (user: ${user})`);
  }

  isConfigured(): boolean {
    return this.transporter !== null;
  }

  async sendMail(
    to: string,
    subject: string,
    html: string,
  ): Promise<{ accepted: boolean; messageId?: string }> {
    if (!this.transporter) {
      this.logger.warn(`Email not sent (SMTP not configured): to=${to} subject="${subject}"`);
      return { accepted: false };
    }

    const fromEmail = process.env.SMTP_FROM_EMAIL || process.env.SMTP_USER || 'noreply@example.com';
    const replyTo = process.env.SMTP_REPLY_TO || fromEmail;
    try {
      const info = await this.transporter.sendMail({
        from: `"CodeVox" <${fromEmail}>`,
        replyTo,
        to,
        subject,
        html,
      });

      this.logger.log(
        `Email sent: to=${to} subject="${subject}" messageId=${info.messageId}`,
      );

      return {
        accepted: true,
        messageId: info.messageId,
      };
    } catch (err: any) {
      this.logger.error(
        `Email send failed: to=${to} subject="${subject}" error=${err?.message}`,
        err?.stack,
      );
      // Don't throw — email failure shouldn't block the invite flow
      return { accepted: false };
    }
  }
}
