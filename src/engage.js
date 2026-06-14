require('dotenv').config();
const { generateReply } = require('./generator');
const config = require('./config');
const fs = require('fs');
const path = require('path');

const LOG_PATH = path.join(__dirname, '../data/engaged.json');

function loadLog() {
  try { return JSON.parse(fs.readFileSync(LOG_PATH, 'utf8')); }
  catch { return { replies: [], likes: [], follows: [] }; }
}

function saveLog(log) {
  fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true });
  log.likes = (log.likes || []).slice(-500);
  log.follows = (log.follows || []).slice(-200);
  log.replies = (log.replies || []).slice(-200);
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

  // XACTIONS_SESSION_COOKIE = "auth_token=XXX; ct0=YYY"
  const { Scraper, SearchMode } = await import('xactions');
  const scraper = new Scraper();
  await scraper.setCookies(process.env.XACTIONS_SESSION_COOKIE);

  if (!await scraper.isLoggedIn()) {
    console.error('Auth failed — check XACTIONS_SESSION_COOKIE includes both auth_token and ct0');
    process.exit(1);
  }

  const log = loadLog();

  // ─── LIKE ──────────────────────────────────────────────────────────────
  if (mode === 'all' || mode === 'like') {
    console.log('❤  Like rutini...');
    const kw = config.SEARCH_KEYWORDS[Math.floor(Math.random() * config.SEARCH_KEYWORDS.length)];
    let liked = 0;
    try {
      const tweets = await collectAsync(
        scraper.searchTweets(kw, 25, SearchMode.Latest), 25
      );
      for (const t of tweets) {
        if (liked >= 12) break;
        if (!t.id || done(t.id, 'likes', log)) continue;
        if ((t.likeCount || t.likes || 0) < 5) continue;
        await scraper.likeTweet(t.id);
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
        const tweets = await collectAsync(scraper.getTweets(account, 5), 5);
        await sleep(2000);
        const recent = tweets.find(t => {
          const hoursOld = (Date.now() - new Date(t.timeParsed || t.timestamp).getTime()) / 3600000;
          return hoursOld < 36 && !done(t.id, 'replies', log);
        });
        if (!recent) continue;

        const reply = await generateReply(recent.text || recent.fullText || '', account);
        if (!reply) { console.log(`  ↩ @${account}: SKIP`); continue; }

        await scraper.sendTweet(reply, { replyTo: recent.id });
        log.replies.push(String(recent.id));
        replied++;
        console.log(`  ✅ @${account}: ${reply.substring(0, 55)}...`);
        await sleep(12000);
      } catch (e) {
        console.error(`  Reply @${account} error:`, e.message);
        continue;
      }
    }
    console.log(`  ✅ ${replied} replies`);
  }

  // ─── FOLLOW ────────────────────────────────────────────────────────────
  // Çok seçici: haftada sadece 2-3 hesap, gerçek builder'lar
  if (mode === 'follow') {
    console.log('➕ Follow rutini (seçici mod)...');
    const todayKey = new Date().toISOString().slice(0, 10);
    const todayFollows = (log.followDates || []).filter(d => d === todayKey).length;

    if (todayFollows >= 1) {
      console.log('  ⏭ Bugün zaten follow yapıldı, atlanıyor');
      saveLog(log);
      return;
    }

    let followed = 0;
    try {
      const tweets = await collectAsync(
        scraper.searchTweets('building AI product bootstrapped', 40, SearchMode.Latest), 40
      );
      for (const t of tweets) {
        if (followed >= 1) break; // günde max 1
        if (!t.username || done(t.username, 'follows', log)) continue;
        try {
          const profile = await scraper.getProfile(t.username);
          await sleep(2000);
          const fc = profile.followersCount || 0;
          const bio = (profile.biography || profile.description || '').toLowerCase();
          const hasBio = bio.length > 30;
          const hasRelevantBio = ['build', 'founder', 'ai', 'saas', 'startup', 'maker'].some(kw => bio.includes(kw));

          // Sadece: 2k-25k takipçi + alakalı bio + hesabın tweet'i var
          if (fc >= 2000 && fc <= 25000 && hasBio && hasRelevantBio) {
            await scraper.followUser(t.username);
            log.follows.push(t.username);
            if (!log.followDates) log.followDates = [];
            log.followDates.push(todayKey);
            followed++;
            console.log(`  ✅ @${t.username} (${fc} takipçi)`);
            await sleep(8000);
          }
        } catch { continue; }
      }
    } catch (e) { console.error('Follow error:', e.message); }
    console.log(`  ✅ ${followed} follows`);
  }

  saveLog(log);
  console.log('💾 Log saved');
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
