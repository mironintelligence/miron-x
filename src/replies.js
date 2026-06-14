require('dotenv').config();
const { XClient } = require('./xclient');
const { generateMentionReply } = require('./generator');
const fs = require('fs');
const path = require('path');

const LOG_PATH = path.join(__dirname, '../data/engaged.json');
const HANDLE = 'kerimaydemir';

// Küfürlü / spam / anlamsız içerik filtresi
const BLOCK_PATTERNS = [
  /fuck|shit|bitch|asshole|idiot|stupid|dumb|retard|cunt|moron/i,
  /\b(spam|bot|fake|scam|buy now|click here|follow back|f4f)\b/i,
  /(.)\1{5,}/,           // aynı karakter 5+ kez arka arkaya
];

function isBlockedContent(text) {
  return BLOCK_PATTERNS.some(p => p.test(text));
}

function isQualityMention(tweet) {
  if (!tweet.text || tweet.text.length < 20) return false;
  if (isBlockedContent(tweet.text)) return false;
  // Sadece @mention'dan ibaret tweetleri atla
  const withoutMentions = tweet.text.replace(/@\w+/g, '').trim();
  if (withoutMentions.length < 15) return false;
  return true;
}

function loadLog() {
  try { return JSON.parse(fs.readFileSync(LOG_PATH, 'utf8')); }
  catch { return { replies: [], likes: [], follows: [], followDates: [], mentionReplies: [] }; }
}

function saveLog(log) {
  fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true });
  log.mentionReplies = (log.mentionReplies || []).slice(-500);
  fs.writeFileSync(LOG_PATH, JSON.stringify(log, null, 2));
}

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  console.log('▶ replies.js — Mention reply rutini');

  const x = new XClient(process.env.XACTIONS_SESSION_COOKIE);
  const log = loadLog();
  if (!log.mentionReplies) log.mentionReplies = [];

  let replied = 0;
  const mentions = [];

  for await (const m of x.getMentions(HANDLE, 30)) {
    mentions.push(m);
  }

  console.log(`Found ${mentions.length} mentions`);

  // Saate göre sırala — en yeni önce
  mentions.sort((a, b) => new Date(b.timeParsed) - new Date(a.timeParsed));

  for (const mention of mentions) {
    if (replied >= 5) break;
    if (log.mentionReplies.includes(mention.id)) continue;

    const hoursOld = (Date.now() - new Date(mention.timeParsed).getTime()) / 3600000;
    if (hoursOld > 48) continue; // 48 saatten eski yorumları atla

    if (!isQualityMention(mention)) {
      console.log(`  ⏭ @${mention.username}: filtered (low quality or blocked)`);
      continue;
    }

    try {
      const reply = await generateMentionReply(mention.text, mention.username);
      if (!reply) {
        console.log(`  ↩ @${mention.username}: SKIP`);
        log.mentionReplies.push(mention.id);
        continue;
      }

      await x.sendTweet(reply, { replyTo: mention.id });
      log.mentionReplies.push(mention.id);
      replied++;
      console.log(`  ✅ @${mention.username}: ${reply.substring(0, 60)}...`);
      await sleep(8000);
    } catch (e) {
      console.error(`  Reply error @${mention.username}:`, e.message);
    }
  }

  console.log(`✅ ${replied} mention replies sent`);
  saveLog(log);
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
