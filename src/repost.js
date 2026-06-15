require('dotenv').config();
const { XClient } = require('./xclient');
const { generateRepostComment } = require('./generator');
const { logError } = require('./logger');
const config = require('./config');
const fs = require('fs');
const path = require('path');

const LOG_PATH = path.join(__dirname, '../data/engaged.json');

function loadLog() {
  try { return JSON.parse(fs.readFileSync(LOG_PATH, 'utf8')); }
  catch { return { reposts: [] }; }
}

function saveLog(log) {
  fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true });
  log.reposts = (log.reposts || []).slice(-200);
  fs.writeFileSync(LOG_PATH, JSON.stringify(log, null, 2));
}

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function collectAsync(gen, limit) {
  const results = [];
  for await (const item of gen) {
    results.push(item);
    if (results.length >= limit) break;
  }
  return results;
}

async function main() {
  console.log('▶ repost.js — Quote-tweet from key accounts');

  const x = new XClient(process.env.XACTIONS_SESSION_COOKIE);
  const log = loadLog();
  if (!log.reposts) log.reposts = [];

  const accounts = [...config.REPOST_ACCOUNTS].sort(() => Math.random() - 0.5);
  let done = false;

  for (const account of accounts) {
    if (done) break;
    try {
      console.log(`  Checking @${account}...`);
      const tweets = await collectAsync(x.getTweets(account, 8), 8);
      await sleep(1500);

      for (const tweet of tweets) {
        if (log.reposts.includes(tweet.id)) continue;
        const hoursOld = (Date.now() - new Date(tweet.timeParsed).getTime()) / 3600000;
        if (hoursOld > 24) continue;
        if (tweet.text.startsWith('RT ')) continue;
        if (tweet.text.length < 40) continue;

        const comment = await generateRepostComment(tweet.text, account);
        if (!comment || comment.length < 10) continue;

        const trimmedComment = comment.length > 270 ? comment.substring(0, 270) : comment;
        await x.sendTweet(trimmedComment, { quoteTweetId: tweet.id });

        log.reposts.push(tweet.id);
        console.log(`  ✅ Quote-tweeted @${account}: ${comment.substring(0, 60)}`);
        done = true;
        break;
      }
    } catch (e) {
      logError('repost.js', e, { phase: 'quote_tweet', account });
    }
  }

  if (!done) console.log('  No suitable tweet found today');
  saveLog(log);
}

if (require.main === module) {
  main().catch(e => {
    logError('repost.js', e, { phase: 'uncaught' });
    process.exit(1);
  });
}
