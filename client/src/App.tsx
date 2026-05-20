import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { open } from '@tauri-apps/plugin-dialog';
import {
  AlertCircle,
  CheckCircle2,
  Database,
  Download,
  FileSpreadsheet,
  Loader2,
  Mail,
  Play,
  Save,
  Send,
  Server,
  Settings,
  ShieldCheck,
  Trash2,
  TestTube2,
  Upload
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { buildEmailPreview, DEFAULT_CONFIG, EMAIL_SUBJECT } from './lib/emailTemplate';
import type {
  AppConfig,
  AppLog,
  BatchSummary,
  RecipientRow,
  RowStatus,
  SendProgress
} from './lib/types';
import {
  getConfigWarnings,
  getImportStats,
  getSentImportWarnings,
  isValidEmail
} from './lib/validation';

function isTauriRuntime() {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

function statusLabel(status: RowStatus) {
  const labels: Record<RowStatus, string> = {
    pending: '待发送',
    skipped: '已跳过',
    sending: '发送中',
    sent: '已发送',
    failed: '失败'
  };
  return labels[status];
}

function statusClass(status: RowStatus) {
  return `status status-${status}`;
}

function toNumber(value: string, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toNonNegativeInteger(value: string, fallback: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, Math.floor(parsed));
}

function defaultPortForEncryption(encryption: AppConfig['smtpEncryption']) {
  if (encryption === 'tls') return 465;
  if (encryption === 'starttls') return 587;
  return 25;
}

function formatLogTime(timeMs: number) {
  return new Date(timeMs).toLocaleTimeString('zh-CN', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
}

export default function App() {
  const [config, setConfig] = useState<AppConfig>(DEFAULT_CONFIG);
  const [recipients, setRecipients] = useState<RecipientRow[]>([]);
  const [selectedPath, setSelectedPath] = useState('');
  const [isLoadingConfig, setIsLoadingConfig] = useState(true);
  const [isParsing, setIsParsing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [isImportingSent, setIsImportingSent] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [notice, setNotice] = useState('');
  const [summary, setSummary] = useState<BatchSummary | null>(null);
  const [logs, setLogs] = useState<AppLog[]>([]);

  const stats = useMemo(() => getImportStats(recipients), [recipients]);
  const validRecipients = useMemo(() => recipients.filter((row) => row.isValid), [recipients]);
  const firstValidRecipient = validRecipients[0];
  const preview = useMemo(
    () => buildEmailPreview(firstValidRecipient?.companyName || '北京创谱科技有限公司', config),
    [config, firstValidRecipient]
  );
  const configWarnings = useMemo(() => getConfigWarnings(config), [config]);
  const sentImportWarnings = useMemo(() => getSentImportWarnings(config), [config]);
  const canStart =
    validRecipients.length > 0 && configWarnings.length === 0 && !isSending && !isImportingSent;
  const canImportSent =
    validRecipients.length > 0 &&
    sentImportWarnings.length === 0 &&
    !isSending &&
    !isImportingSent;

  useEffect(() => {
    let isMounted = true;
    async function loadConfig() {
      if (!isTauriRuntime()) {
        setNotice('当前是浏览器预览模式；发信、保存配置和文件导入需要在 Tauri 桌面端运行。');
        setIsLoadingConfig(false);
        return;
      }

      try {
        const loaded = await invoke<AppConfig>('load_config');
        if (isMounted) setConfig({ ...DEFAULT_CONFIG, ...loaded });
      } catch (error) {
        if (isMounted) setNotice(`读取配置失败：${String(error)}`);
      } finally {
        if (isMounted) setIsLoadingConfig(false);
      }
    }
    loadConfig();
    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    if (!isTauriRuntime()) return;
    let unlistenProgress: (() => void) | undefined;
    let unlistenLog: (() => void) | undefined;
    listen<SendProgress>('send-progress', (event) => {
      const progress = event.payload;
      setRecipients((current) =>
        current.map((row) =>
          row.id === progress.id
            ? { ...row, status: progress.status, message: progress.message }
            : row
        )
      );
    }).then((dispose) => {
      unlistenProgress = dispose;
    });
    listen<AppLog>('app-log', (event) => {
      setLogs((current) => [...current.slice(-299), event.payload]);
    }).then((dispose) => {
      unlistenLog = dispose;
    });
    return () => {
      unlistenProgress?.();
      unlistenLog?.();
    };
  }, []);

  function updateConfig<K extends keyof AppConfig>(key: K, value: AppConfig[K]) {
    setConfig((current) => ({
      ...current,
      [key]: value
    }));
  }

  function updateSmtpEncryption(encryption: AppConfig['smtpEncryption']) {
    setConfig((current) => ({
      ...current,
      smtpEncryption: encryption,
      smtpPort: defaultPortForEncryption(encryption)
    }));
  }

  async function saveConfig() {
    if (!isTauriRuntime()) {
      setNotice('请在桌面端运行后保存配置。');
      return;
    }
    setIsSaving(true);
    setNotice('');
    try {
      await invoke('save_config', { config });
      setNotice('配置已保存到本机明文配置文件。');
    } catch (error) {
      setNotice(`保存配置失败：${String(error)}`);
    } finally {
      setIsSaving(false);
    }
  }

  async function chooseFile() {
    if (!isTauriRuntime()) {
      setNotice('请在桌面端运行后导入 CSV 或 XLSX 文件。');
      return;
    }
    setIsParsing(true);
    setSummary(null);
    setNotice('');
    try {
      const path = await open({
        multiple: false,
        filters: [
          {
            name: '企业名单',
            extensions: ['csv', 'xlsx', 'xls']
          }
        ]
      });
      if (!path || Array.isArray(path)) return;
      setSelectedPath(path);
      const rows = await invoke<RecipientRow[]>('parse_recipient_file', { path });
      setRecipients(rows);
      setNotice(`已导入 ${rows.length} 行，${rows.filter((row) => row.isValid).length} 行可发送。`);
    } catch (error) {
      setNotice(`导入失败：${String(error)}`);
    } finally {
      setIsParsing(false);
    }
  }

  async function sendTestEmail() {
    if (!isTauriRuntime()) {
      setNotice('请在桌面端运行后发送测试邮件。');
      return;
    }
    if (!isValidEmail(config.testRecipient)) {
      setNotice('请先填写有效的测试收件邮箱。');
      return;
    }
    setIsTesting(true);
    setNotice('');
    setLogs([]);
    try {
      await invoke('send_test_email', {
        config,
        recipient: config.testRecipient,
        sampleCompanyName: firstValidRecipient?.companyName || '北京创谱科技有限公司'
      });
      setNotice(`测试邮件已发送到 ${config.testRecipient}。`);
    } catch (error) {
      setNotice(`测试邮件失败：${String(error)}`);
    } finally {
      setIsTesting(false);
    }
  }

  async function startBatchSend() {
    if (!canStart) return;
    const sendLimit = Math.max(0, Math.floor(config.sendLimitPerBatch || 0));
    const sendLimitText =
      sendLimit > 0
        ? `本次最多实际发送 ${sendLimit} 封，已发跳过不占额度。`
        : '本次不限制实际发送封数。';
    const confirmed = window.confirm(
      `即将按邮箱去重后单线程处理 ${validRecipients.length} 条有效记录，每封间隔 ${config.sendIntervalSeconds} 秒。${sendLimitText}确认开始？`
    );
    if (!confirmed) return;

    setIsSending(true);
    setSummary(null);
    setNotice('');
    setLogs([]);
    setRecipients((current) =>
      current.map((row) =>
        row.isValid ? { ...row, status: 'pending', message: '' } : { ...row, status: 'failed' }
      )
    );

    try {
      const result = await invoke<BatchSummary>('start_batch_send', {
        config,
        recipients: validRecipients
      });
      setSummary(result);
      setNotice(
        `批量任务结束：成功 ${result.sent}，跳过 ${result.skipped}，失败 ${result.failed}。${
          result.limitReached ? `已达到本次发送上限 ${sendLimit} 封，可再次点击继续发送。` : ''
        }`
      );
    } catch (error) {
      setNotice(`批量发送暂停：${String(error)}`);
    } finally {
      setIsSending(false);
    }
  }

  async function importSentRecords() {
    if (!canImportSent) {
      if (sentImportWarnings.length > 0) {
        setNotice(`导入已发名单前请先补齐：${sentImportWarnings.join('；')}`);
      }
      return;
    }

    const confirmed = window.confirm(
      `即将把 ${validRecipients.length} 条有效邮箱写入服务器已发名单。这个操作不会发送邮件，确认继续？`
    );
    if (!confirmed) return;

    setIsImportingSent(true);
    setSummary(null);
    setNotice('');
    setLogs([]);
    setRecipients((current) =>
      current.map((row) =>
        row.isValid ? { ...row, status: 'pending', message: '' } : { ...row, status: 'failed' }
      )
    );

    try {
      const result = await invoke<BatchSummary>('import_sent_records', {
        config,
        recipients: validRecipients
      });
      setSummary(result);
      setNotice(
        `已发名单导入完成：新增 ${result.sent} 条，已存在 ${result.skipped} 条，失败 ${result.failed} 条。`
      );
    } catch (error) {
      setNotice(`已发名单导入暂停：${String(error)}`);
    } finally {
      setIsImportingSent(false);
    }
  }

  function exportFailures() {
    const failedRows = recipients.filter((row) => row.status === 'failed' || !row.isValid);
    if (failedRows.length === 0) {
      setNotice('没有失败或无效记录可导出。');
      return;
    }
    const header = ['rowNumber', 'companyName', 'email', 'status', 'message'];
    const csv = [
      header.join(','),
      ...failedRows.map((row) =>
        [
          row.rowNumber,
          row.companyName,
          row.email,
          statusLabel(row.status),
          row.message || row.errors.join('; ')
        ]
          .map((value) => `"${String(value).replace(/"/g, '""')}"`)
          .join(',')
      )
    ].join('\n');
    const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `emailapp-failures-${Date.now()}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <h1>EmailApp</h1>
          <p>知识产权质押融资批量邮件工作台</p>
        </div>
        <div className="topbar-actions">
          <span className="subject-pill">
            <Mail size={16} />
            {EMAIL_SUBJECT}
          </span>
          <button className="ghost-button" onClick={saveConfig} disabled={isSaving || isLoadingConfig}>
            {isSaving ? <Loader2 className="spin" size={16} /> : <Save size={16} />}
            保存配置
          </button>
        </div>
      </header>

      {notice ? (
        <section className="notice">
          <AlertCircle size={18} />
          <span>{notice}</span>
        </section>
      ) : null}

      <section className="dashboard-grid">
        <aside className="settings-panel">
          <div className="section-heading">
            <Settings size={18} />
            <h2>配置</h2>
          </div>

          <label>
            服务端地址
            <input
              value={config.serverUrl}
              onChange={(event) => updateConfig('serverUrl', event.target.value)}
              placeholder="http://43.156.180.151:8080"
            />
          </label>
          <label>
            API Token
            <input
              value={config.apiToken}
              onChange={(event) => updateConfig('apiToken', event.target.value)}
              placeholder="服务端 API_TOKEN"
              type="password"
            />
          </label>

          <div className="field-row">
            <label>
              SMTP 服务器
              <input
                value={config.smtpHost}
                onChange={(event) => updateConfig('smtpHost', event.target.value)}
                placeholder="smtp.example.com"
              />
            </label>
            <label>
              加密方式
              <select
                value={config.smtpEncryption}
                onChange={(event) =>
                  updateSmtpEncryption(event.target.value as AppConfig['smtpEncryption'])
                }
              >
                <option value="tls">SSL/TLS（465）</option>
                <option value="starttls">STARTTLS（587）</option>
                <option value="none">不加密（25）</option>
              </select>
            </label>
          </div>

          <label>
            端口
            <input
              value={config.smtpPort}
              onChange={(event) => updateConfig('smtpPort', toNumber(event.target.value, 465))}
              type="number"
              min={1}
            />
          </label>

          <label>
            SMTP 账号
            <input
              value={config.smtpUsername}
              onChange={(event) => updateConfig('smtpUsername', event.target.value)}
              placeholder="账号或发件邮箱"
            />
          </label>
          <label>
            SMTP 密码/授权码
            <input
              value={config.smtpPassword}
              onChange={(event) => updateConfig('smtpPassword', event.target.value)}
              type="password"
              placeholder="将明文保存在本机配置文件"
            />
          </label>
          <div className="field-row">
            <label>
              发件人邮箱
              <input
                value={config.fromEmail}
                onChange={(event) => updateConfig('fromEmail', event.target.value)}
                placeholder="sender@example.com"
              />
            </label>
            <label>
              发件人名称
              <input
                value={config.fromName}
                onChange={(event) => updateConfig('fromName', event.target.value)}
                placeholder="交通银行中关村园区支行"
              />
            </label>
          </div>

          <div className="section-heading compact">
            <ShieldCheck size={18} />
            <h2>模板字段</h2>
          </div>
          <label>
            支行名
            <input
              value={config.branchName}
              onChange={(event) => updateConfig('branchName', event.target.value)}
            />
          </label>
          <div className="field-row">
            <label>
              行长名
              <input
                value={config.presidentName}
                onChange={(event) => updateConfig('presidentName', event.target.value)}
              />
            </label>
            <label>
              发送间隔（秒）
              <input
                value={config.sendIntervalSeconds}
                onChange={(event) =>
                  updateConfig('sendIntervalSeconds', toNumber(event.target.value, 3))
                }
                type="number"
                min={0}
              />
            </label>
          </div>
          <label>
            每次发送上限（0 不限制）
            <input
              value={config.sendLimitPerBatch}
              onChange={(event) =>
                updateConfig('sendLimitPerBatch', toNonNegativeInteger(event.target.value, 0))
              }
              type="number"
              min={0}
              step={1}
            />
          </label>
          <div className="field-row">
            <label>
              客户经理
              <input
                value={config.managerName}
                onChange={(event) => updateConfig('managerName', event.target.value)}
              />
            </label>
            <label>
              电话
              <input
                value={config.managerPhone}
                onChange={(event) => updateConfig('managerPhone', event.target.value)}
              />
            </label>
          </div>

          {configWarnings.length > 0 ? (
            <ul className="warnings">
              {configWarnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          ) : (
            <div className="ready-line">
              <CheckCircle2 size={16} />
              配置已满足发送条件
            </div>
          )}
        </aside>

        <section className="work-panel">
          <div className="toolbar">
            <div className="section-heading">
              <FileSpreadsheet size={18} />
              <h2>名单与发送</h2>
            </div>
            <div className="toolbar-actions">
              <button onClick={chooseFile} disabled={isParsing || isSending || isImportingSent}>
                {isParsing ? <Loader2 className="spin" size={16} /> : <Upload size={16} />}
                导入名单
              </button>
              <button onClick={exportFailures} className="ghost-button">
                <Download size={16} />
                导出失败
              </button>
            </div>
          </div>

          <div className="stats-grid">
            <div>
              <span>总行数</span>
              <strong>{stats.total}</strong>
            </div>
            <div>
              <span>可发送</span>
              <strong>{stats.valid}</strong>
            </div>
            <div>
              <span>已发送</span>
              <strong>{stats.sent}</strong>
            </div>
            <div>
              <span>跳过</span>
              <strong>{stats.skipped}</strong>
            </div>
            <div>
              <span>失败/无效</span>
              <strong>{stats.failed + stats.invalid}</strong>
            </div>
          </div>

          <div className="file-path">{selectedPath || '尚未导入企业名单'}</div>

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>行号</th>
                  <th>企业名</th>
                  <th>邮箱</th>
                  <th>状态</th>
                  <th>说明</th>
                </tr>
              </thead>
              <tbody>
                {recipients.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="empty-cell">
                      导入 CSV 或 XLSX 后，这里会显示待发送名单
                    </td>
                  </tr>
                ) : (
                  recipients.slice(0, 250).map((row) => (
                    <tr key={row.id} className={!row.isValid ? 'invalid-row' : undefined}>
                      <td>{row.rowNumber}</td>
                      <td>{row.companyName}</td>
                      <td>{row.email}</td>
                      <td>
                        <span className={statusClass(row.status)}>{statusLabel(row.status)}</span>
                      </td>
                      <td>{row.message || row.errors.join('；') || '-'}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {recipients.length > 250 ? (
            <p className="table-hint">仅展示前 250 行，发送时会处理全部有效记录。</p>
          ) : null}

          <div className="send-actions">
            <label>
              测试收件邮箱
              <input
                value={config.testRecipient}
                onChange={(event) => updateConfig('testRecipient', event.target.value)}
                placeholder="test@example.com"
              />
            </label>
            <button className="ghost-button" onClick={sendTestEmail} disabled={isTesting || isSending}>
              {isTesting ? <Loader2 className="spin" size={16} /> : <TestTube2 size={16} />}
              发送测试
            </button>
            <button className="ghost-button" onClick={importSentRecords} disabled={!canImportSent}>
              {isImportingSent ? <Loader2 className="spin" size={16} /> : <Database size={16} />}
              导入为已发
            </button>
            <button className="primary-button" onClick={startBatchSend} disabled={!canStart}>
              {isSending ? <Loader2 className="spin" size={16} /> : <Play size={16} />}
              开始批量发送
            </button>
          </div>

          {summary ? (
            <div className="summary-line">
              <Send size={16} />
              成功/新增 {summary.sent} 条，跳过 {summary.skipped} 条，失败 {summary.failed} 条。
              {summary.limitReached ? ' 已达到本次发送上限。' : ''}
            </div>
          ) : null}

          <div className="log-panel">
            <div className="log-toolbar">
              <div className="section-heading compact">
                <AlertCircle size={18} />
                <h2>运行日志</h2>
              </div>
              <button className="ghost-button" onClick={() => setLogs([])} disabled={logs.length === 0}>
                <Trash2 size={16} />
                清空
              </button>
            </div>
            <div className="log-list">
              {logs.length === 0 ? (
                <div className="empty-log">发送测试或批量任务开始后，这里会显示详细日志</div>
              ) : (
                logs.map((log) => (
                  <div key={log.id} className={`log-row log-${log.level}`}>
                    <span>{formatLogTime(log.timeMs)}</span>
                    <strong>{log.level.toUpperCase()}</strong>
                    <p>{log.message}</p>
                  </div>
                ))
              )}
            </div>
          </div>
        </section>

        <section className="preview-panel">
          <div className="section-heading">
            <Server size={18} />
            <h2>邮件预览</h2>
          </div>
          <div className="preview-meta">
            <span>主题</span>
            <strong>{preview.subject}</strong>
          </div>
          <article className="email-preview" dangerouslySetInnerHTML={{ __html: preview.html }} />
        </section>
      </section>
    </main>
  );
}
