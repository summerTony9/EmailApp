import type { AppConfig, EmailPreview } from './types';

export const EMAIL_SUBJECT = '知识产权质押融资服务提示';

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
  sendLimitPerBatch: 0,
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
    '近期国家知识产权局持续推动知识产权质押融资相关工作，我行也在为有专利、商标、软著等知识产权资产的企业提供配套融资服务，这次主要是向贵司做一个政策和融资服务提示。',
    '我们了解到贵司整体资质较好。如贵司有相关知识产权资产，可尝试通过知识产权质押方式补充经营资金，我行可以配合推进知识产权质押融资相关手续，包括质押登记、授信申报等；符合条件的情况下，融资利率可做到1.2%左右，具体以企业资质、知识产权情况及审批结果为准。',
    '此外，我行还有创业担保贷产品。该产品有人社部门相关补贴支持，符合条件的企业，担保费不向企业收取，利率同样可做到1.2%左右，后续可结合贵司实际情况一并匹配。',
    `这类事项建议转给融资或财务相关同事推进。有需要可以随时联系我行客户经理${manager}${phone}。如贵司需进一步了解相关政策及资料，可添加我的微信（与上述手机号码一致），我将及时发送相关资料供参考。`,
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
        <p style="margin:0 0 16px;">近期国家知识产权局持续推动知识产权质押融资相关工作，我行也在为有专利、商标、软著等知识产权资产的企业提供配套融资服务，这次主要是向贵司做一个政策和融资服务提示。</p>
        <p style="margin:0 0 16px;">我们了解到贵司整体资质较好。如贵司有相关知识产权资产，可尝试通过知识产权质押方式补充经营资金，我行可以配合推进知识产权质押融资相关手续，包括质押登记、授信申报等；符合条件的情况下，<strong style="color:#d92d20;">融资利率可做到1.2%左右</strong>，具体以企业资质、知识产权情况及审批结果为准。</p>
        <p style="margin:0 0 16px;">此外，我行还有创业担保贷产品。该产品有人社部门相关补贴支持，符合条件的企业，担保费不向企业收取，<strong style="color:#d92d20;">利率同样可做到1.2%左右</strong>，后续可结合贵司实际情况一并匹配。</p>
        <p style="margin:0 0 16px;">这类事项建议转给融资或财务相关同事推进。有需要可以随时联系我行客户经理${managerHtml}${phoneHtml}。如贵司需进一步了解相关政策及资料，可添加我的微信（与上述手机号码一致），我将及时发送相关资料供参考。</p>
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
