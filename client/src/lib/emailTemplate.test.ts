import { describe, expect, it } from 'vitest';
import { buildEmailPreview, DEFAULT_CONFIG, EMAIL_SUBJECT } from './emailTemplate';

describe('buildEmailPreview', () => {
  it('renders the fixed subject and personalized company line', () => {
    const preview = buildEmailPreview('北京创谱科技有限公司', DEFAULT_CONFIG);

    expect(preview.subject).toBe(EMAIL_SUBJECT);
    expect(preview.text).toContain('北京创谱科技有限公司，您好：');
    expect(preview.text).toContain('对公客户经理：路悦醍19935493819');
  });

  it('bolds 1.2% in HTML while keeping plain text clean', () => {
    const preview = buildEmailPreview('测试企业', DEFAULT_CONFIG);

    expect(preview.html).toContain('<strong>1.2%</strong>');
    expect(preview.text).toContain('利率可以做到1.2%');
    expect(preview.text).not.toContain('<strong>');
  });
});

