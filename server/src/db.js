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
  `);
  return db;
}

export function sentRecordExpirationCutoff(now = new Date()) {
  return new Date(now.getTime() - SENT_RECORD_EXPIRATION_MS).toISOString();
}

export function deleteExpiredSentRecords(db, now = new Date()) {
  const cutoff = sentRecordExpirationCutoff(now);
  const result = db.prepare(`
    DELETE FROM sent_records
    WHERE unixepoch(sent_at) IS NOT NULL
      AND unixepoch(sent_at) <= unixepoch(?)
  `).run(cutoff);
  return result.changes;
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
