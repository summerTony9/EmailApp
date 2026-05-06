import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../src/app.js';
import { createDatabase, normalizeEmail } from '../src/db.js';

function createTestApp() {
  return buildApp({
    logger: false,
    apiToken: 'test-token',
    db: createDatabase(':memory:')
  });
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
  assert.equal(created.json().record.email, 'demo@example.com');

  const duplicate = await app.inject({
    method: 'POST',
    url: '/api/sent',
    headers: auth,
    payload: { ...sentPayload, companyName: '另一个公司' }
  });
  assert.equal(duplicate.statusCode, 200);
  assert.equal(duplicate.json().created, false);
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

