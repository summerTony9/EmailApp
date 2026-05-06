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
    <div style="margin:0;padding:0;background:#f5f7fa;color:#1f2933;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','Microsoft YaHei',Arial,sans-serif;">
      <div style="max-width:640px;margin:0 auto;padding:24px 12px;">
        <div style="background:#ffffff;border:1px solid #e1e7ef;border-radius:10px;overflow:hidden;">
          <div style="padding:20px 24px;background:#f8fafc;border-bottom:1px solid #e1e7ef;">
            <div style="font-size:13px;line-height:1.5;color:#64748b;">知识产权质押融资政策宣导</div>
            <div style="margin-top:4px;font-size:20px;line-height:1.35;font-weight:700;color:#102a43;">${companyHtml}，您好</div>
          </div>
          <div style="padding:24px;font-size:15px;line-height:1.85;color:#243b53;">
            <p style="margin:0 0 14px;">我方为${branchHtml}。</p>
            <p style="margin:0 0 14px;">近期国家知识产权局正在推动知识产权质押融资相关政策，这次主要是向贵司做一个政策宣导。</p>
            <div style="margin:18px 0;padding:14px 16px;background:#ecfdf5;border-left:4px solid #0f766e;border-radius:8px;color:#134e4a;">
              我们了解到贵司整体资质较好。知识产权质押贴息贷款通过贴息后利率可以做到<strong>1.2%</strong>，低于定期存款。如果贵司有专利、商标、软著等知识产权资产，可以补贴利息50%，最高不超过30万元。
            </div>
            <p style="margin:0 0 18px;">这类事项建议转给融资或财务相关同事推进。有需要可以随时联系我行客户经理${managerHtml}${phoneHtml}。</p>
            <div style="margin-top:22px;padding-top:16px;border-top:1px solid #e1e7ef;color:#334e68;">
              <div style="margin-bottom:6px;">${branchHtml}行长 ${presidentHtml}</div>
              <div>对公客户经理：${managerHtml}${phoneHtml}</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  `.trim();

  return {
    subject: EMAIL_SUBJECT,
    text: lines.join('\n'),
    html
  };
}
