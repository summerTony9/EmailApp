import nodemailer from 'nodemailer';
import { buildEmail } from './emailTemplate.js';
import { requireValidSettings } from './validation.js';

function detailedError(error) {
  const parts = [error?.message || String(error)];
  if (error?.code) parts.push(`code: ${error.code}`);
  if (error?.command) parts.push(`command: ${error.command}`);
  if (error?.response) parts.push(`response: ${error.response}`);
  return parts.join(' | ');
}

export function createTransport(settings) {
  const encryption = String(settings.smtpEncryption || 'tls').trim();
  return nodemailer.createTransport({
    host: settings.smtpHost,
    port: Number(settings.smtpPort),
    secure: encryption === 'tls',
    requireTLS: encryption === 'starttls',
    ignoreTLS: encryption === 'none',
    auth: {
      user: settings.smtpUsername,
      pass: settings.smtpPassword
    },
    connectionTimeout: 20000,
    greetingTimeout: 20000,
    socketTimeout: 30000
  });
}

export async function sendEmail(settings, recipient) {
  requireValidSettings(settings, { requireSmtp: true });
  const preview = buildEmail(recipient.companyName, settings);
  const transporter = createTransport(settings);

  try {
    await transporter.sendMail({
      from: {
        address: settings.fromEmail,
        name: settings.fromName || undefined
      },
      to: recipient.email,
      subject: preview.subject,
      text: preview.text,
      html: preview.html
    });
  } catch (error) {
    throw new Error(`SMTP 发送失败：${detailedError(error)}`);
  } finally {
    transporter.close();
  }
}

export async function sendTestEmail(settings, email, companyName = '北京创谱科技有限公司') {
  return sendEmail(settings, {
    email,
    companyName
  });
}
