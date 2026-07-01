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

    expect(preview.html).toContain('<strong style="color:#d92d20;">融资利率可做到1.2%左右</strong>');
    expect(preview.html).toContain('<strong style="color:#d92d20;">利率同样可做到1.2%左右</strong>');
    expect(preview.html).toContain('<p style="margin:0 0 16px;">测试企业，您好：</p>');
    expect(preview.html).toContain('<div style="margin-top:28px;line-height:1.8;">');
    expect(preview.html).not.toContain('background:#ecfdf5');
    expect(preview.text).toContain('知识产权质押方式补充经营资金');
    expect(preview.text).toContain('融资利率可做到1.2%左右');
    expect(preview.text).toContain('我行还有创业担保贷产品');
    expect(preview.text).toContain('利率同样可做到1.2%左右');
    expect(preview.text).toContain('配合推进知识产权质押融资相关手续');
    expect(preview.text).toContain(
      '如贵司需进一步了解相关政策及资料，可添加我的微信（与上述手机号码一致），我将及时发送相关资料供参考。'
    );
    expect(preview.html).toContain(
      '如贵司需进一步了解相关政策及资料，可添加我的微信（与上述手机号码一致），我将及时发送相关资料供参考。'
    );
    expect(preview.text).not.toContain('包括评估');
    expect(preview.text).not.toContain('补充融资方案');
    expect(preview.text).not.toContain('补贴利息50%');
    expect(preview.text).toContain('\n\n我方为');
    expect(preview.text).not.toContain('<strong>');
  });
});
