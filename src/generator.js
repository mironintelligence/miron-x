const Groq = require('groq-sdk');
const config = require('./config');
const fs = require('fs');
const path = require('path');

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const SYSTEM = `You are writing content AS ${config.PERSONA.name}.

BACKGROUND: ${config.PERSONA.background}

VOICE: ${config.PERSONA.voice}

RULES:
${config.TWEET_RULES}`;

const WOLF_SYSTEM = `You are writing content AS ${config.PERSONA.name}.
His X bio says "the wolf". Banner is a wolf among sheep. This is identity, not costume.

RAW VOICE:
Masculine, warrior energy. Not motivational poster, not hustle bro.
The words of a man who's been through real fire. Quiet strength, not loud noise.
Embracing chaos. Enduring pain without complaint. Moving alone. Staying dangerous.
Short sharp sentences. Hits like a fist.
Never preachy. Never "you should". Speaks from lived truth.
NO quotes around the text. Return raw text only.
English only. Max 220 chars. No hashtags.

THEMES:
- The wolf doesn't explain himself to the flock
- Chaos is the arena, not the threat
- Pain as a teacher
- Solitude and focus as weapons
- Building in silence, results do the talking
- Men who endure vs men who fold

GOOD:
Most people run from chaos. I learned to move inside it. That's where the real game is played.
Pain doesn't stop you. The story you tell about pain stops you.
Every hard thing you didn't quit made you something. Most people never find out what.

BAD (never):
Rise and grind 💪 #Motivation
Be a wolf not a sheep 🐺🔥🔥🔥`;

// Load recent tweets for dedup
function loadRecentTweets(n = 40) {
  try {
    const raw = fs.readFileSync(path.join(__dirname, '../data/posted.json'), 'utf8');
    return JSON.parse(raw).slice(-n);
  } catch { return []; }
}

function buildDedupContext(recent) {
  if (!recent.length) return '';
  const summaries = recent
    .map(t => t.text.replace(/^"/, '').replace(/"$/, '').substring(0, 80))
    .join('\n- ');
  return `\nAVOID repeating these recent topics/angles:\n- ${summaries}\n\nWrite something COMPLETELY different in topic AND framing.`;
}

// Simple keyword similarity check
function isTooSimilar(newTweet, recent) {
  const newWords = new Set(newTweet.toLowerCase().split(/\s+/).filter(w => w.length > 4));
  for (const t of recent) {
    const oldWords = new Set(t.text.toLowerCase().split(/\s+/).filter(w => w.length > 4));
    const overlap = [...newWords].filter(w => oldWords.has(w)).length;
    const similarity = overlap / Math.max(newWords.size, 1);
    if (similarity > 0.45) return true;
  }
  return false;
}

function addHumanTouch(text) {
  // Aggressively strip all quote wrapping the AI loves to add
  text = text.trim();
  // Remove leading/trailing standard and curly quotes (multi-pass for nested)
  for (let i = 0; i < 3; i++) {
    text = text.replace(/^["""''`]+/, '').replace(/["""''`]+$/, '').trim();
  }
  // Strip trailing punctuation+quote combos like ." or ."
  text = text.replace(/([.!?])["""'']+$/, '$1');

  const roll = Math.random();
  if (roll < 0.15 && text.endsWith('.')) text = text.slice(0, -1);
  else if (roll < 0.25 && text.includes(',')) {
    const idx = text.indexOf(',');
    text = text.slice(0, idx) + text.slice(idx + 1);
  }
  return text;
}

function formatTrendContext(trends) {
  return [
    ...trends.hackerNews.slice(0, 5).map(s => `HN (${s.score}pts): ${s.title}`),
    ...trends.rssNews.slice(0, 4).map(n => `${n.source}: ${n.title}`),
  ].join('\n');
}

async function generateTweet(trends, slotNumber) {
  const recent = loadRecentTweets(40);
  const dedupCtx = buildDedupContext(recent);
  const ctx = formatTrendContext(trends);
  const topicList = config.TOPICS.join('\n- ');

  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      max_tokens: 180,
      temperature: 0.88 + attempt * 0.05,
      messages: [
        { role: 'system', content: SYSTEM },
        {
          role: 'user',
          content: `Today's trending:\n${ctx}\n\nPossible topic areas:\n- ${topicList}\n${dedupCtx}\n\nSlot #${slotNumber} of 6. Pick ONE angle. Write Kerim's take — not a summary, his opinion.\nReturn ONLY the raw tweet text. No quotes around it.`,
        },
      ],
    });
    const candidate = addHumanTouch(res.choices[0].message.content.trim());
    if (!isTooSimilar(candidate, recent)) return candidate;
    console.log(`  Attempt ${attempt + 1}: too similar, retrying...`);
  }

  // Fallback: force a different angle
  const forcedTopic = config.TOPICS[Math.floor(Math.random() * config.TOPICS.length)];
  const res = await groq.chat.completions.create({
    model: 'llama-3.3-70b-versatile',
    max_tokens: 180,
    temperature: 0.95,
    messages: [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: `Write a tweet specifically about: ${forcedTopic}\nReturn ONLY the raw tweet text.` },
    ],
  });
  return addHumanTouch(res.choices[0].message.content.trim());
}

async function generateWolfTweet() {
  const prompts = [
    'Raw tweet: embracing chaos as the arena, not the threat. Warrior energy.',
    'Raw tweet: enduring pain without complaint. The wolf keeps moving.',
    'Raw tweet: operating alone — not needing the flock\'s approval.',
    'Raw tweet: men who sharpen under pressure vs men who fold under it.',
    'Raw tweet: doing the work in the dark, no audience, just the grind.',
    'Raw tweet: staying dangerous when life tries to domesticate you.',
    'Raw tweet: the discipline of silence — building while others talk.',
    'Raw tweet: what chaos actually feels like from the inside of it.',
  ];
  const prompt = prompts[Math.floor(Math.random() * prompts.length)];
  const res = await groq.chat.completions.create({
    model: 'llama-3.3-70b-versatile',
    max_tokens: 140,
    temperature: 0.92,
    messages: [
      { role: 'system', content: WOLF_SYSTEM },
      { role: 'user', content: `${prompt}\nMax 220 chars. Return ONLY raw tweet text. No quotes.` },
    ],
  });
  return addHumanTouch(res.choices[0].message.content.trim());
}

async function generateThread(trends) {
  const recent = loadRecentTweets(20);
  const dedupCtx = buildDedupContext(recent);
  const ctx = formatTrendContext(trends);
  const res = await groq.chat.completions.create({
    model: 'llama-3.3-70b-versatile',
    max_tokens: 1400,
    temperature: 0.82,
    messages: [
      { role: 'system', content: SYSTEM },
      {
        role: 'user',
        content: `Today's trending:\n${ctx}\n${dedupCtx}\n\nWrite a 5-tweet morning thread.\n\n- Tweet 1: Hook. Strong claim. Standalone.\n- Tweets 2-4: One concrete point each. Specific.\n- Tweet 5: The payoff. Drives replies.\n- Number: "1/" ... "5/"\n- Each max 265 chars\n- No quotes around the tweets\n- English only\n\nReturn ONLY a JSON array: ["tweet1","tweet2","tweet3","tweet4","tweet5"]`,
      },
    ],
  });
  const text = res.choices[0].message.content.trim();
  try {
    const match = text.match(/\[[\s\S]*\]/);
    const tweets = match ? JSON.parse(match[0]) : [];
    return tweets.map(t => addHumanTouch(t));
  } catch {
    return text
      .split('\n')
      .filter(l => /^\d+\//.test(l.trim()) || l.includes('/'))
      .map(l => addHumanTouch(l.replace(/^["'\d./\s]+/, '').replace(/[",]+$/, '').trim()))
      .filter(l => l.length > 10)
      .slice(0, 5);
  }
}

async function generateReply(tweetText, targetAccount) {
  const res = await groq.chat.completions.create({
    model: 'llama-3.3-70b-versatile',
    max_tokens: 100,
    temperature: 0.92,
    messages: [
      { role: 'system', content: SYSTEM },
      {
        role: 'user',
        content: `@${targetAccount} tweeted:\n"${tweetText}"\n\nWrite a SHORT reply (max 110 chars):\n- Genuine angle or pushback\n- NOT "Great point!" or praise\n- Real builder experience\n- Sparks conversation\n- English only\n\nIf nothing good to say, return: SKIP\nReturn ONLY raw reply text or SKIP.`,
      },
    ],
  });
  const text = addHumanTouch(res.choices[0].message.content.trim());
  return text === 'SKIP' ? null : text;
}

async function generateMentionReply(mentionText, fromUsername) {
  const res = await groq.chat.completions.create({
    model: 'llama-3.3-70b-versatile',
    max_tokens: 120,
    temperature: 0.88,
    messages: [
      { role: 'system', content: SYSTEM },
      {
        role: 'user',
        content: `@${fromUsername} replied to Kerim:\n"${mentionText}"\n\nWrite a SHORT genuine reply (max 120 chars):\n- Engage authentically\n- Build on their point or pushback with specifics\n- If question, answer directly\n- No hollow thanks or ass-kissing\n- English only\n\nIf the comment adds no value, return: SKIP\nReturn ONLY raw reply text or SKIP.`,
      },
    ],
  });
  const text = addHumanTouch(res.choices[0].message.content.trim());
  return text === 'SKIP' ? null : text;
}

async function generateRepostComment(tweetText, authorHandle) {
  const res = await groq.chat.completions.create({
    model: 'llama-3.3-70b-versatile',
    max_tokens: 100,
    temperature: 0.9,
    messages: [
      { role: 'system', content: SYSTEM },
      {
        role: 'user',
        content: `@${authorHandle} tweeted:\n"${tweetText}"\n\nKerim wants to quote-tweet this with his own sharp take.\nWrite max 100 chars — his angle on this, adds to the conversation.\nNot a summary. His actual view.\nReturn ONLY the raw text. No quotes around it.`,
      },
    ],
  });
  return addHumanTouch(res.choices[0].message.content.trim());
}

module.exports = {
  generateTweet,
  generateWolfTweet,
  generateThread,
  generateReply,
  generateMentionReply,
  generateRepostComment,
};
