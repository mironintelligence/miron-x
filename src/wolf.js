require('dotenv').config();
const { generateWolfTweet } = require('./generator');
const { XClient } = require('./xclient');
const fs = require('fs');
const path = require('path');

const DATA_PATH = path.join(__dirname, '../data/posted.json');

function load() {
  try { return JSON.parse(fs.readFileSync(DATA_PATH, 'utf8')); }
  catch { return []; }
}

function save(tweet) {
  const list = load().slice(-150);
  list.push({ text: tweet, ts: new Date().toISOString(), type: 'wolf' });
  fs.mkdirSync(path.dirname(DATA_PATH), { recursive: true });
  fs.writeFileSync(DATA_PATH, JSON.stringify(list, null, 2));
}

async function main() {
  console.log('▶ wolf.js — Daily wolf tweet');

  let tweet = null;
  for (let i = 0; i < 3; i++) {
    const candidate = await generateWolfTweet();
    if (candidate && candidate.length > 20) { tweet = candidate; break; }
  }

  if (!tweet) {
    console.error('Could not generate wolf tweet');
    process.exit(1);
  }

  console.log(`Wolf tweet (${tweet.length}c):\n${tweet}\n`);

  const x = new XClient(process.env.XACTIONS_SESSION_COOKIE);
  await x.sendTweet(tweet);
  console.log('✅ Posted');
  save(tweet);
}

if (require.main === module) {
  main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
}
