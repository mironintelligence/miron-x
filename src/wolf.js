require('dotenv').config();
const { generateWolfTweet } = require('./generator');
const { XClient } = require('./xclient');
const { logError } = require('./logger');
const fs = require('fs');
const path = require('path');

const DATA_PATH = path.join(__dirname, '../data/posted.json');

function load() {
  try { return JSON.parse(fs.readFileSync(DATA_PATH, 'utf8')); }
  catch { return []; }
}

function save(tweet, id = null) {
  const list = load().slice(-200);
  list.push({ text: tweet, id, ts: new Date().toISOString(), type: 'wolf' });
  fs.mkdirSync(path.dirname(DATA_PATH), { recursive: true });
  fs.writeFileSync(DATA_PATH, JSON.stringify(list, null, 2));
}

async function main() {
  console.log('▶ wolf.js — Daily wolf tweet');

  let tweet = null;
  try {
    for (let i = 0; i < 3; i++) {
      const candidate = await generateWolfTweet();
      if (candidate && candidate.length > 20) { tweet = candidate; break; }
    }
  } catch (e) {
    logError('wolf.js', e, { phase: 'generate' });
    process.exit(1);
  }

  if (!tweet) {
    logError('wolf.js', new Error('Could not generate wolf tweet after 3 attempts'), {});
    process.exit(1);
  }

  console.log(`Wolf tweet (${tweet.length}c):\n${tweet}\n`);

  try {
    const x = new XClient(process.env.XACTIONS_SESSION_COOKIE);
    const result = await x.sendTweet(tweet);
    console.log('✅ Posted');
    save(tweet, result?.id || null);
  } catch (e) {
    logError('wolf.js', e, { phase: 'send_tweet', tweet: tweet.substring(0, 80) });
    process.exit(1);
  }
}

if (require.main === module) {
  main().catch(e => {
    logError('wolf.js', e, { phase: 'uncaught' });
    process.exit(1);
  });
}
