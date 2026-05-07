import Database from 'better-sqlite3';

export const SENT_RECORD_EXPIRATION_DAYS = 90;
export const SENT_RECORD_EXPIRATION_MS = SENT_RECORD_EXPIRATION_DAYS * 24 * 60 * 60 * 1000;

export function normalizeEmail(email) {
  return String(email ?? '').trim().toLowerCase();
}

export function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeEmail(email));
}

export function createDatabase(dbPath = process.env.DB_PATH || './data/emailapp.sqlite') {
  const db = new Database(dbPath);
  db.pragma('busy_timeout = 5000');
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS sent_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE,
      company_name TEXT NOT NULL,
      manager_name TEXT NOT NULL,
      manager_phone TEXT NOT NULL,
      branch_name TEXT NOT NULL,
      president_name TEXT NOT NULL,
      subject TEXT NOT NULL,
      sent_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_sent_records_sent_at
      ON sent_records(sent_at);

    CREATE TABLE IF NOT EXISTS sent_record_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sent_record_id INTEGER NOT NULL,
      email TEXT NOT NULL,
      company_name TEXT NOT NULL,
      manager_name TEXT NOT NULL,
      manager_phone TEXT NOT NULL,
      branch_name TEXT NOT NULL,
      president_name TEXT NOT NULL,
      subject TEXT NOT NULL,
      sent_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      archived_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_sent_record_history_email
      ON sent_record_history(email);

    CREATE INDEX IF NOT EXISTS idx_sent_record_history_sent_at
      ON sent_record_history(sent_at);
  `);
  return db;
}

export function sentRecordExpirationCutoff(now = new Date()) {
  return new Date(now.getTime() - SENT_RECORD_EXPIRATION_MS);
}

export function isSentRecordActive(row, now = new Date()) {
  if (!row) return false;
  const sentAt = Date.parse(row.sent_at);
  if (Number.isNaN(sentAt)) return true;
  return sentAt > sentRecordExpirationCutoff(now).getTime();
}

export function rowToRecord(row) {
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    companyName: row.company_name,
    managerName: row.manager_name,
    managerPhone: row.manager_phone,
    branchName: row.branch_name,
    presidentName: row.president_name,
    subject: row.subject,
    sentAt: row.sent_at,
    createdAt: row.created_at
  };
}
