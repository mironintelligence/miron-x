require('dotenv').config();
const { generateReply } = require('./generator');
const { XClient } = require('./xclient');
const { logError } = require('./logger');
const config = require('./config');
const fs = require('fs');
const path = require('path');

const LOG_PATH = path.join(__dirname, '../data/engaged.json');

const MAX_LIKES   = parseInt(process.env.MAX_LIKES_PER_SESSION   || '12');
const MAX_REPLIES = parseInt(process.env.MAX_REPLIES_PER_SESSION || '3');
const MAX_FOLLOWS = parseInt(process.env.MAX_FOLLOWS_PER_DAY     || '1');

function loadLog() {
  try { return JSON.parse(fs.readFileSync(LOG_PATH, 'utf8')); }
  catch { return { replies: [], likes: [], follows: [], followDates: [] }; }
}

function saveLog(log) {
  fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true });
  log.likes      = (log.likes      || []).slice(-500);
  log.follows    = (log.follows    || []).slice(-200);
  log.replies    = (log.replies    || []).slice(-200);
  log.followDates= (log.followDates|| []).slice(-100);
  fs.writeFileSync(LOG_PATH, JSON.stringify(log, null, 2));
}

function done(id, type, log) { return (log[type] || []).includes(String(id)); }

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
  const mode = process.env.ENGAGE_MODE || 'all';
  console.log(`▶ engage.js — Mode: ${mode} | limits: ${MAX_LIKES} likes / ${MAX_REPLIES} replies / ${MAX_FOLLOWS} follows`);

  const x = new XClient(process.env.XACTIONS_SESSION_COOKIE);
  const log = loadLog();

  // ─── LIKE ─────────────────────────────────────────────────────────────────
  if (mode === 'all' || mode === 'like') {
    console.log('Like rutini...');
    const kw = config.SEARCH_KEYWORDS[Math.floor(Math.random() * config.SEARCH_KEYWORDS.length)];
    console.log(`  Keyword: "${kw}"`);
    let liked = 0;
    try {
      const tweets = await collectAsync(x.searchTweets(kw, 30), 30);
      if (tweets.length === 0) {
        console.log('  Search returned 0 results (v1.1 restricted) — skipping likes');
      }
      for (const t of tweets) {
        if (liked >= MAX_LIKES) break;
        if (!t.id || done(t.id, 'likes', log)) continue;
        if ((t.likeCount || 0) < 3) continue;
        try {
          await x.likeTweet(t.id);
          log.likes.push(String(t.id));
          liked++;
          await sleep(2800);
        } catch (e) {
          if (e.message?.includes('already favorited')) {
            log.likes.push(String(t.id));
            liked++;
          } else {
            logError('engage.js', e, { phase: 'like', tweetId: t.id, keyword: kw });
          }
        }
      }
    } catch (e) {
      logError('engage.js', e, { phase: 'search_for_likes', keyword: kw });
    }
    console.log(`  ✅ ${liked} likes`);
  }

  // ─── REPLY ────────────────────────────────────────────────────────────────
  if (mode === 'all' || mode === 'reply') {
    console.log('Reply rutini...');
    const targets = [...config.TARGET_ACCOUNTS].sort(() => Math.random() - 0.5).slice(0, 6);
    let replied = 0;

    for (const account of targets) {
      if (replied >= MAX_REPLIES) break;
      try {
        const tweets = await collectAsync(x.getTweets(account, 5), 5);
        await sleep(1500);
        const recent = tweets.find(t => {
          const hoursOld = (Date.now() - new Date(t.timeParsed).getTime()) / 3600000;
          return hoursOld < 36 && !done(t.id, 'replies', log);
        });
        if (!recent) { console.log(`  ↩ @${account}: no recent tweet`); continue; }

        const reply = await generateReply(recent.text || '', account);
        if (!reply) { console.log(`  ↩ @${account}: SKIP`); log.replies.push(String(recent.id)); continue; }

        await x.sendTweet(reply, { replyTo: recent.id });
        log.replies.push(String(recent.id));
        replied++;
        console.log(`  ✅ @${account}: ${reply.substring(0, 60)}`);
        await sleep(10000);
      } catch (e) {
        if (e.userUnavailable) {
          console.log(`  ↩ @${account}: account unavailable — skipping`);
        } else if (e.message?.includes('Tweet not posted')) {
          // Silent Twitter filter — mark as attempted, don't spam errors.json
          console.log(`  ↩ @${account}: tweet silently blocked (rate-limit/filter)`);
        } else {
          logError('engage.js', e, { phase: 'reply', account });
        }
        // Always sleep after any failure to avoid hammering when rate-limited
        await sleep(5000);
      }
    }
    console.log(`  ✅ ${replied} replies`);
  }

  // ─── FOLLOW — sadece elle tetiklenince ────────────────────────────────────
  if (mode === 'follow') {
    console.log('Follow rutini (seçici mod)...');
    const todayKey = new Date().toISOString().slice(0, 10);
    const todayFollows = (log.followDates || []).filter(d => d === todayKey).length;

    if (todayFollows >= MAX_FOLLOWS) {
      console.log(`  Bugün zaten ${todayFollows} follow yapıldı (limit: ${MAX_FOLLOWS})`);
    } else {
      let followed = 0;
      try {
        const tweets = await collectAsync(x.searchTweets('building AI product bootstrapped', 40), 40);
        if (tweets.length === 0) {
          console.log('  Search returned 0 results (v1.1 restricted) — skipping follow');
        }
        for (const t of tweets) {
          if (followed >= MAX_FOLLOWS) break;
          if (!t.username || done(t.username, 'follows', log)) continue;
          try {
            const profile = await x.getProfile(t.username);
            await sleep(1500);
            const fc  = profile.followersCount || 0;
            const bio = (profile.biography || '').toLowerCase();
            const relevant = ['build', 'founder', 'ai', 'saas', 'startup', 'maker'].some(k => bio.includes(k));
            if (fc >= 2000 && fc <= 30000 && bio.length > 30 && relevant) {
              await x.followUser(t.username);
              log.follows.push(t.username);
              log.followDates.push(todayKey);
              followed++;
              console.log(`  ✅ @${t.username} (${fc} followers)`);
              await sleep(8000);
            }
          } catch (e) {
            logError('engage.js', e, { phase: 'follow_check', username: t.username });
          }
        }
      } catch (e) {
        logError('engage.js', e, { phase: 'follow_search' });
      }
      console.log(`  ✅ ${followed} follows`);
    }
  }

  saveLog(log);
  console.log('✅ Engage complete');
}

if (require.main === module) {
  main().catch(e => {
    logError('engage.js', e, { phase: 'uncaught', mode: process.env.ENGAGE_MODE });
    process.exit(1);
  });
}
