import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import staticFiles from '@fastify/static';
import Fastify from 'fastify';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  addLog,
  clearPendingRecipients,
  createDatabase,
  getSettings,
  getStats,
  isValidEmail,
  listLogs,
  listRecipients,
  publicSettings,
  resetFailedRecipients,
  saveSettings,
  upsertRecipients
} from './db.js';
import { buildEmail } from './emailTemplate.js';
import { sendTestEmail } from './mailer.js';
import { parseRecipientFile } from './recipientParser.js';
import { createScheduler } from './scheduler.js';
import { normalizeTime, validateSettings } from './validation.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(__dirname, '../public');

function readBearerToken(request) {
  const header = request.headers.authorization || '';
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match?.[1]?.trim() || '';
}

function badRequest(reply, message) {
  return reply.code(400).send({
    error: 'Bad Request',
    message
  });
}

function buildState(db, scheduler) {
  const settings = getSettings(db);
  return {
    settings: publicSettings(settings),
    settingsWarnings: validateSettings(settings, { requireSmtp: settings.enabled }),
    stats: getStats(db),
    recipients: listRecipients(db),
    logs: listLogs(db),
    scheduler: scheduler.status(),
    preview: buildEmail('北京创谱科技有限公司', settings)
  };
}

function candidateSettings(db, incoming) {
  const current = getSettings(db);
  const candidate = {
    ...current,
    ...incoming
  };
  if (!Object.prototype.hasOwnProperty.call(incoming, 'smtpPassword') || incoming.smtpPassword === '') {
    candidate.smtpPassword = current.smtpPassword;
  }
  const normalizedTime = normalizeTime(candidate.sendTime);
  if (normalizedTime) candidate.sendTime = normalizedTime;
  candidate.dailyLimit = Math.max(0, Math.floor(Number(candidate.dailyLimit) || 0));
  candidate.sendIntervalSeconds = Math.max(0, Math.floor(Number(candidate.sendIntervalSeconds) || 0));
  return candidate;
}

export function buildApp(options = {}) {
  const app = Fastify({
    logger: options.logger ?? true,
    bodyLimit: options.bodyLimit ?? 20 * 1024 * 1024
  });
  const db = options.db ?? createDatabase(options.dbPath);
  const adminToken =
    options.adminToken ??
    process.env.MAILER_ADMIN_TOKEN ??
    process.env.ADMIN_TOKEN ??
    'change-me-before-deploy';
  const scheduler =
    options.scheduler ??
    createScheduler({
      db,
      sendEmail: options.sendEmail,
      tickMs: options.schedulerTickMs,
      logger: app.log
    });

  app.register(cors, {
    origin: true
  });
  app.register(multipart, {
    limits: {
      fileSize: options.maxUploadBytes ?? 20 * 1024 * 1024,
      files: 1
    }
  });
  app.register(staticFiles, {
    root: publicDir,
    prefix: '/'
  });

  app.addHook('preHandler', async (request, reply) => {
    if (!request.url.startsWith('/api/')) return;
    if (!adminToken || adminToken === 'change-me-before-deploy') {
      request.log.warn('MAILER_ADMIN_TOKEN is using an unsafe default value');
    }
    if (readBearerToken(request) !== adminToken) {
      return reply.code(401).send({
        error: 'Unauthorized',
        message: 'Missing or invalid admin token'
      });
    }
  });

  app.get('/health', async () => ({
    ok: true,
    service: 'emailapp-cloud-mailer',
    time: new Date().toISOString()
  }));

  app.get('/api/state', async () => buildState(db, scheduler));

  app.put('/api/settings', async (request, reply) => {
    const incoming = request.body ?? {};
    const candidate = candidateSettings(db, incoming);
    const errors = validateSettings(candidate, { requireSmtp: candidate.enabled });
    if (candidate.enabled && errors.length > 0) {
      return badRequest(reply, errors.join('；'));
    }

    const saved = saveSettings(db, candidate);
    addLog(db, 'info', `配置已保存，定时任务${saved.enabled ? '已启用' : '已停用'}`);
    return {
      settings: publicSettings(saved),
      settingsWarnings: validateSettings(saved, { requireSmtp: saved.enabled })
    };
  });

  app.get('/api/preview', async (request) => {
    const companyName = String(request.query?.companyName || '北京创谱科技有限公司');
    return buildEmail(companyName, getSettings(db));
  });

  app.post('/api/upload', async (request, reply) => {
    const file = await request.file();
    if (!file) return badRequest(reply, '请上传 CSV、XLS 或 XLSX 名单');
    const filename = file.filename || '';
    if (!/\.(csv|xlsx)$/i.test(filename)) {
      return badRequest(reply, '仅支持 CSV、XLSX 文件');
    }

    const buffer = await file.toBuffer();
    const parsed = await parseRecipientFile(buffer, filename);
    const result = parsed.validRows.length > 0 ? upsertRecipients(db, parsed.validRows) : {
      imported: 0,
      keptSent: 0
    };
    addLog(
      db,
      'info',
      `名单导入完成：有效 ${parsed.validRows.length}，无效 ${parsed.invalidRows.length}，保留已发送 ${result.keptSent}`
    );

    return {
      totalRows: parsed.totalRows,
      validRows: parsed.validRows.length,
      invalidRows: parsed.invalidRows.slice(0, 50),
      imported: result.imported,
      keptSent: result.keptSent,
      state: buildState(db, scheduler)
    };
  });

  app.post('/api/test', async (request, reply) => {
    const settings = getSettings(db);
    const email = String(request.body?.email || '').trim().toLowerCase();
    const companyName = String(request.body?.companyName || '北京创谱科技有限公司');
    if (!email) return badRequest(reply, '测试收件邮箱不能为空');
    if (!isValidEmail(email)) return badRequest(reply, '测试收件邮箱无效');
    const errors = validateSettings(settings, { requireSmtp: true });
    if (errors.length > 0) return badRequest(reply, errors.join('；'));

    addLog(db, 'info', `开始发送测试邮件：${email}`, email);
    await sendTestEmail(settings, email, companyName);
    addLog(db, 'info', `测试邮件发送成功：${email}`, email);
    return {
      ok: true
    };
  });

  app.post('/api/job/run', async () => scheduler.startJob('manual'));

  app.post('/api/job/stop', async () => scheduler.stopJob());

  app.post('/api/recipients/reset-failed', async () => {
    const changed = resetFailedRecipients(db);
    addLog(db, 'info', `已恢复 ${changed} 条失败名单为待发送`);
    return {
      changed,
      state: buildState(db, scheduler)
    };
  });

  app.delete('/api/recipients/pending', async () => {
    const changed = clearPendingRecipients(db);
    addLog(db, 'warn', `已清空 ${changed} 条未发送名单`);
    return {
      changed,
      state: buildState(db, scheduler)
    };
  });

  app.addHook('onReady', async () => {
    if (options.startScheduler !== false) scheduler.start();
  });

  app.addHook('onClose', async () => {
    scheduler.close();
    db.close();
  });

  app.setErrorHandler((error, request, reply) => {
    request.log.error(error);
    reply.code(error.statusCode || 500).send({
      error: error.statusCode ? 'Bad Request' : 'Internal Server Error',
      message: error.message
    });
  });

  return app;
}
