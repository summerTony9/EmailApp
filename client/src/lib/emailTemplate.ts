import type { AppConfig, EmailPreview } from './types';

export const EMAIL_SUBJECT = '知识产权贴息政策提示';

export const DEFAULT_CONFIG: AppConfig = {
  serverUrl: 'http://43.156.180.151:8080',
  apiToken: '',
  smtpHost: '',
  smtpPort: 465,
  smtpEncryption: 'tls',
  smtpUsername: '',
  smtpPassword: '',
  fromEmail: '',
  fromName: '',
  branchName: '交通银行北京中关村园区支行',
  presidentName: '杨诺',
  managerName: '路悦醍',
  managerPhone: '19935493819',
  sendIntervalSeconds: 3,
  testRecipient: ''
};

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function buildEmailPreview(companyName: string, config: AppConfig): EmailPreview {
  const company = companyName.trim() || '北京创谱科技有限公司';
  const branch = config.branchName.trim() || DEFAULT_CONFIG.branchName;
  const president = config.presidentName.trim() || DEFAULT_CONFIG.presidentName;
  const manager = config.managerName.trim() || DEFAULT_CONFIG.managerName;
  const phone = config.managerPhone.trim() || DEFAULT_CONFIG.managerPhone;

  const lines = [
    `${company}，您好：`,
    `我方为${branch}。`,
    '近期国家知识产权局正在推动知识产权质押融资相关政策，这次主要是向贵司做一个政策宣导。',
    '我们了解到贵司整体资质较好。知识产权质押贴息贷款通过贴息后利率可以做到1.2%，低于定期存款。如果贵司有专利、商标、软著等知识产权资产，可以补贴利息50%，最高不超过30万元。',
    `这类事项建议转给融资或财务相关同事推进。有需要可以随时联系我行客户经理${manager}${phone}。`,
    `${branch}行长 ${president}`,
    `对公客户经理：${manager}${phone}`
  ];

  const companyHtml = escapeHtml(company);
  const branchHtml = escapeHtml(branch);
  const presidentHtml = escapeHtml(president);
  const managerHtml = escapeHtml(manager);
  const phoneHtml = escapeHtml(phone);

  const html = `
    <div style="margin:0;padding:0;background:#ffffff;color:#1f2933;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','Microsoft YaHei',Arial,sans-serif;font-size:15px;line-height:1.9;">
      <div style="max-width:680px;margin:0;padding:0;">
        <p style="margin:0 0 16px;">${companyHtml}，您好：</p>
        <p style="margin:0 0 16px;">我方为${branchHtml}。</p>
        <p style="margin:0 0 16px;">近期国家知识产权局正在推动知识产权质押融资相关政策，这次主要是向贵司做一个政策宣导。</p>
        <p style="margin:0 0 16px;">我们了解到贵司整体资质较好。知识产权质押贴息贷款通过贴息后<strong>利率可以做到1.2%</strong>，低于定期存款。如果贵司有专利、商标、软著等知识产权资产，可以补贴利息50%，最高不超过30万元。</p>
        <p style="margin:0 0 16px;">这类事项建议转给融资或财务相关同事推进。有需要可以随时联系我行客户经理${managerHtml}${phoneHtml}。</p>
        <div style="margin-top:28px;line-height:1.8;">
          <div style="margin:0 0 4px;">${branchHtml}行长 ${presidentHtml}</div>
          <div>对公客户经理：${managerHtml}${phoneHtml}</div>
        </div>
      </div>
    </div>
  `.trim();

  return {
    subject: EMAIL_SUBJECT,
    text: lines.join('\n\n'),
    html
  };
}
