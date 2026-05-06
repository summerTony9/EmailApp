import { describe, expect, it } from 'vitest';
import { isValidEmail, normalizeEmail } from './validation';

describe('email validation', () => {
  it('normalizes emails', () => {
    expect(normalizeEmail(' Demo@Example.COM ')).toBe('demo@example.com');
  });

  it('rejects malformed email addresses', () => {
    expect(isValidEmail('demo@example.com')).toBe(true);
    expect(isValidEmail('not-an-email')).toBe(false);
  });
});

