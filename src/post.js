require('dotenv').config();
const { getTodaysTrends } = require('./trends');
const { generateTweet } = require('./generator');
const { XClient } = require('./xclient');
const { logError } = require('./logger');
const fs = require('fs');
const path = require('path');

const DATA_PATH = path.join(__dirname, '../data/posted.json');

function load() {
  try { return JSON.parse(fs.readFileSync(DATA_PATH, 'utf8')); }
  catch { return []; }
}

function save(tweet, id = null, type = 'general') {
  const list = load().slice(-200);
  list.push({ text: tweet, id, ts: new Date().toISOString(), type });
  fs.mkdirSync(path.dirname(DATA_PATH), { recursive: true });
  fs.writeFileSync(DATA_PATH, JSON.stringify(list, null, 2));
}

function isDuplicate(tweet) {
  return load().some(p => p.text.substring(0, 55) === tweet.substring(0, 55));
}

async function main() {
  const slot = process.env.TWEET_SLOT || '1';
  const type = process.env.SV_MODE === 'true' ? 'sv' : process.env.LONDON_MODE === 'true' ? 'london' : 'general';
  console.log(`▶ post.js — Slot #${slot} [${type}]`);

  let trends;
  try {
    trends = await getTodaysTrends();
    console.log(`Trends: ${trends.hackerNews.length} HN + ${trends.rssNews.length} RSS`);
  } catch (e) {
    logError('post.js', e, { slot, phase: 'fetch_trends' });
    process.exit(1);
  }

  let tweet = null;
  try {
    for (let i = 0; i < 3; i++) {
      const candidate = await generateTweet(trends, slot);
      if (!isDuplicate(candidate)) { tweet = candidate; break; }
      console.log(`Attempt ${i + 1}: duplicate, retrying...`);
    }
  } catch (e) {
    logError('post.js', e, { slot, phase: 'generate_tweet', type });
    process.exit(1);
  }

  if (!tweet) {
    logError('post.js', new Error('Could not generate unique tweet after 3 attempts'), { slot, type });
    process.exit(1);
  }

  console.log(`Tweet (${tweet.length}c):\n${tweet}\n`);

  try {
    const x = new XClient(process.env.XACTIONS_SESSION_COOKIE);
    const result = await x.sendTweet(tweet);
    console.log('✅ Posted');
    save(tweet, result?.id || null, type);
  } catch (e) {
    logError('post.js', e, { slot, type, phase: 'send_tweet', tweet: tweet.substring(0, 80) });
    process.exit(1);
  }
}

if (require.main === module) {
  main().catch(e => {
    logError('post.js', e, { slot: process.env.TWEET_SLOT, phase: 'uncaught' });
    process.exit(1);
  });
}
