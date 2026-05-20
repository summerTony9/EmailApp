import cors from '@fastify/cors';
import Fastify from 'fastify';
import {
  createDatabase,
  isSentRecordActive,
  isValidEmail,
  normalizeEmail,
  rowToRecord
} from './db.js';

const DEFAULT_SUBJECT = '知识产权质押融资服务提示';

function requiredText(value, fieldName) {
  const text = String(value ?? '').trim();
  if (!text) {
    const error = new Error(`${fieldName} is required`);
    error.statusCode = 400;
    throw error;
  }
  return text;
}

function readBearerToken(request) {
  const header = request.headers.authorization || '';
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match?.[1]?.trim() || '';
}

export function buildApp(options = {}) {
  const app = Fastify({
    logger: options.logger ?? true
  });
  const db = options.db ?? createDatabase(options.dbPath);
  const apiToken = options.apiToken ?? process.env.API_TOKEN ?? 'change-me-before-deploy';
  const findSentRecord = db.prepare('SELECT * FROM sent_records WHERE email = ?');
  const archiveSentRecord = db.prepare(`
    INSERT INTO sent_record_history (
      sent_record_id,
      email,
      company_name,
      manager_name,
      manager_phone,
      branch_name,
      president_name,
      subject,
      sent_at,
      created_at,
      archived_at
    ) VALUES (
      @id,
      @email,
      @company_name,
      @manager_name,
      @manager_phone,
      @branch_name,
      @president_name,
      @subject,
      @sent_at,
      @created_at,
      @archivedAt
    )
  `);
  const insertSentRecord = db.prepare(`
    INSERT INTO sent_records (
      email,
      company_name,
      manager_name,
      manager_phone,
      branch_name,
      president_name,
      subject,
      sent_at
    ) VALUES (
      @email,
      @companyName,
      @managerName,
      @managerPhone,
      @branchName,
      @presidentName,
      @subject,
      @sentAt
    )
  `);
  const updateSentRecord = db.prepare(`
    UPDATE sent_records
    SET
      company_name = @companyName,
      manager_name = @managerName,
      manager_phone = @managerPhone,
      branch_name = @branchName,
      president_name = @presidentName,
      subject = @subject,
      sent_at = @sentAt
    WHERE email = @email
  `);
  const refreshExpiredSentRecord = db.transaction((existing, payload) => {
    archiveSentRecord.run({
      ...existing,
      archivedAt: payload.sentAt
    });
    updateSentRecord.run(payload);
  });

  app.register(cors, {
    origin: true
  });

  app.addHook('preHandler', async (request, reply) => {
    if (!request.url.startsWith('/api/')) return;
    if (!apiToken || apiToken === 'change-me-before-deploy') {
      request.log.warn('API_TOKEN is using an unsafe default value');
    }
    if (readBearerToken(request) !== apiToken) {
      return reply.code(401).send({
        error: 'Unauthorized',
        message: 'Missing or invalid API token'
      });
    }
  });

  app.get('/health', async () => ({
    ok: true,
    service: 'emailapp-server',
    time: new Date().toISOString()
  }));

  app.post('/api/check', async (request, reply) => {
    const email = normalizeEmail(request.body?.email);
    if (!isValidEmail(email)) {
      return reply.code(400).send({
        error: 'Bad Request',
        message: 'email is invalid'
      });
    }

    const row = findSentRecord.get(email);
    const sent = isSentRecordActive(row);
    return {
      sent,
      record: sent ? rowToRecord(row) : null
    };
  });

  app.post('/api/sent', async (request, reply) => {
    const email = normalizeEmail(request.body?.email);
    if (!isValidEmail(email)) {
      return reply.code(400).send({
        error: 'Bad Request',
        message: 'email is invalid'
      });
    }

    const payload = {
      email,
      companyName: requiredText(request.body?.companyName, 'companyName'),
      managerName: requiredText(request.body?.managerName, 'managerName'),
      managerPhone: requiredText(request.body?.managerPhone, 'managerPhone'),
      branchName: requiredText(request.body?.branchName, 'branchName'),
      presidentName: requiredText(request.body?.presidentName, 'presidentName'),
      subject: String(request.body?.subject || DEFAULT_SUBJECT).trim() || DEFAULT_SUBJECT,
      sentAt: new Date().toISOString()
    };

    const existing = findSentRecord.get(email);
    if (isSentRecordActive(existing)) {
      return {
        created: false,
        refreshed: false,
        record: rowToRecord(existing)
      };
    }

    if (existing) {
      refreshExpiredSentRecord(existing, payload);
      const row = findSentRecord.get(email);
      return {
        created: false,
        refreshed: true,
        record: rowToRecord(row)
      };
    }

    insertSentRecord.run(payload);

    const row = findSentRecord.get(email);
    return reply.code(201).send({
      created: true,
      refreshed: false,
      record: rowToRecord(row)
    });
  });

  app.setErrorHandler((error, request, reply) => {
    request.log.error(error);
    reply.code(error.statusCode || 500).send({
      error: error.statusCode ? 'Bad Request' : 'Internal Server Error',
      message: error.message
    });
  });

  app.addHook('onClose', async () => {
    db.close();
  });

  return app;
}
