const tokenKey = 'emailapp-cloud-mailer-token';
const elements = {
  loginPanel: document.querySelector('#loginPanel'),
  dashboard: document.querySelector('#dashboard'),
  notice: document.querySelector('#notice'),
  serviceStatus: document.querySelector('#serviceStatus'),
  tokenInput: document.querySelector('#tokenInput'),
  loginButton: document.querySelector('#loginButton'),
  logoutButton: document.querySelector('#logoutButton'),
  refreshButton: document.querySelector('#refreshButton'),
  enabledInput: document.querySelector('#enabledInput'),
  sendTimeInput: document.querySelector('#sendTimeInput'),
  timeZoneInput: document.querySelector('#timeZoneInput'),
  dailyLimitInput: document.querySelector('#dailyLimitInput'),
  intervalInput: document.querySelector('#intervalInput'),
  smtpHostInput: document.querySelector('#smtpHostInput'),
  smtpEncryptionInput: document.querySelector('#smtpEncryptionInput'),
  smtpPortInput: document.querySelector('#smtpPortInput'),
  smtpUsernameInput: document.querySelector('#smtpUsernameInput'),
  smtpPasswordInput: document.querySelector('#smtpPasswordInput'),
  fromEmailInput: document.querySelector('#fromEmailInput'),
  fromNameInput: document.querySelector('#fromNameInput'),
  subjectInput: document.querySelector('#subjectInput'),
  branchNameInput: document.querySelector('#branchNameInput'),
  presidentNameInput: document.querySelector('#presidentNameInput'),
  managerNameInput: document.querySelector('#managerNameInput'),
  managerPhoneInput: document.querySelector('#managerPhoneInput'),
  settingsWarnings: document.querySelector('#settingsWarnings'),
  saveSettingsButton: document.querySelector('#saveSettingsButton'),
  statTotal: document.querySelector('#statTotal'),
  statPending: document.querySelector('#statPending'),
  statSending: document.querySelector('#statSending'),
  statSent: document.querySelector('#statSent'),
  statFailed: document.querySelector('#statFailed'),
  fileInput: document.querySelector('#fileInput'),
  uploadButton: document.querySelector('#uploadButton'),
  recipientRows: document.querySelector('#recipientRows'),
  testEmailInput: document.querySelector('#testEmailInput'),
  testCompanyInput: document.querySelector('#testCompanyInput'),
  testButton: document.querySelector('#testButton'),
  runNowButton: document.querySelector('#runNowButton'),
  stopJobButton: document.querySelector('#stopJobButton'),
  resetFailedButton: document.querySelector('#resetFailedButton'),
  clearPendingButton: document.querySelector('#clearPendingButton'),
  jobStatus: document.querySelector('#jobStatus'),
  runRows: document.querySelector('#runRows'),
  emailPreview: document.querySelector('#emailPreview'),
  logRows: document.querySelector('#logRows')
};

let adminToken = localStorage.getItem(tokenKey) || '';
let state = null;
let isBusy = false;

function setNotice(message, type = 'info') {
  elements.notice.textContent = message;
  elements.notice.classList.toggle('hidden', !message);
  elements.notice.classList.toggle('error', type === 'error');
}

function setBusy(value) {
  isBusy = value;
  [
    elements.saveSettingsButton,
    elements.uploadButton,
    elements.testButton,
    elements.runNowButton,
    elements.stopJobButton,
    elements.resetFailedButton,
    elements.clearPendingButton,
    elements.refreshButton
  ].forEach((button) => {
    button.disabled = value;
  });
}

async function api(path, options = {}) {
  const headers = new Headers(options.headers || {});
  headers.set('Authorization', `Bearer ${adminToken}`);
  let body = options.body;
  if (body && !(body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
    body = JSON.stringify(body);
  }

  const response = await fetch(path, {
    ...options,
    headers,
    body
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.message || `HTTP ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return payload;
}

function formatDate(value) {
  if (!value) return '-';
  return new Date(value).toLocaleString('zh-CN', {
    hour12: false
  });
}

function statusLabel(value) {
  return (
    {
      pending: '待发送',
      sending: '发送中',
      sent: '已发送',
      failed: '失败',
      completed: '完成',
      stopped: '停止',
      running: '运行中'
    }[value] || value
  );
}

function showDashboard(show) {
  elements.loginPanel.classList.toggle('hidden', show);
  elements.dashboard.classList.toggle('hidden', !show);
  elements.logoutButton.classList.toggle('hidden', !show);
  elements.refreshButton.classList.toggle('hidden', !show);
}

function fillSettings(settings) {
  elements.enabledInput.checked = Boolean(settings.enabled);
  elements.sendTimeInput.value = settings.sendTime || '09:00';
  elements.timeZoneInput.value = settings.timeZone || 'Asia/Shanghai';
  elements.dailyLimitInput.value = settings.dailyLimit ?? 50;
  elements.intervalInput.value = settings.sendIntervalSeconds ?? 3;
  elements.smtpHostInput.value = settings.smtpHost || '';
  elements.smtpEncryptionInput.value = settings.smtpEncryption || 'tls';
  elements.smtpPortInput.value = settings.smtpPort || 465;
  elements.smtpUsernameInput.value = settings.smtpUsername || '';
  elements.smtpPasswordInput.value = '';
  elements.smtpPasswordInput.placeholder = settings.smtpPasswordSet ? '已保存，留空不修改' : '';
  elements.fromEmailInput.value = settings.fromEmail || '';
  elements.fromNameInput.value = settings.fromName || '';
  elements.subjectInput.value = settings.subject || '';
  elements.branchNameInput.value = settings.branchName || '';
  elements.presidentNameInput.value = settings.presidentName || '';
  elements.managerNameInput.value = settings.managerName || '';
  elements.managerPhoneInput.value = settings.managerPhone || '';
}

function collectSettings() {
  return {
    enabled: elements.enabledInput.checked,
    sendTime: elements.sendTimeInput.value,
    timeZone: elements.timeZoneInput.value,
    dailyLimit: Number(elements.dailyLimitInput.value),
    sendIntervalSeconds: Number(elements.intervalInput.value),
    smtpHost: elements.smtpHostInput.value,
    smtpEncryption: elements.smtpEncryptionInput.value,
    smtpPort: Number(elements.smtpPortInput.value),
    smtpUsername: elements.smtpUsernameInput.value,
    smtpPassword: elements.smtpPasswordInput.value,
    fromEmail: elements.fromEmailInput.value,
    fromName: elements.fromNameInput.value,
    subject: elements.subjectInput.value,
    branchName: elements.branchNameInput.value,
    presidentName: elements.presidentNameInput.value,
    managerName: elements.managerNameInput.value,
    managerPhone: elements.managerPhoneInput.value
  };
}

function renderWarnings(warnings) {
  elements.settingsWarnings.classList.toggle('hidden', warnings.length === 0);
  elements.settingsWarnings.innerHTML = warnings.map((warning) => `<div>${escapeHtml(warning)}</div>`).join('');
}

function renderStats(stats) {
  elements.statTotal.textContent = stats.total ?? 0;
  elements.statPending.textContent = stats.pending ?? 0;
  elements.statSending.textContent = stats.sending ?? 0;
  elements.statSent.textContent = stats.sent ?? 0;
  elements.statFailed.textContent = stats.failed ?? 0;
}

function renderRecipients(recipients) {
  if (!recipients.length) {
    elements.recipientRows.innerHTML = '<tr><td colspan="4" class="empty-cell">暂无名单</td></tr>';
    return;
  }

  elements.recipientRows.innerHTML = recipients
    .map(
      (row) => `
        <tr>
          <td>${escapeHtml(row.companyName)}</td>
          <td>${escapeHtml(row.email)}</td>
          <td><span class="row-status ${escapeHtml(row.status)}">${statusLabel(row.status)}</span></td>
          <td>${escapeHtml(row.lastError || '-')}</td>
        </tr>
      `
    )
    .join('');
}

function renderJob(scheduler) {
  const activeJob = scheduler.activeJob;
  elements.jobStatus.textContent = activeJob
    ? `${activeJob.source === 'scheduled' ? '定时' : '手动'}运行中`
    : '空闲';
  elements.jobStatus.classList.toggle('running', Boolean(activeJob));
  elements.jobStatus.classList.toggle('ready', !activeJob);

  const runs = scheduler.latestRuns || [];
  elements.runRows.innerHTML = runs.length
    ? runs
        .map(
          (run) => `
            <div class="run-row">
              <strong>${statusLabel(run.status)}：${escapeHtml(run.runKey)}</strong>
              <span>${formatDate(run.startedAt)}，成功 ${run.sentCount}，失败 ${run.failedCount}，跳过 ${run.skippedCount}</span>
            </div>
          `
        )
        .join('')
    : '<div class="run-row"><strong>暂无任务</strong><span>-</span></div>';
}

function renderLogs(logs) {
  elements.logRows.innerHTML = logs.length
    ? logs
        .map(
          (log) => `
            <div class="log-row ${escapeHtml(log.level)}">
              <strong>${escapeHtml(log.level.toUpperCase())} ${formatDate(log.createdAt)}</strong>
              <span>${escapeHtml(log.message)}</span>
            </div>
          `
        )
        .join('')
    : '<div class="log-row"><strong>暂无日志</strong><span>-</span></div>';
}

function renderState(nextState, { refillSettings = true } = {}) {
  state = nextState;
  showDashboard(true);
  elements.serviceStatus.textContent = state.settings.enabled ? '定时已启用' : '定时已停用';
  elements.serviceStatus.classList.toggle('ready', true);
  if (refillSettings) fillSettings(state.settings);
  renderWarnings(state.settingsWarnings || []);
  renderStats(state.stats || {});
  renderRecipients(state.recipients || []);
  renderJob(state.scheduler || {});
  renderLogs(state.logs || []);
  elements.emailPreview.innerHTML = state.preview?.html || '';
}

async function loadState({ quiet = false, refillSettings = true } = {}) {
  if (!adminToken) {
    showDashboard(false);
    return;
  }
  try {
    const payload = await api('/api/state');
    renderState(payload, { refillSettings });
    if (!quiet) setNotice('');
  } catch (error) {
    if (error.status === 401) {
      adminToken = '';
      localStorage.removeItem(tokenKey);
      showDashboard(false);
    }
    setNotice(error.message, 'error');
  }
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

async function runAction(action, successMessage, options = {}) {
  if (isBusy) return;
  setBusy(true);
  setNotice('');
  try {
    const payload = await action();
    if (payload.state) {
      renderState(payload.state, { refillSettings: options.refillSettings ?? true });
    } else {
      await loadState({ quiet: true, refillSettings: options.refillSettings ?? true });
    }
    setNotice(successMessage);
  } catch (error) {
    setNotice(error.message, 'error');
  } finally {
    setBusy(false);
  }
}

elements.loginButton.addEventListener('click', async () => {
  adminToken = elements.tokenInput.value.trim();
  if (!adminToken) {
    setNotice('管理 Token 不能为空', 'error');
    return;
  }
  localStorage.setItem(tokenKey, adminToken);
  await loadState();
});

elements.logoutButton.addEventListener('click', () => {
  adminToken = '';
  localStorage.removeItem(tokenKey);
  showDashboard(false);
  setNotice('');
});

elements.refreshButton.addEventListener('click', () => loadState({ refillSettings: false }));

elements.saveSettingsButton.addEventListener('click', () =>
  runAction(
    () =>
      api('/api/settings', {
        method: 'PUT',
        body: collectSettings()
      }),
    '配置已保存'
  )
);

elements.uploadButton.addEventListener('click', () =>
  runAction(async () => {
    const file = elements.fileInput.files?.[0];
    if (!file) throw new Error('请选择名单文件');
    const formData = new FormData();
    formData.set('file', file);
    return api('/api/upload', {
      method: 'POST',
      body: formData
    });
  }, '名单已导入')
);

elements.testButton.addEventListener('click', () =>
  runAction(
    () =>
      api('/api/test', {
        method: 'POST',
        body: {
          email: elements.testEmailInput.value,
          companyName: elements.testCompanyInput.value
        }
      }),
    '测试邮件已发送',
    { refillSettings: false }
  )
);

elements.runNowButton.addEventListener('click', () =>
  runAction(
    () =>
      api('/api/job/run', {
        method: 'POST'
      }),
    '任务已启动',
    { refillSettings: false }
  )
);

elements.stopJobButton.addEventListener('click', () =>
  runAction(
    () =>
      api('/api/job/stop', {
        method: 'POST'
      }),
    '停止请求已发送',
    { refillSettings: false }
  )
);

elements.resetFailedButton.addEventListener('click', () =>
  runAction(
    () =>
      api('/api/recipients/reset-failed', {
        method: 'POST'
      }),
    '失败名单已恢复'
  )
);

elements.clearPendingButton.addEventListener('click', () => {
  const confirmed = window.confirm('确认清空所有未发送名单？');
  if (!confirmed) return;
  runAction(
    () =>
      api('/api/recipients/pending', {
        method: 'DELETE'
      }),
    '未发送名单已清空'
  );
});

if (adminToken) {
  elements.tokenInput.value = adminToken;
  loadState();
} else {
  showDashboard(false);
}

setInterval(() => {
  if (adminToken && !isBusy) loadState({ quiet: true, refillSettings: false });
}, 15000);
