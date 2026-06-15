require('dotenv').config();
const { XClient } = require('./xclient');
const { generateRepostComment } = require('./generator');
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

  // Pick a random target account to check
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
        if (hoursOld > 24) continue; // max 24h old
        if (tweet.text.startsWith('RT ')) continue; // skip retweets
        if (tweet.text.length < 40) continue; // skip very short

        // Generate Kerim's angle as a comment
        const comment = await generateRepostComment(tweet.text, account);
        if (!comment || comment.length < 10) continue;

        // Quote-tweet: send tweet with quoted URL
        const quotedUrl = `https://x.com/${account}/status/${tweet.id}`;
        const quotedText = `${comment} ${quotedUrl}`;

        if (quotedText.length > 280) {
          // Trim comment to fit
          const maxCommentLen = 280 - quotedUrl.length - 1;
          const trimmed = comment.substring(0, maxCommentLen);
          await x.sendTweet(`${trimmed} ${quotedUrl}`);
        } else {
          await x.sendTweet(quotedText);
        }

        log.reposts.push(tweet.id);
        console.log(`  ✅ Quote-tweeted @${account}: ${comment.substring(0, 60)}...`);
        done = true;
        break;
      }
    } catch (e) {
      console.error(`  Error with @${account}:`, e.message);
      continue;
    }
  }

  if (!done) console.log('  No suitable tweet found to repost today');
  saveLog(log);
}

if (require.main === module) {
  main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
}
