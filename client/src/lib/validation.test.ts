import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from './emailTemplate';
import type { RecipientRow } from './types';
import {
  getConfigWarnings,
  getRunnableRecipients,
  getSentImportWarnings,
  isValidEmail,
  normalizeEmail
} from './validation';

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

describe('runnable recipients', () => {
  it('continues from unfinished valid rows', () => {
    const baseRow: RecipientRow = {
      id: 'row-1',
      rowNumber: 1,
      companyName: '测试企业',
      email: 'demo@example.com',
      isValid: true,
      errors: [],
      status: 'pending'
    };
    const rows: RecipientRow[] = [
      { ...baseRow, id: 'sent', status: 'sent' },
      { ...baseRow, id: 'skipped', status: 'skipped' },
      { ...baseRow, id: 'failed', status: 'failed' },
      { ...baseRow, id: 'pending', status: 'pending' },
      { ...baseRow, id: 'invalid', isValid: false, status: 'failed' }
    ];

    expect(getRunnableRecipients(rows).map((row) => row.id)).toEqual(['failed', 'pending']);
  });
});
