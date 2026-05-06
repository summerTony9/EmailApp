import { describe, expect, it } from 'vitest';
import { buildEmailPreview, DEFAULT_CONFIG, EMAIL_SUBJECT } from './emailTemplate';

describe('buildEmailPreview', () => {
  it('renders the fixed subject and personalized company line', () => {
    const preview = buildEmailPreview('北京创谱科技有限公司', DEFAULT_CONFIG);

    expect(preview.subject).toBe(EMAIL_SUBJECT);
    expect(preview.text).toContain('北京创谱科技有限公司，您好：');
    expect(preview.text).toContain('对公客户经理：路悦醍19935493819');
  });

  it('uses a plain official HTML layout and keeps plain text clean', () => {
    const preview = buildEmailPreview('测试企业', DEFAULT_CONFIG);

    expect(preview.html).toContain('<strong>利率可以做到1.2%</strong>');
    expect(preview.html).toContain('<p style="margin:0 0 16px;">测试企业，您好：</p>');
    expect(preview.html).toContain('<div style="margin-top:28px;line-height:1.8;">');
    expect(preview.html).not.toContain('background:#ecfdf5');
    expect(preview.html).not.toContain('知识产权质押融资政策宣导');
    expect(preview.text).toContain('利率可以做到1.2%');
    expect(preview.text).toContain('\n\n我方为');
    expect(preview.text).not.toContain('<strong>');
  });
});
