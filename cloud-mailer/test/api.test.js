import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../src/app.js';
import { createDatabase, getSettings, saveSettings, upsertRecipients } from '../src/db.js';
import { parseRecipientFile } from '../src/recipientParser.js';
import { createScheduler, isScheduleDue, localDateTimeParts } from '../src/scheduler.js';

const auth = {
  authorization: 'Bearer test-token'
};

function createTestContext(options = {}) {
  const db = createDatabase(':memory:');
  const sent = [];
  const app = buildApp({
    logger: false,
    adminToken: 'test-token',
    db,
    startScheduler: false,
    sendEmail: async (_settings, recipient) => {
      sent.push(recipient.email);
    },
    ...options
  });
  return { app, db, sent };
}

function validSettings(overrides = {}) {
  return {
    smtpHost: 'smtp.example.com',
    smtpPort: 465,
    smtpEncryption: 'tls',
    smtpUsername: 'sender@example.com',
    smtpPassword: 'secret',
    fromEmail: 'sender@example.com',
    fromName: '交通银行中关村园区支行',
    branchName: '交通银行北京中关村园区支行',
    presidentName: '杨诺',
    managerName: '路悦醍',
    managerPhone: '19935493819',
    subject: '知识产权质押融资服务提示',
    sendTime: '09:00',
    timeZone: 'Asia/Shanghai',
    dailyLimit: 2,
    sendIntervalSeconds: 0,
    enabled: false,
    ...overrides
  };
}

async function waitFor(check, timeoutMs = 1000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const value = check();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('Timed out waiting for condition');
}

test('protects cloud mailer API with admin token', async () => {
  const { app } = createTestContext();
  const response = await app.inject({
    method: 'GET',
    url: '/api/state'
  });

  assert.equal(response.statusCode, 401);
  await app.close();
});

test('saves settings without exposing SMTP password', async () => {
  const { app, db } = createTestContext();
  const response = await app.inject({
    method: 'PUT',
    url: '/api/settings',
    headers: auth,
    payload: validSettings()
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json().settings.smtpPassword, '');
  assert.equal(response.json().settings.smtpPasswordSet, true);
  assert.equal(getSettings(db).smtpPassword, 'secret');

  const update = await app.inject({
    method: 'PUT',
    url: '/api/settings',
    headers: auth,
    payload: {
      ...validSettings({ dailyLimit: 5 }),
      smtpPassword: ''
    }
  });

  assert.equal(update.statusCode, 200);
  assert.equal(getSettings(db).smtpPassword, 'secret');
  assert.equal(getSettings(db).dailyLimit, 5);
  await app.close();
});

test('parses CSV recipients and flags duplicates', async () => {
  const csv = Buffer.from(
    '企业名称,邮箱\n北京创谱科技有限公司,demo@example.com\n重复公司,demo@example.com\n无邮箱,\n'
  );
  const parsed = await parseRecipientFile(csv, 'recipients.csv');

  assert.equal(parsed.totalRows, 3);
  assert.equal(parsed.validRows.length, 1);
  assert.equal(parsed.validRows[0].email, 'demo@example.com');
  assert.equal(parsed.invalidRows.length, 2);
});

test('manual job sends pending recipients up to daily limit', async () => {
  const { app, db, sent } = createTestContext();
  await app.inject({
    method: 'PUT',
    url: '/api/settings',
    headers: auth,
    payload: validSettings({ dailyLimit: 2 })
  });
  upsertRecipients(db, [
    { email: 'one@example.com', companyName: '一号公司' },
    { email: 'two@example.com', companyName: '二号公司' },
    { email: 'three@example.com', companyName: '三号公司' }
  ]);

  const started = await app.inject({
    method: 'POST',
    url: '/api/job/run',
    headers: auth
  });
  assert.equal(started.statusCode, 200);
  assert.equal(started.json().accepted, true);

  await waitFor(
    () => db.prepare("SELECT COUNT(*) AS count FROM recipients WHERE status = 'sent'").get().count === 2
  );

  assert.deepEqual(sent, ['one@example.com', 'two@example.com']);
  assert.equal(
    db.prepare("SELECT COUNT(*) AS count FROM recipients WHERE status = 'pending'").get().count,
    1
  );
  await app.close();
});

test('schedule due check uses configured timezone and time', () => {
  const settings = validSettings({
    enabled: true,
    sendTime: '09:00',
    timeZone: 'Asia/Shanghai'
  });
  const date = new Date('2026-07-08T01:01:00.000Z');

  assert.deepEqual(localDateTimeParts(settings.timeZone, date), {
    dateKey: '2026-07-08',
    minutes: 9 * 60 + 1
  });
  assert.equal(isScheduleDue(settings, date), true);
});

test('scheduled job can retry an interrupted failed run for the same day', async () => {
  const db = createDatabase(':memory:');
  const sent = [];
  saveSettings(
    db,
    validSettings({
      enabled: true,
      sendTime: '09:00',
      timeZone: 'Asia/Shanghai',
      dailyLimit: 1
    })
  );
  upsertRecipients(db, [{ email: 'retry@example.com', companyName: '重试公司' }]);
  db.prepare(
    `INSERT INTO job_runs (run_key, source, status, started_at, finished_at, message)
     VALUES ('2026-07-08', 'scheduled', 'failed', ?, ?, '服务重启前任务中断')`
  ).run(new Date().toISOString(), new Date().toISOString());

  const scheduler = createScheduler({
    db,
    tickMs: 60_000,
    logger: false,
    sendEmail: async (_settings, recipient) => {
      sent.push(recipient.email);
    }
  });

  const result = scheduler.tick(new Date('2026-07-08T01:01:00.000Z'));
  assert.equal(result.accepted, true);

  await waitFor(
    () => db.prepare("SELECT COUNT(*) AS count FROM recipients WHERE status = 'sent'").get().count === 1
  );

  assert.deepEqual(sent, ['retry@example.com']);
  assert.equal(db.prepare("SELECT status FROM job_runs WHERE run_key = '2026-07-08'").get().status, 'completed');
  scheduler.close();
  db.close();
});
