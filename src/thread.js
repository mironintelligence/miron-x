require('dotenv').config();
const { getTodaysTrends } = require('./trends');
const { generateThread } = require('./generator');
const { XClient } = require('./xclient');
const { logError } = require('./logger');
const fs = require('fs');
const path = require('path');

const DATA_PATH = path.join(__dirname, '../data/posted.json');

function loadPosted() {
  try { return JSON.parse(fs.readFileSync(DATA_PATH, 'utf8')); }
  catch { return []; }
}

function saveTweet(text, id = null) {
  const list = loadPosted().slice(-200);
  list.push({ text, id, ts: new Date().toISOString(), type: 'thread' });
  fs.mkdirSync(path.dirname(DATA_PATH), { recursive: true });
  fs.writeFileSync(DATA_PATH, JSON.stringify(list, null, 2));
}

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  console.log('▶ thread.js — Morning thread');

  let trends;
  try {
    trends = await getTodaysTrends();
  } catch (e) {
    logError('thread.js', e, { phase: 'fetch_trends' });
    process.exit(1);
  }

  let tweets;
  try {
    tweets = await generateThread(trends);
  } catch (e) {
    logError('thread.js', e, { phase: 'generate_thread' });
    process.exit(1);
  }

  if (!tweets || tweets.length < 3) {
    logError('thread.js', new Error(`Thread too short: ${tweets?.length ?? 0} tweets`), { phase: 'generate_thread' });
    process.exit(1);
  }

  console.log(`Generated ${tweets.length}-tweet thread:`);
  tweets.forEach((t, i) => console.log(`  ${i + 1}: ${t.substring(0, 70)}`));

  const x = new XClient(process.env.XACTIONS_SESSION_COOKIE);
  let lastId = null;

  for (let i = 0; i < tweets.length; i++) {
    try {
      const result = await x.sendTweet(tweets[i], lastId ? { replyTo: lastId } : {});
      lastId = result?.id || null;
      saveTweet(tweets[i], lastId);
      console.log(`✅ Tweet ${i + 1}/${tweets.length} posted`);
      if (i < tweets.length - 1) await sleep(4500);
    } catch (e) {
      logError('thread.js', e, { phase: 'send_tweet', tweetIndex: i + 1, tweet: tweets[i].substring(0, 80) });
    }
  }

  console.log('✅ Thread complete');
}

if (require.main === module) {
  main().catch(e => {
    logError('thread.js', e, { phase: 'uncaught' });
    process.exit(1);
  });
}
