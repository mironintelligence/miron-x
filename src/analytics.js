// Self-improving analytics loop
// 1. Checks engagement on all tracked tweets
// 2. Scores them (likes x3 + retweets x5 + replies x2)
// 3. Saves top performers to data/top_tweets.json
// 4. Generator uses top performers as style examples

require('dotenv').config();
const { XClient } = require('./xclient');
const fs = require('fs');
const path = require('path');

const POSTED_PATH = path.join(__dirname, '../data/posted.json');
const TOP_PATH = path.join(__dirname, '../data/top_tweets.json');

function loadPosted() {
  try { return JSON.parse(fs.readFileSync(POSTED_PATH, 'utf8')); }
  catch { return []; }
}

function loadTop() {
  try { return JSON.parse(fs.readFileSync(TOP_PATH, 'utf8')); }
  catch { return []; }
}

function saveTop(tweets) {
  fs.mkdirSync(path.dirname(TOP_PATH), { recursive: true });
  fs.writeFileSync(TOP_PATH, JSON.stringify(tweets, null, 2));
}

function savePosted(tweets) {
  fs.writeFileSync(POSTED_PATH, JSON.stringify(tweets, null, 2));
}

function score(t) {
  return (t.likes || 0) * 3 + (t.retweets || 0) * 5 + (t.replies || 0) * 2;
}

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  console.log('▶ analytics.js — Engagement tracking + self-improvement');

  const x = new XClient(process.env.XACTIONS_SESSION_COOKIE);
  const posted = loadPosted();

  // Only check tweets that have an ID and haven't been checked in last 2h
  const toCheck = posted.filter(t =>
    t.id &&
    (!t.lastChecked || Date.now() - new Date(t.lastChecked).getTime() > 2 * 3600000)
  );

  console.log(`Checking ${toCheck.length} tweets...`);
  let updated = 0;

  for (const tweet of toCheck) {
    try {
      const data = await x.getTweetById(tweet.id);
      tweet.likes = data.likes;
      tweet.retweets = data.retweets;
      tweet.replies = data.replies;
      tweet.score = score(tweet);
      tweet.lastChecked = new Date().toISOString();
      updated++;
      if (updated % 5 === 0) console.log(`  ${updated}/${toCheck.length} checked...`);
      await sleep(800);
    } catch (e) {
      // Tweet might be deleted or ID invalid — skip silently
      tweet.lastChecked = new Date().toISOString();
    }
  }

  savePosted(posted);
  console.log(`Updated ${updated} tweets with engagement data`);

  // Build top performers list — tweets with score > 0, sorted
  const withScore = posted
    .filter(t => t.id && t.score > 0)
    .sort((a, b) => (b.score || 0) - (a.score || 0));

  // Top 15 all-time
  const top15 = withScore.slice(0, 15).map(t => ({
    text: t.text,
    score: t.score,
    likes: t.likes || 0,
    retweets: t.retweets || 0,
    replies: t.replies || 0,
    ts: t.ts,
  }));

  saveTop(top15);

  if (top15.length > 0) {
    console.log('\n🏆 Top 5 all-time:');
    top15.slice(0, 5).forEach((t, i) => {
      console.log(`  ${i + 1}. [score: ${t.score}] ${t.text.substring(0, 70)}...`);
    });
  } else {
    console.log('No scored tweets yet — keep posting, data will accumulate');
  }

  console.log('✅ Analytics complete');
}

if (require.main === module) {
  main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
}
