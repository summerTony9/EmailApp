import {
  addLog,
  getSettings,
  getStats,
  latestJobRuns,
  recipientRowToRecord
} from './db.js';
import { sendEmail as defaultSendEmail } from './mailer.js';
import { normalizeTime, validateSettings } from './validation.js';

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function sleepWithStop(ms, getStopRequested) {
  let remaining = ms;
  while (remaining > 0) {
    if (getStopRequested()) return true;
    const step = Math.min(remaining, 500);
    await sleep(step);
    remaining -= step;
  }
  return getStopRequested();
}

export function localDateTimeParts(timeZone, date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  })
    .formatToParts(date)
    .reduce((result, part) => {
      if (part.type !== 'literal') result[part.type] = part.value;
      return result;
    }, {});

  return {
    dateKey: `${parts.year}-${parts.month}-${parts.day}`,
    minutes: Number(parts.hour) * 60 + Number(parts.minute)
  };
}

export function scheduledRunKey(settings, date = new Date()) {
  return localDateTimeParts(settings.timeZone, date).dateKey;
}

export function isScheduleDue(settings, date = new Date()) {
  if (!settings.enabled) return false;
  const sendTime = normalizeTime(settings.sendTime);
  if (!sendTime) return false;
  const [hour, minute] = sendTime.split(':').map(Number);
  const targetMinutes = hour * 60 + minute;
  return localDateTimeParts(settings.timeZone, date).minutes >= targetMinutes;
}

function findRun(db, runKey) {
  return db.prepare('SELECT status FROM job_runs WHERE run_key = ?').get(runKey);
}

function markInterruptedSendingAsPending(db) {
  return db
    .prepare(
      `UPDATE recipients
       SET status = 'pending',
           last_error = '服务重启前任务中断，已恢复为待发送',
           updated_at = ?
       WHERE status = 'sending'`
    )
    .run(new Date().toISOString()).changes;
}

function markInterruptedRunsFailed(db) {
  return db
    .prepare(
      `UPDATE job_runs
       SET status = 'failed',
           finished_at = ?,
           message = '服务重启前任务中断'
       WHERE status = 'running'`
    )
    .run(new Date().toISOString()).changes;
}

async function runSendJob({
  db,
  runKey,
  source,
  sendEmail,
  getStopRequested,
  allowRetryFailed = false
}) {
  const startedAt = new Date().toISOString();
  const existingRun = findRun(db, runKey);

  if (existingRun) {
    if (!allowRetryFailed || existingRun.status !== 'failed') {
      return {
        accepted: false,
        message: '任务已经存在'
      };
    }
    db.prepare(
      `UPDATE job_runs
       SET source = ?,
           status = 'running',
           started_at = ?,
           finished_at = NULL,
           sent_count = 0,
           skipped_count = 0,
           failed_count = 0,
           message = ''
       WHERE run_key = ?`
    ).run(source, startedAt, runKey);
  } else {
    db.prepare(
      `INSERT INTO job_runs (
        run_key,
        source,
        status,
        started_at
       ) VALUES (?, ?, 'running', ?)`
    ).run(runKey, source, startedAt);
  }

  const settings = getSettings(db);
  const limit = settings.dailyLimit > 0 ? Math.min(settings.dailyLimit, 2_147_483_647) : 2_147_483_647;
  const rows = db
    .prepare(
      `SELECT * FROM recipients
       WHERE status = 'pending'
       ORDER BY id
       LIMIT ?`
    )
    .all(limit);

  const updateSending = db.prepare(
    `UPDATE recipients
     SET status = 'sending', last_error = '', updated_at = ?
     WHERE id = ? AND status = 'pending'`
  );
  const updateSent = db.prepare(
    `UPDATE recipients
     SET status = 'sent', last_error = '', sent_at = ?, updated_at = ?
     WHERE id = ?`
  );
  const updateFailed = db.prepare(
    `UPDATE recipients
     SET status = 'failed', last_error = ?, updated_at = ?
     WHERE id = ?`
  );
  const updateRun = db.prepare(
    `UPDATE job_runs
     SET
       status = @status,
       finished_at = @finishedAt,
       sent_count = @sentCount,
       skipped_count = @skippedCount,
       failed_count = @failedCount,
       message = @message
     WHERE run_key = @runKey`
  );

  const summary = {
    accepted: true,
    runKey,
    source,
    total: rows.length,
    sentCount: 0,
    skippedCount: 0,
    failedCount: 0,
    stopped: false,
    message: ''
  };

  addLog(db, 'info', `任务开始：${source === 'scheduled' ? '定时' : '手动'}，本次最多 ${rows.length} 封`);

  let failedUnexpectedly = false;
  try {
    if (rows.length === 0) {
      summary.message = '没有待发送名单';
      addLog(db, 'info', summary.message);
      return summary;
    }

    for (let index = 0; index < rows.length; index += 1) {
      if (getStopRequested()) {
        summary.stopped = true;
        summary.message = '任务已手动停止';
        addLog(db, 'warn', summary.message);
        break;
      }

      const row = rows[index];
      const recipient = recipientRowToRecord(row);
      const now = new Date().toISOString();
      const locked = updateSending.run(now, row.id);
      if (locked.changes === 0) {
        summary.skippedCount += 1;
        continue;
      }

      try {
        addLog(db, 'info', `正在发送：${recipient.companyName} <${recipient.email}>`, recipient.email);
        await sendEmail(settings, recipient);
        const sentAt = new Date().toISOString();
        updateSent.run(sentAt, sentAt, row.id);
        summary.sentCount += 1;
        addLog(db, 'info', `发送成功：${recipient.email}`, recipient.email);
      } catch (error) {
        const failedAt = new Date().toISOString();
        const message = error?.message || String(error);
        updateFailed.run(message, failedAt, row.id);
        summary.failedCount += 1;
        addLog(db, 'error', `发送失败：${recipient.email}，${message}`, recipient.email);
      }

      if (index + 1 < rows.length && settings.sendIntervalSeconds > 0) {
        const stopped = await sleepWithStop(settings.sendIntervalSeconds * 1000, getStopRequested);
        if (stopped) {
          summary.stopped = true;
          summary.message = '任务已手动停止';
          addLog(db, 'warn', summary.message);
          break;
        }
      }
    }

    if (!summary.message) {
      summary.message = `任务完成：成功 ${summary.sentCount}，失败 ${summary.failedCount}，跳过 ${summary.skippedCount}`;
      addLog(db, 'info', summary.message);
    }

    return summary;
  } catch (error) {
    failedUnexpectedly = true;
    summary.message = error?.message || String(error);
    addLog(db, 'error', `任务异常：${summary.message}`);
    throw error;
  } finally {
    updateRun.run({
      runKey,
      status: summary.stopped ? 'stopped' : failedUnexpectedly ? 'failed' : 'completed',
      finishedAt: new Date().toISOString(),
      sentCount: summary.sentCount,
      skippedCount: summary.skippedCount,
      failedCount: summary.failedCount,
      message: summary.message
    });
  }
}

export function createScheduler({
  db,
  sendEmail = defaultSendEmail,
  tickMs = 30_000,
  logger = console
}) {
  let timer = null;
  let activeJob = null;
  let lastInvalidScheduleRunKey = '';

  function status() {
    return {
      activeJob: activeJob
        ? {
            runKey: activeJob.runKey,
            source: activeJob.source,
            startedAt: activeJob.startedAt,
            stopRequested: activeJob.stopRequested
          }
        : null,
      stats: getStats(db),
      latestRuns: latestJobRuns(db, 10)
    };
  }

  function startJob(source = 'manual', options = {}) {
    if (activeJob) {
      return {
        accepted: false,
        message: '已有发送任务正在运行',
        activeJob: status().activeJob
      };
    }

    const runKey =
      options.runKey ||
      (source === 'scheduled'
        ? scheduledRunKey(getSettings(db), options.now)
        : `manual-${Date.now()}`);

    const existingRun = findRun(db, runKey);
    if (existingRun && !(source === 'scheduled' && existingRun.status === 'failed')) {
      return {
        accepted: false,
        message: '今天的定时任务已经触发过'
      };
    }

    const settings = getSettings(db);
    const errors = validateSettings(settings, { requireSmtp: true });
    if (errors.length > 0) {
      return {
        accepted: false,
        message: errors.join('；')
      };
    }

    activeJob = {
      runKey,
      source,
      startedAt: new Date().toISOString(),
      stopRequested: false
    };

    runSendJob({
      db,
      runKey,
      source,
      sendEmail,
      getStopRequested: () => activeJob?.stopRequested === true,
      allowRetryFailed: source === 'scheduled'
    })
      .catch((error) => {
        logger.error?.(error);
      })
      .finally(() => {
        activeJob = null;
      });

    return {
      accepted: true,
      runKey,
      message: '任务已启动'
    };
  }

  function stopJob() {
    if (!activeJob) {
      return {
        stopped: false,
        message: '当前没有正在运行的任务'
      };
    }
    activeJob.stopRequested = true;
    addLog(db, 'warn', '已请求停止当前任务');
    return {
      stopped: true,
      message: '已请求停止当前任务'
    };
  }

  function tick(now = new Date()) {
    const settings = getSettings(db);
    if (!settings.enabled || !isScheduleDue(settings, now)) return null;
    const runKey = scheduledRunKey(settings, now);
    const existingRun = findRun(db, runKey);
    if (existingRun && existingRun.status !== 'failed') return null;

    const errors = validateSettings(settings, { requireSmtp: true });
    if (errors.length > 0) {
      if (lastInvalidScheduleRunKey !== runKey) {
        lastInvalidScheduleRunKey = runKey;
        addLog(db, 'error', `定时任务未启动：${errors.join('；')}`);
      }
      return {
        accepted: false,
        message: errors.join('；')
      };
    }

    lastInvalidScheduleRunKey = '';
    return startJob('scheduled', { runKey, now });
  }

  function start() {
    const recovered = markInterruptedSendingAsPending(db);
    if (recovered > 0) {
      addLog(db, 'warn', `恢复 ${recovered} 条上次中断的发送中记录`);
    }
    const interruptedRuns = markInterruptedRunsFailed(db);
    if (interruptedRuns > 0) {
      addLog(db, 'warn', `标记 ${interruptedRuns} 个上次中断的任务为失败`);
    }
    timer = setInterval(() => {
      try {
        tick();
      } catch (error) {
        logger.error?.(error);
      }
    }, tickMs);
    setTimeout(() => {
      try {
        tick();
      } catch (error) {
        logger.error?.(error);
      }
    }, 1500);
  }

  function close() {
    if (timer) clearInterval(timer);
    timer = null;
    if (activeJob) activeJob.stopRequested = true;
  }

  return {
    start,
    close,
    tick,
    status,
    startJob,
    stopJob
  };
}

export { runSendJob };
