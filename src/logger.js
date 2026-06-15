const fs = require('fs');
const path = require('path');

const LOG_PATH = path.join(__dirname, '../data/errors.json');

function loadLog() {
  try { return JSON.parse(fs.readFileSync(LOG_PATH, 'utf8')); }
  catch { return []; }
}

function logError(script, error, context = {}) {
  const entries = loadLog();
  entries.push({
    ts: new Date().toISOString(),
    script,
    error: error?.message || String(error),
    ...context,
  });
  // Keep last 300 entries
  const trimmed = entries.slice(-300);
  fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true });
  fs.writeFileSync(LOG_PATH, JSON.stringify(trimmed, null, 2));
  console.error(`[ERROR LOG] ${script}: ${error?.message || error}`);
}

module.exports = { logError };
