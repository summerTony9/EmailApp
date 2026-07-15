import { isValidEmail } from './db.js';

export function normalizeTime(value) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(value ?? '').trim());
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

export function isValidTimeZone(value) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: String(value || '') });
    return true;
  } catch {
    return false;
  }
}

export function validateSettings(settings, { requireSmtp = false } = {}) {
  const errors = [];
  const encryption = String(settings.smtpEncryption ?? '').trim();

  if (requireSmtp || settings.enabled) {
    if (!String(settings.smtpHost ?? '').trim()) errors.push('SMTP 服务器不能为空');
    if (!String(settings.smtpUsername ?? '').trim()) errors.push('SMTP 账号不能为空');
    if (!String(settings.smtpPassword ?? '').trim()) errors.push('SMTP 密码/授权码不能为空');
    if (!isValidEmail(settings.fromEmail)) errors.push('发件人邮箱无效');
  }

  if (!Number.isFinite(Number(settings.smtpPort)) || Number(settings.smtpPort) <= 0) {
    errors.push('SMTP 端口无效');
  }
  if (!['tls', 'starttls', 'none'].includes(encryption)) {
    errors.push('SMTP 加密方式无效');
  }
  if (!String(settings.branchName ?? '').trim()) errors.push('支行名不能为空');
  if (!String(settings.presidentName ?? '').trim()) errors.push('行长名不能为空');
  if (!String(settings.managerName ?? '').trim()) errors.push('客户经理姓名不能为空');
  if (!String(settings.managerPhone ?? '').trim()) errors.push('客户经理电话不能为空');
  if (!normalizeTime(settings.sendTime)) errors.push('每日发送时间无效');
  if (!isValidTimeZone(settings.timeZone)) errors.push('时区无效');
  if (!Number.isFinite(Number(settings.dailyLimit)) || Number(settings.dailyLimit) < 0) {
    errors.push('每日发送上限不能小于 0');
  }
  if (
    !Number.isFinite(Number(settings.sendIntervalSeconds)) ||
    Number(settings.sendIntervalSeconds) < 0
  ) {
    errors.push('发送间隔不能小于 0 秒');
  }

  return errors;
}

export function requireValidSettings(settings, options) {
  const errors = validateSettings(settings, options);
  if (errors.length > 0) {
    const error = new Error(errors.join('；'));
    error.statusCode = 400;
    throw error;
  }
}
