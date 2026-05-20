export type RowStatus = 'pending' | 'skipped' | 'sending' | 'sent' | 'failed';

export interface AppConfig {
  serverUrl: string;
  apiToken: string;
  smtpHost: string;
  smtpPort: number;
  smtpEncryption: 'tls' | 'starttls' | 'none';
  smtpUsername: string;
  smtpPassword: string;
  fromEmail: string;
  fromName: string;
  branchName: string;
  presidentName: string;
  managerName: string;
  managerPhone: string;
  sendIntervalSeconds: number;
  sendLimitPerBatch: number;
  testRecipient: string;
}

export interface RecipientRow {
  id: string;
  rowNumber: number;
  companyName: string;
  email: string;
  isValid: boolean;
  errors: string[];
  status: RowStatus;
  message?: string;
}

export interface EmailPreview {
  subject: string;
  text: string;
  html: string;
}

export interface SendProgress {
  id: string;
  email: string;
  status: RowStatus;
  message: string;
}

export interface AppLog {
  id: string;
  timeMs: number;
  level: 'info' | 'warn' | 'error';
  message: string;
}

export interface BatchSummary {
  total: number;
  sent: number;
  skipped: number;
  failed: number;
  limitReached: boolean;
}
