require('dotenv').config();
const { getTodaysTrends } = require('./trends');
const { generateTweet } = require('./generator');
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
  list.push({ text: tweet, ts: new Date().toISOString() });
  fs.mkdirSync(path.dirname(DATA_PATH), { recursive: true });
  fs.writeFileSync(DATA_PATH, JSON.stringify(list, null, 2));
}

function isDuplicate(tweet) {
  return load().some(p => p.text.substring(0, 55) === tweet.substring(0, 55));
}

async function main() {
  const slot = process.env.TWEET_SLOT || '1';
  console.log(`▶ post.js — Slot #${slot}`);

  const trends = await getTodaysTrends();
  console.log(`Trends: ${trends.hackerNews.length} HN + ${trends.rssNews.length} RSS`);

  let tweet = null;
  for (let i = 0; i < 3; i++) {
    const candidate = await generateTweet(trends, slot);
    if (!isDuplicate(candidate)) { tweet = candidate; break; }
    console.log(`Attempt ${i + 1}: duplicate, retrying...`);
  }

  if (!tweet) {
    console.error('Could not generate unique tweet');
    process.exit(1);
  }

  console.log(`Tweet (${tweet.length}c):\n${tweet}\n`);

  const x = new XClient(process.env.XACTIONS_SESSION_COOKIE);
  await x.sendTweet(tweet);
  console.log('✅ Posted');
  save(tweet);
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
