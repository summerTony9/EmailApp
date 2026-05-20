import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from './emailTemplate';
import { getConfigWarnings, getSentImportWarnings, isValidEmail, normalizeEmail } from './validation';

describe('email validation', () => {
  it('normalizes emails', () => {
    expect(normalizeEmail(' Demo@Example.COM ')).toBe('demo@example.com');
  });

  it('rejects malformed email addresses', () => {
    expect(isValidEmail('demo@example.com')).toBe(true);
    expect(isValidEmail('not-an-email')).toBe(false);
  });
});

describe('config warnings', () => {
  it('does not require SMTP settings for importing historical sent records', () => {
    const warnings = getSentImportWarnings({
      ...DEFAULT_CONFIG,
      apiToken: 'token'
    });

    expect(warnings).toEqual([]);
    expect(getConfigWarnings({ ...DEFAULT_CONFIG, apiToken: 'token' })).toContain('SMTP 服务器不能为空');
  });

  it('rejects negative per-batch send limits', () => {
    const warnings = getConfigWarnings({
      ...DEFAULT_CONFIG,
      sendLimitPerBatch: -1
    });

    expect(warnings).toContain('每次发送上限不能小于 0');
  });
});
