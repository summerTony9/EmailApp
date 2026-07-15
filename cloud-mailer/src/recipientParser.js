import { parse as parseCsv } from 'csv-parse/sync';
import readXlsxFile from 'read-excel-file/node';
import { isValidEmail, normalizeEmail } from './db.js';

function cleanCell(value) {
  return String(value ?? '').trim().replace(/^\uFEFF/, '').trim();
}

function decodeCsv(buffer) {
  const utf8 = buffer.toString('utf8');
  if (!utf8.includes('\uFFFD')) return utf8;
  try {
    return new TextDecoder('gb18030').decode(buffer);
  } catch {
    return utf8;
  }
}

function parseCsvRows(buffer) {
  const content = decodeCsv(buffer);
  return parseCsv(content, {
    bom: true,
    relaxColumnCount: true,
    skipEmptyLines: false
  }).map((row) => row.map(cleanCell));
}

async function parseExcelRows(buffer) {
  const rows = await readXlsxFile(buffer);
  return rows.map((row) => row.map(cleanCell));
}

function normalizeHeader(value) {
  return cleanCell(value).toLowerCase().replace(/\s|_|-/g, '');
}

function detectColumns(rows) {
  const header = rows[0];
  if (!header || header.length < 2) {
    const error = new Error('名单至少需要两列：企业名、邮箱');
    error.statusCode = 400;
    throw error;
  }

  const companyHeaders = [
    '企业名',
    '企业名称',
    '公司名',
    '公司名称',
    '客户名称',
    'company',
    'companyname',
    'company name',
    'name'
  ];
  const emailHeaders = ['邮箱', '企业邮箱', '邮件', 'email', 'e-mail', 'mail'];
  const headerMap = new Map(header.map((cell, index) => [normalizeHeader(cell), index]));
  const companyIndex = companyHeaders
    .map(normalizeHeader)
    .find((candidate) => headerMap.has(candidate));
  const emailIndex = emailHeaders.map(normalizeHeader).find((candidate) => headerMap.has(candidate));

  if (companyIndex && emailIndex && headerMap.get(companyIndex) !== headerMap.get(emailIndex)) {
    return {
      companyIndex: headerMap.get(companyIndex),
      emailIndex: headerMap.get(emailIndex),
      startIndex: 1
    };
  }

  return {
    companyIndex: 0,
    emailIndex: 1,
    startIndex: 0
  };
}

export async function parseRecipientFile(buffer, filename = '') {
  const extension = filename.split('.').pop()?.toLowerCase();
  const rawRows = extension === 'xlsx' ? await parseExcelRows(buffer) : parseCsvRows(buffer);
  const meaningfulRows = rawRows.filter((row) => row.some((cell) => cleanCell(cell)));
  if (meaningfulRows.length === 0) {
    const error = new Error('名单为空');
    error.statusCode = 400;
    throw error;
  }

  const { companyIndex, emailIndex, startIndex } = detectColumns(meaningfulRows);
  const seen = new Set();
  const validRows = [];
  const invalidRows = [];

  for (let index = startIndex; index < meaningfulRows.length; index += 1) {
    const row = meaningfulRows[index];
    const rowNumber = index + 1;
    const companyName = cleanCell(row[companyIndex]);
    const email = normalizeEmail(row[emailIndex]);
    const errors = [];

    if (!companyName) errors.push('企业名为空');
    if (!email) {
      errors.push('邮箱为空');
    } else if (!isValidEmail(email)) {
      errors.push('邮箱格式无效');
    } else if (seen.has(email)) {
      errors.push('邮箱在文件中重复');
    }

    if (errors.length > 0) {
      invalidRows.push({
        rowNumber,
        companyName,
        email,
        errors
      });
      continue;
    }

    seen.add(email);
    validRows.push({
      rowNumber,
      companyName,
      email
    });
  }

  return {
    totalRows: validRows.length + invalidRows.length,
    validRows,
    invalidRows
  };
}
