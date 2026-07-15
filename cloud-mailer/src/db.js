import Database from 'better-sqlite3';

export const DEFAULT_SUBJECT = '知识产权质押融资服务提示';

export const DEFAULT_SETTINGS = {
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
  subject: DEFAULT_SUBJECT,
  sendTime: '09:00',
  timeZone: 'Asia/Shanghai',
  dailyLimit: 50,
  sendIntervalSeconds: 3,
  enabled: false
};

function nowIso() {
  return new Date().toISOString();
}

function rowToSettings(row) {
  return {
    smtpHost: row.smtp_host,
    smtpPort: row.smtp_port,
    smtpEncryption: row.smtp_encryption,
    smtpUsername: row.smtp_username,
    smtpPassword: row.smtp_password,
    fromEmail: row.from_email,
    fromName: row.from_name,
    branchName: row.branch_name,
    presidentName: row.president_name,
    managerName: row.manager_name,
    managerPhone: row.manager_phone,
    subject: row.subject,
    sendTime: row.send_time,
    timeZone: row.time_zone,
    dailyLimit: row.daily_limit,
    sendIntervalSeconds: row.send_interval_seconds,
    enabled: Boolean(row.enabled),
    updatedAt: row.updated_at
  };
}

export function publicSettings(settings) {
  return {
    ...settings,
    smtpPassword: '',
    smtpPasswordSet: Boolean(settings.smtpPassword)
  };
}

export function normalizeEmail(email) {
  return String(email ?? '').trim().toLowerCase();
}

export function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeEmail(email));
}

export function createDatabase(dbPath = process.env.MAILER_DB_PATH || './data/cloud-mailer.sqlite') {
  const db = new Database(dbPath);
  db.pragma('busy_timeout = 5000');
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS mailer_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      smtp_host TEXT NOT NULL DEFAULT '',
      smtp_port INTEGER NOT NULL DEFAULT 465,
      smtp_encryption TEXT NOT NULL DEFAULT 'tls',
      smtp_username TEXT NOT NULL DEFAULT '',
      smtp_password TEXT NOT NULL DEFAULT '',
      from_email TEXT NOT NULL DEFAULT '',
      from_name TEXT NOT NULL DEFAULT '',
      branch_name TEXT NOT NULL DEFAULT '',
      president_name TEXT NOT NULL DEFAULT '',
      manager_name TEXT NOT NULL DEFAULT '',
      manager_phone TEXT NOT NULL DEFAULT '',
      subject TEXT NOT NULL DEFAULT '${DEFAULT_SUBJECT}',
      send_time TEXT NOT NULL DEFAULT '09:00',
      time_zone TEXT NOT NULL DEFAULT 'Asia/Shanghai',
      daily_limit INTEGER NOT NULL DEFAULT 50,
      send_interval_seconds INTEGER NOT NULL DEFAULT 3,
      enabled INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    INSERT OR IGNORE INTO mailer_settings (
      id,
      branch_name,
      president_name,
      manager_name,
      manager_phone,
      subject
    ) VALUES (
      1,
      '${DEFAULT_SETTINGS.branchName}',
      '${DEFAULT_SETTINGS.presidentName}',
      '${DEFAULT_SETTINGS.managerName}',
      '${DEFAULT_SETTINGS.managerPhone}',
      '${DEFAULT_SETTINGS.subject}'
    );

    CREATE TABLE IF NOT EXISTS recipients (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE,
      company_name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      last_error TEXT NOT NULL DEFAULT '',
      imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      sent_at TEXT,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_recipients_status_id
      ON recipients(status, id);

    CREATE TABLE IF NOT EXISTS send_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      level TEXT NOT NULL,
      message TEXT NOT NULL,
      recipient_email TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_send_logs_created_at
      ON send_logs(created_at);

    CREATE TABLE IF NOT EXISTS job_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_key TEXT NOT NULL UNIQUE,
      source TEXT NOT NULL,
      status TEXT NOT NULL,
      started_at TEXT NOT NULL,
      finished_at TEXT,
      sent_count INTEGER NOT NULL DEFAULT 0,
      skipped_count INTEGER NOT NULL DEFAULT 0,
      failed_count INTEGER NOT NULL DEFAULT 0,
      message TEXT NOT NULL DEFAULT ''
    );

    CREATE INDEX IF NOT EXISTS idx_job_runs_started_at
      ON job_runs(started_at);
  `);
  return db;
}

export function getSettings(db) {
  const row = db.prepare('SELECT * FROM mailer_settings WHERE id = 1').get();
  return {
    ...DEFAULT_SETTINGS,
    ...rowToSettings(row)
  };
}

export function saveSettings(db, incoming) {
  const current = getSettings(db);
  const settings = {
    ...current,
    ...incoming
  };
  if (!Object.prototype.hasOwnProperty.call(incoming, 'smtpPassword') || incoming.smtpPassword === '') {
    settings.smtpPassword = current.smtpPassword;
  }

  const payload = {
    smtpHost: String(settings.smtpHost ?? '').trim(),
    smtpPort: Number(settings.smtpPort) || DEFAULT_SETTINGS.smtpPort,
    smtpEncryption: String(settings.smtpEncryption ?? DEFAULT_SETTINGS.smtpEncryption).trim(),
    smtpUsername: String(settings.smtpUsername ?? '').trim(),
    smtpPassword: String(settings.smtpPassword ?? ''),
    fromEmail: normalizeEmail(settings.fromEmail),
    fromName: String(settings.fromName ?? '').trim(),
    branchName: String(settings.branchName ?? '').trim(),
    presidentName: String(settings.presidentName ?? '').trim(),
    managerName: String(settings.managerName ?? '').trim(),
    managerPhone: String(settings.managerPhone ?? '').trim(),
    subject: String(settings.subject || DEFAULT_SUBJECT).trim() || DEFAULT_SUBJECT,
    sendTime: String(settings.sendTime || DEFAULT_SETTINGS.sendTime).trim(),
    timeZone: String(settings.timeZone || DEFAULT_SETTINGS.timeZone).trim(),
    dailyLimit: Math.max(0, Math.floor(Number(settings.dailyLimit) || 0)),
    sendIntervalSeconds: Math.max(0, Math.floor(Number(settings.sendIntervalSeconds) || 0)),
    enabled: settings.enabled ? 1 : 0,
    updatedAt: nowIso()
  };

  db.prepare(`
    UPDATE mailer_settings
    SET
      smtp_host = @smtpHost,
      smtp_port = @smtpPort,
      smtp_encryption = @smtpEncryption,
      smtp_username = @smtpUsername,
      smtp_password = @smtpPassword,
      from_email = @fromEmail,
      from_name = @fromName,
      branch_name = @branchName,
      president_name = @presidentName,
      manager_name = @managerName,
      manager_phone = @managerPhone,
      subject = @subject,
      send_time = @sendTime,
      time_zone = @timeZone,
      daily_limit = @dailyLimit,
      send_interval_seconds = @sendIntervalSeconds,
      enabled = @enabled,
      updated_at = @updatedAt
    WHERE id = 1
  `).run(payload);

  return getSettings(db);
}

export function recipientRowToRecord(row) {
  return {
    id: row.id,
    email: row.email,
    companyName: row.company_name,
    status: row.status,
    lastError: row.last_error,
    importedAt: row.imported_at,
    sentAt: row.sent_at,
    updatedAt: row.updated_at
  };
}

export function upsertRecipients(db, rows) {
  const insert = db.prepare(`
    INSERT INTO recipients (
      email,
      company_name,
      status,
      last_error,
      sent_at,
      updated_at
    ) VALUES (
      @email,
      @companyName,
      'pending',
      '',
      NULL,
      @updatedAt
    )
    ON CONFLICT(email) DO UPDATE SET
      company_name = excluded.company_name,
      status = CASE
        WHEN recipients.status = 'sent' THEN recipients.status
        ELSE 'pending'
      END,
      last_error = CASE
        WHEN recipients.status = 'sent' THEN recipients.last_error
        ELSE ''
      END,
      sent_at = CASE
        WHEN recipients.status = 'sent' THEN recipients.sent_at
        ELSE NULL
      END,
      updated_at = excluded.updated_at
  `);
  const run = db.transaction((items) => {
    let imported = 0;
    let keptSent = 0;
    for (const row of items) {
      const existing = db.prepare('SELECT status FROM recipients WHERE email = ?').get(row.email);
      insert.run({
        ...row,
        updatedAt: nowIso()
      });
      if (existing?.status === 'sent') {
        keptSent += 1;
      } else {
        imported += 1;
      }
    }
    return { imported, keptSent };
  });
  return run(rows);
}

export function listRecipients(db, { limit = 300, offset = 0 } = {}) {
  return db
    .prepare(
      `SELECT * FROM recipients
       ORDER BY
         CASE status
           WHEN 'pending' THEN 0
           WHEN 'sending' THEN 1
           WHEN 'failed' THEN 2
           WHEN 'sent' THEN 3
           ELSE 4
         END,
         id
       LIMIT ? OFFSET ?`
    )
    .all(limit, offset)
    .map(recipientRowToRecord);
}

export function getStats(db) {
  const rows = db
    .prepare('SELECT status, COUNT(*) AS count FROM recipients GROUP BY status')
    .all();
  const counts = {
    total: 0,
    pending: 0,
    sending: 0,
    sent: 0,
    failed: 0
  };
  for (const row of rows) {
    counts[row.status] = row.count;
    counts.total += row.count;
  }
  return counts;
}

export function addLog(db, level, message, recipientEmail = null) {
  db.prepare(
    `INSERT INTO send_logs (level, message, recipient_email, created_at)
     VALUES (?, ?, ?, ?)`
  ).run(level, message, recipientEmail, nowIso());
  db.prepare(
    `DELETE FROM send_logs
     WHERE id NOT IN (
       SELECT id FROM send_logs ORDER BY id DESC LIMIT 500
     )`
  ).run();
}

export function listLogs(db, limit = 120) {
  return db
    .prepare(
      `SELECT id, level, message, recipient_email, created_at
       FROM send_logs
       ORDER BY id DESC
       LIMIT ?`
    )
    .all(limit)
    .reverse()
    .map((row) => ({
      id: row.id,
      level: row.level,
      message: row.message,
      recipientEmail: row.recipient_email,
      createdAt: row.created_at
    }));
}

export function resetFailedRecipients(db) {
  const result = db
    .prepare(
      `UPDATE recipients
       SET status = 'pending', last_error = '', updated_at = ?
       WHERE status = 'failed'`
    )
    .run(nowIso());
  return result.changes;
}

export function clearPendingRecipients(db) {
  const result = db.prepare("DELETE FROM recipients WHERE status != 'sent'").run();
  return result.changes;
}

export function latestJobRuns(db, limit = 20) {
  return db
    .prepare(
      `SELECT * FROM job_runs
       ORDER BY started_at DESC
       LIMIT ?`
    )
    .all(limit)
    .map((row) => ({
      id: row.id,
      runKey: row.run_key,
      source: row.source,
      status: row.status,
      startedAt: row.started_at,
      finishedAt: row.finished_at,
      sentCount: row.sent_count,
      skippedCount: row.skipped_count,
      failedCount: row.failed_count,
      message: row.message
    }));
}
