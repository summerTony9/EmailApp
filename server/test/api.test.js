import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../src/app.js';
import { createDatabase, normalizeEmail, SENT_RECORD_EXPIRATION_MS } from '../src/db.js';

function createTestContext() {
  const db = createDatabase(':memory:');
  const app = buildApp({
    logger: false,
    apiToken: 'test-token',
    db
  });
  return { app, db };
}

function createTestApp() {
  return createTestContext().app;
}

function insertSentRecord(db, overrides = {}) {
  const payload = {
    ...sentPayload,
    email: normalizeEmail(sentPayload.email),
    sentAt: new Date().toISOString(),
    ...overrides
  };
  payload.email = normalizeEmail(payload.email);

  db.prepare(`
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
  `).run(payload);
}

const auth = {
  authorization: 'Bearer test-token'
};

const sentPayload = {
  email: 'Demo@Example.COM ',
  companyName: '北京创谱科技有限公司',
  managerName: '路悦醍',
  managerPhone: '19935493819',
  branchName: '交通银行北京中关村园区支行',
  presidentName: '杨诺',
  subject: '知识产权贴息政策提示'
};

test('normalizes email addresses consistently', () => {
  assert.equal(normalizeEmail(' Demo@Example.COM '), 'demo@example.com');
});

test('requires API token for protected endpoints', async () => {
  const app = createTestApp();
  const response = await app.inject({
    method: 'POST',
    url: '/api/check',
    payload: { email: 'demo@example.com' }
  });

  assert.equal(response.statusCode, 401);
  await app.close();
});

test('check -> sent -> check flow is idempotent by email', async () => {
  const app = createTestApp();

  const firstCheck = await app.inject({
    method: 'POST',
    url: '/api/check',
    headers: auth,
    payload: { email: sentPayload.email }
  });
  assert.equal(firstCheck.statusCode, 200);
  assert.equal(firstCheck.json().sent, false);

  const created = await app.inject({
    method: 'POST',
    url: '/api/sent',
    headers: auth,
    payload: sentPayload
  });
  assert.equal(created.statusCode, 201);
  assert.equal(created.json().created, true);
  assert.equal(created.json().refreshed, false);
  assert.equal(created.json().record.email, 'demo@example.com');

  const duplicate = await app.inject({
    method: 'POST',
    url: '/api/sent',
    headers: auth,
    payload: { ...sentPayload, companyName: '另一个公司' }
  });
  assert.equal(duplicate.statusCode, 200);
  assert.equal(duplicate.json().created, false);
  assert.equal(duplicate.json().refreshed, false);
  assert.equal(duplicate.json().record.companyName, sentPayload.companyName);

  const secondCheck = await app.inject({
    method: 'POST',
    url: '/api/check',
    headers: auth,
    payload: { email: 'demo@example.com' }
  });
  assert.equal(secondCheck.statusCode, 200);
  assert.equal(secondCheck.json().sent, true);

  await app.close();
});

test('keeps existing expired records when the app starts', async () => {
  const db = createDatabase(':memory:');
  insertSentRecord(db, {
    email: sentPayload.email,
    sentAt: new Date(Date.now() - SENT_RECORD_EXPIRATION_MS - 1000).toISOString()
  });

  const app = buildApp({
    logger: false,
    apiToken: 'test-token',
    db
  });

  assert.equal(
    db.prepare('SELECT COUNT(*) AS count FROM sent_records WHERE email = ?').get('demo@example.com')
      .count,
    1
  );

  await app.close();
});

test('expires sent records after 90 days so they can be sent again', async () => {
  const { app, db } = createTestContext();
  const expiredSentAt = new Date(Date.now() - SENT_RECORD_EXPIRATION_MS - 1000).toISOString();
  insertSentRecord(db, {
    email: sentPayload.email,
    companyName: '旧公司',
    sentAt: expiredSentAt
  });

  const firstCheck = await app.inject({
    method: 'POST',
    url: '/api/check',
    headers: auth,
    payload: { email: sentPayload.email }
  });
  assert.equal(firstCheck.statusCode, 200);
  assert.equal(firstCheck.json().sent, false);
  assert.equal(firstCheck.json().record, null);
  assert.equal(
    db.prepare('SELECT COUNT(*) AS count FROM sent_records WHERE email = ?').get('demo@example.com')
      .count,
    1
  );

  const refreshed = await app.inject({
    method: 'POST',
    url: '/api/sent',
    headers: auth,
    payload: sentPayload
  });
  assert.equal(refreshed.statusCode, 200);
  assert.equal(refreshed.json().created, false);
  assert.equal(refreshed.json().refreshed, true);
  assert.equal(refreshed.json().record.companyName, sentPayload.companyName);
  assert.notEqual(refreshed.json().record.sentAt, expiredSentAt);
  assert.equal(
    db.prepare('SELECT COUNT(*) AS count FROM sent_records WHERE email = ?').get('demo@example.com')
      .count,
    1
  );
  assert.deepEqual(
    db
      .prepare('SELECT email, company_name, sent_at FROM sent_record_history WHERE email = ?')
      .get('demo@example.com'),
    {
      email: 'demo@example.com',
      company_name: '旧公司',
      sent_at: expiredSentAt
    }
  );

  const secondCheck = await app.inject({
    method: 'POST',
    url: '/api/check',
    headers: auth,
    payload: { email: sentPayload.email }
  });
  assert.equal(secondCheck.statusCode, 200);
  assert.equal(secondCheck.json().sent, true);

  await app.close();
});

test('rejects invalid email payloads', async () => {
  const app = createTestApp();
  const response = await app.inject({
    method: 'POST',
    url: '/api/check',
    headers: auth,
    payload: { email: 'not-an-email' }
  });

  assert.equal(response.statusCode, 400);
  await app.close();
});
