const TITLE = '강원도 밈 업데이트!';
const DAY_MS = 24 * 60 * 60 * 1000;
const INITIAL_DAYS = 3;
const OVERLAP_DAYS = 3;
const MAX_RUN_MS = 4.5 * 60 * 1000;

function installTrigger() {
  ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === 'forwardGrokMail')
    .forEach(t => ScriptApp.deleteTrigger(t));
  // nearMinute() may fire ±15 minutes. 25 targets the 08:10–08:40 / 20:10–20:40 KST window.
  [8, 20].forEach(hour => ScriptApp.newTrigger('forwardGrokMail').timeBased()
    .atHour(hour).nearMinute(25).everyDays(1).inTimezone('Asia/Seoul').create());
}

function forwardGrokMail() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return;
  try {
    const properties = PropertiesService.getScriptProperties();
    const url = properties.getProperty('INGEST_URL');
    const secret = properties.getProperty('INGEST_SECRET');
    if (!url || !secret) throw new Error('INGEST_URL 또는 INGEST_SECRET이 없습니다');
    const runStarted = Date.now();
    let completed = Number(properties.getProperty('COMPLETED_UNTIL_MS'));
    if (!Number.isFinite(completed) || completed <= 0) {
      completed = runStarted - INITIAL_DAYS * DAY_MS;
      properties.setProperty('COMPLETED_UNTIL_MS', String(completed));
    }
    const runEnd = runStarted;
    while (completed < runEnd) {
      if (Date.now() - runStarted > MAX_RUN_MS) return;
      const end = Math.min(completed + DAY_MS, runEnd);
      const start = Math.max(0, completed - OVERLAP_DAYS * DAY_MS);
      if (!forwardWindow(start, end, url, secret, runStarted)) return;
      completed = end;
      properties.setProperty('COMPLETED_UNTIL_MS', String(completed));
    }
  } finally {
    lock.releaseLock();
  }
}

function forwardWindow(start, end, url, secret, runStarted) {
  const startDate = Utilities.formatDate(new Date(start - DAY_MS), 'UTC', 'yyyy/MM/dd');
  const endDate = Utilities.formatDate(new Date(end + DAY_MS), 'UTC', 'yyyy/MM/dd');
  const query = `subject:"${TITLE}" after:${startDate} before:${endDate}`;
  let offset = 0;
  while (true) {
    if (Date.now() - runStarted > MAX_RUN_MS) return false;
    const threads = GmailApp.search(query, offset, 100);
    if (threads.length === 0) return true;
    for (const thread of threads) {
      for (const message of thread.getMessages()) {
        const receivedAt = message.getDate().getTime();
        if (receivedAt < start || receivedAt >= end || message.getSubject().trim() !== TITLE) continue;
        const id = message.getId();
        try {
          const response = UrlFetchApp.fetch(url, {
            method: 'post', contentType: 'application/json', muteHttpExceptions: true,
            headers: { Authorization: `Bearer ${secret}` },
            payload: JSON.stringify({ messageId: id, receivedAt: message.getDate().toISOString(), body: message.getPlainBody() }),
          });
          const result = response.getResponseCode() === 200 ? JSON.parse(response.getContentText()) : null;
          if (!result || !['created', 'duplicate'].includes(result.status) || typeof result.batchId !== 'string' ||
              !['parsed', 'raw', 'skipped'].every(key => Number.isInteger(result[key]) && result[key] >= 0)) {
            console.error(`전달 실패: ${id}, HTTP ${response.getResponseCode()}`);
            return false;
          }
        } catch (error) {
          console.error(`전달 실패: ${id}, ${String(error).slice(0, 100)}`);
          return false;
        }
      }
    }
    offset += threads.length;
    if (threads.length < 100) return true;
  }
}
