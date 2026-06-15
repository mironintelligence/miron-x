// Self-improving analytics loop
// 1. Scans own live timeline for fresh engagement stats (fast, no per-tweet API calls)
// 2. Falls back to GraphQL getTweetById for older tweets not in live timeline
// 3. Saves top performers all-time + per-type (wolf/sv/london/general/thread)
// 4. Per-type data feeds the generator's style learning

require('dotenv').config();
const { XClient } = require('./xclient');
const { logError } = require('./logger');
const fs = require('fs');
const path = require('path');

const POSTED_PATH   = path.join(__dirname, '../data/posted.json');
const TOP_PATH      = path.join(__dirname, '../data/top_tweets.json');
const TOP_TYPE_PATH = path.join(__dirname, '../data/top_tweets_by_type.json');
const HANDLE        = process.env.TWITTER_HANDLE || 'kerimaydemirco';
const TOP_N         = parseInt(process.env.ANALYTICS_TOP_N || '15');
const TYPES         = ['general', 'sv', 'london', 'wolf', 'thread'];

function loadPosted() {
  try { return JSON.parse(fs.readFileSync(POSTED_PATH, 'utf8')); }
  catch { return []; }
}
function savePosted(data) {
  fs.writeFileSync(POSTED_PATH, JSON.stringify(data, null, 2));
}
function saveJSON(p, data) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(data, null, 2));
}
function score(t) {
  return (t.likes || 0) * 3 + (t.retweets || 0) * 5 + (t.replies || 0) * 2;
}
async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  console.log('▶ analytics.js — Engagement tracking + self-improvement data');
  const x = new XClient(process.env.XACTIONS_SESSION_COOKIE);
  const posted = loadPosted();

  // ── Step 1: Scan own live UserTweets — gets fresh stats for latest 20 ────
  const liveMap = new Map();
  try {
    console.log(`Scanning @${HANDLE} live timeline...`);
    for await (const t of x.getTweets(HANDLE, 20)) {
      liveMap.set(t.id, {
        likes:    t.likeCount    || 0,
        retweets: t.retweetCount || 0,
        replies:  t.replyCount   || 0,
      });
    }
    console.log(`  Live: ${liveMap.size} tweets`);
  } catch (e) {
    logError('analytics.js', e, { phase: 'own_timeline_scan' });
  }

  let fromTimeline = 0;
  for (const tweet of posted) {
    if (!tweet.id) continue;
    const live = liveMap.get(tweet.id);
    if (!live) continue;
    tweet.likes    = live.likes;
    tweet.retweets = live.retweets;
    tweet.replies  = live.replies;
    tweet.score    = score(tweet);
    tweet.lastChecked = new Date().toISOString();
    fromTimeline++;
  }
  console.log(`  Updated ${fromTimeline} tweets from live timeline`);

  // ── Step 2: Older tweets — check via GraphQL (once per 24h) ──────────────
  const needsCheck = posted.filter(t =>
    t.id &&
    !liveMap.has(t.id) &&
    (!t.lastChecked || Date.now() - new Date(t.lastChecked).getTime() > 24 * 3600000)
  );
  console.log(`Checking ${needsCheck.length} older tweets via API...`);

  let fromApi = 0;
  for (const tweet of needsCheck) {
    try {
      const data = await x.getTweetById(tweet.id);
      if (data) {
        tweet.likes    = data.likes    || 0;
        tweet.retweets = data.retweets || 0;
        tweet.replies  = data.replies  || 0;
        tweet.score    = score(tweet);
        fromApi++;
      }
      tweet.lastChecked = new Date().toISOString();
      await sleep(1000);
    } catch (e) {
      logError('analytics.js', e, { phase: 'fetch_old_tweet', tweetId: tweet.id });
      tweet.lastChecked = new Date().toISOString();
    }
  }
  console.log(`  Updated ${fromApi} older tweets via API`);

  savePosted(posted);

  // ── Step 3: Build top performers list (all-time) ──────────────────────────
  const withScore = posted
    .filter(t => t.id && (t.score || 0) > 0)
    .sort((a, b) => (b.score || 0) - (a.score || 0));

  const topAll = withScore.slice(0, TOP_N).map(t => ({
    text:     t.text,
    type:     t.type || 'general',
    score:    t.score    || 0,
    likes:    t.likes    || 0,
    retweets: t.retweets || 0,
    replies:  t.replies  || 0,
    ts:       t.ts,
  }));
  saveJSON(TOP_PATH, topAll);

  // ── Step 4: Top performers per type (feeds generator style learning) ──────
  const topByType = {};
  for (const type of TYPES) {
    topByType[type] = withScore
      .filter(t => (t.type || 'general') === type)
      .slice(0, 8)
      .map(t => ({
        text:     t.text,
        score:    t.score    || 0,
        likes:    t.likes    || 0,
        retweets: t.retweets || 0,
        ts:       t.ts,
      }));
  }
  saveJSON(TOP_TYPE_PATH, topByType);

  // ── Summary ───────────────────────────────────────────────────────────────
  if (topAll.length > 0) {
    console.log('\nTop 5 all-time:');
    topAll.slice(0, 5).forEach((t, i) =>
      console.log(`  ${i + 1}. [${t.type}] score:${t.score} ${t.likes}L/${t.retweets}RT — "${t.text.substring(0, 60)}"`)
    );
  } else {
    console.log('\nNo scored tweets yet — keep posting, data will accumulate');
  }

  console.log('\nType breakdown:');
  for (const type of TYPES) {
    const ofType  = posted.filter(t => (t.type || 'general') === type && t.id);
    const scored  = ofType.filter(t => (t.score || 0) > 0);
    const avgS    = scored.length
      ? (scored.reduce((s, t) => s + (t.score || 0), 0) / scored.length).toFixed(1)
      : '—';
    console.log(`  ${type.padEnd(8)}: ${ofType.length} tweets | ${scored.length} with engagement | avg score: ${avgS}`);
  }

  console.log('\n✅ Analytics complete');
}

if (require.main === module) {
  main().catch(e => {
    logError('analytics.js', e, { phase: 'uncaught' });
    process.exit(1);
  });
}
