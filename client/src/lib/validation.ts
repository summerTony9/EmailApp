import type { AppConfig, RecipientRow } from './types';

export function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

export function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeEmail(email));
}

export function getConfigWarnings(config: AppConfig) {
  const warnings: string[] = [];
  if (!config.serverUrl.trim()) warnings.push('服务端地址不能为空');
  if (!config.apiToken.trim()) warnings.push('API Token 不能为空');
  if (!config.smtpHost.trim()) warnings.push('SMTP 服务器不能为空');
  if (!Number.isFinite(config.smtpPort) || config.smtpPort <= 0) warnings.push('SMTP 端口无效');
  if (!config.smtpUsername.trim()) warnings.push('SMTP 账号不能为空');
  if (!config.smtpPassword.trim()) warnings.push('SMTP 密码不能为空');
  if (!isValidEmail(config.fromEmail)) warnings.push('发件人邮箱无效');
  if (!config.branchName.trim()) warnings.push('支行名不能为空');
  if (!config.presidentName.trim()) warnings.push('行长名不能为空');
  if (!config.managerName.trim()) warnings.push('客户经理姓名不能为空');
  if (!config.managerPhone.trim()) warnings.push('客户经理电话不能为空');
  if (!Number.isFinite(config.sendIntervalSeconds) || config.sendIntervalSeconds < 0) {
    warnings.push('发送间隔不能小于 0 秒');
  }
  if (!Number.isFinite(config.sendLimitPerBatch) || config.sendLimitPerBatch < 0) {
    warnings.push('每次发送上限不能小于 0');
  }
  return warnings;
}

export function getSentImportWarnings(config: AppConfig) {
  const warnings: string[] = [];
  if (!config.serverUrl.trim()) warnings.push('服务端地址不能为空');
  if (!config.apiToken.trim()) warnings.push('API Token 不能为空');
  if (!config.branchName.trim()) warnings.push('支行名不能为空');
  if (!config.presidentName.trim()) warnings.push('行长名不能为空');
  if (!config.managerName.trim()) warnings.push('客户经理姓名不能为空');
  if (!config.managerPhone.trim()) warnings.push('客户经理电话不能为空');
  return warnings;
}

export function getImportStats(rows: RecipientRow[]) {
  return {
    total: rows.length,
    valid: rows.filter((row) => row.isValid).length,
    invalid: rows.filter((row) => !row.isValid).length,
    sent: rows.filter((row) => row.status === 'sent').length,
    skipped: rows.filter((row) => row.status === 'skipped').length,
    failed: rows.filter((row) => row.status === 'failed').length
  };
}

export function getRunnableRecipients(rows: RecipientRow[]) {
  return rows.filter((row) => row.isValid && row.status !== 'sent' && row.status !== 'skipped');
}
