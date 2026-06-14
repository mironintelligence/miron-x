require('dotenv').config();
const { generateReply } = require('./generator');
const { XClient } = require('./xclient');
const config = require('./config');
const fs = require('fs');
const path = require('path');

const LOG_PATH = path.join(__dirname, '../data/engaged.json');

function loadLog() {
  try { return JSON.parse(fs.readFileSync(LOG_PATH, 'utf8')); }
  catch { return { replies: [], likes: [], follows: [], followDates: [] }; }
}

function saveLog(log) {
  fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true });
  log.likes = (log.likes || []).slice(-500);
  log.follows = (log.follows || []).slice(-200);
  log.replies = (log.replies || []).slice(-200);
  log.followDates = (log.followDates || []).slice(-100);
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
  console.log(`▶ engage.js — Mode: ${mode}`);

  const x = new XClient(process.env.XACTIONS_SESSION_COOKIE);
  const log = loadLog();

  // ─── LIKE ──────────────────────────────────────────────────────────────
  if (mode === 'all' || mode === 'like') {
    console.log('❤  Like rutini...');
    const kw = config.SEARCH_KEYWORDS[Math.floor(Math.random() * config.SEARCH_KEYWORDS.length)];
    let liked = 0;
    try {
      const tweets = await collectAsync(x.searchTweets(kw, 25), 25);
      for (const t of tweets) {
        if (liked >= 12) break;
        if (!t.id || done(t.id, 'likes', log)) continue;
        if ((t.likeCount || 0) < 5) continue;
        await x.likeTweet(t.id);
        log.likes.push(String(t.id));
        liked++;
        await sleep(2800);
      }
    } catch (e) { console.error('Like error:', e.message); }
    console.log(`  ✅ ${liked} likes`);
  }

  // ─── REPLY ─────────────────────────────────────────────────────────────
  if (mode === 'all' || mode === 'reply') {
    console.log('💬 Reply rutini...');
    const targets = [...config.TARGET_ACCOUNTS]
      .sort(() => Math.random() - 0.5)
      .slice(0, 5);
    let replied = 0;

    for (const account of targets) {
      if (replied >= 3) break;
      try {
        const tweets = await collectAsync(x.getTweets(account, 5), 5);
        await sleep(2000);
        const recent = tweets.find(t => {
          const hoursOld = (Date.now() - new Date(t.timeParsed).getTime()) / 3600000;
          return hoursOld < 36 && !done(t.id, 'replies', log);
        });
        if (!recent) continue;

        const reply = await generateReply(recent.text || '', account);
        if (!reply) { console.log(`  ↩ @${account}: SKIP`); continue; }

        await x.sendTweet(reply, { replyTo: recent.id });
        log.replies.push(String(recent.id));
        replied++;
        console.log(`  ✅ @${account}: ${reply.substring(0, 55)}...`);
        await sleep(12000);
      } catch (e) {
        console.error(`  Reply @${account} error:`, e.message);
      }
    }
    console.log(`  ✅ ${replied} replies`);
  }

  // ─── FOLLOW — çok seçici, sadece elle tetiklenince ──────────────────────
  if (mode === 'follow') {
    console.log('➕ Follow rutini (seçici mod)...');
    const todayKey = new Date().toISOString().slice(0, 10);
    const todayFollows = (log.followDates || []).filter(d => d === todayKey).length;

    if (todayFollows >= 1) {
      console.log('  ⏭ Bugün zaten follow yapıldı, atlanıyor');
    } else {
      let followed = 0;
      try {
        const tweets = await collectAsync(x.searchTweets('building AI product bootstrapped', 40), 40);
        for (const t of tweets) {
          if (followed >= 1) break;
          if (!t.username || done(t.username, 'follows', log)) continue;
          try {
            const profile = await x.getProfile(t.username);
            await sleep(2000);
            const fc = profile.followersCount || 0;
            const bio = (profile.biography || '').toLowerCase();
            const relevant = ['build', 'founder', 'ai', 'saas', 'startup', 'maker'].some(kw => bio.includes(kw));
            if (fc >= 2000 && fc <= 25000 && bio.length > 30 && relevant) {
              await x.followUser(t.username);
              log.follows.push(t.username);
              log.followDates.push(todayKey);
              followed++;
              console.log(`  ✅ @${t.username} (${fc} followers)`);
              await sleep(8000);
            }
          } catch { continue; }
        }
      } catch (e) { console.error('Follow error:', e.message); }
      console.log(`  ✅ ${followed} follows`);
    }
  }

  saveLog(log);
  console.log('💾 Log saved');
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
