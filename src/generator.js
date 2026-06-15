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

// Load top performing tweets for style learning
function loadTopTweets() {
  try {
    const raw = fs.readFileSync(path.join(__dirname, '../data/top_tweets.json'), 'utf8');
    return JSON.parse(raw).slice(0, 8); // top 8
  } catch { return []; }
}

function buildDedupContext(recent) {
  if (!recent.length) return '';
  const summaries = recent
    .map(t => t.text.replace(/^"/, '').replace(/"$/, '').substring(0, 80))
    .join('\n- ');
  return `\nAVOID repeating these recent topics/angles:\n- ${summaries}\n\nWrite something COMPLETELY different in topic AND framing.`;
}

function buildStyleContext(topTweets) {
  if (!topTweets.length) return '';
  const examples = topTweets
    .map(t => `[${t.likes}❤ ${t.retweets}RT] ${t.text.substring(0, 100)}`)
    .join('\n');
  return `\nHIGH-PERFORMING TWEETS — study their structure, tone, hook style:\n${examples}\n\nMatch this energy and format. Different topic, same sharpness.`;
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
  text = text.trim();
  // Strip emojis — zero tolerance
  text = text.replace(/\p{Extended_Pictographic}/gu, '').trim();
  // Remove leading/trailing standard and curly quotes (multi-pass for nested)
  for (let i = 0; i < 3; i++) {
    text = text.replace(/^["""''`]+/, '').replace(/["""''`]+$/, '').trim();
  }
  // Strip trailing punctuation+quote combos like ." or ."
  text = text.replace(/([.!?])["""'']+$/, '$1');
  // Clean up double spaces left by emoji removal
  text = text.replace(/  +/g, ' ').trim();

  const roll = Math.random();
  if (roll < 0.15 && text.endsWith('.')) text = text.slice(0, -1);
  else if (roll < 0.25 && text.includes(',')) {
    const idx = text.indexOf(',');
    text = text.slice(0, idx) + text.slice(idx + 1);
  }
  return text;
}

const SV_TOPICS = [
  'Y Combinator: what the public playbook gets wrong vs. what actually works',
  'OpenAI vs Anthropic vs Google — who is actually winning the real AI race',
  'VC culture: what Silicon Valley founders believe that nobody outside SV does',
  'Why most SV startup advice fails if you\'re building from outside the US',
  'Sam Altman / Elon / Zuckerberg — reading the Silicon Valley power moves',
  'The honest case for and against moving to San Francisco as a founder',
  'AI companies raising at insane valuations — what this actually signals',
  'Big tech (Apple / Google / Meta) at an inflection point — what builders should do',
  'The YC Demo Day effect vs. building in silence — which actually compounds',
  'Silicon Valley culture vs. the rest of the world: the gap is widening',
];

function formatTrendContext(trends) {
  return [
    ...trends.hackerNews.slice(0, 5).map(s => `HN (${s.score}pts): ${s.title}`),
    ...trends.rssNews.slice(0, 4).map(n => `${n.source}: ${n.title}`),
  ].join('\n');
}

async function generateTweet(trends, slotNumber) {
  const recent = loadRecentTweets(40);
  const topTweets = loadTopTweets();
  const dedupCtx = buildDedupContext(recent);
  const styleCtx = buildStyleContext(topTweets);
  const ctx = formatTrendContext(trends);
  const isSV = process.env.SV_MODE === 'true';
  const topicPool = isSV ? [...SV_TOPICS, ...config.TOPICS.slice(0, 3)] : config.TOPICS;
  const topicList = topicPool.join('\n- ');

  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      max_tokens: 180,
      temperature: 0.88 + attempt * 0.05,
      messages: [
        { role: 'system', content: SYSTEM },
        {
          role: 'user',
          content: `Today's trending:\n${ctx}\n\nPossible topic areas:\n- ${topicList}\n${styleCtx}${dedupCtx}\n\nSlot #${slotNumber}${isSV ? ' (Silicon Valley focus — speak to SV founders and tech)' : ''}. Pick ONE angle. Write Kerim's take — sharp opinion, not a summary.\nReturn ONLY the raw tweet text. No quotes, no emojis.`,
        },
      ],
    });
    const candidate = addHumanTouch(res.choices[0].message.content.trim());
    if (!isTooSimilar(candidate, recent)) return candidate;
    console.log(`  Attempt ${attempt + 1}: too similar, retrying...`);
  }

  // Fallback: force a different topic
  const forcedTopic = config.TOPICS[Math.floor(Math.random() * config.TOPICS.length)];
  const res = await groq.chat.completions.create({
    model: 'llama-3.3-70b-versatile',
    max_tokens: 180,
    temperature: 0.95,
    messages: [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: `Write a tweet about: ${forcedTopic}\nReturn ONLY the raw tweet text. No quotes.` },
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

  // Pull wolf-type top tweets for style reference
  const topTweets = loadTopTweets().filter(t => t.type === 'wolf');
  const styleCtx = buildStyleContext(topTweets);

  const res = await groq.chat.completions.create({
    model: 'llama-3.3-70b-versatile',
    max_tokens: 140,
    temperature: 0.92,
    messages: [
      { role: 'system', content: WOLF_SYSTEM },
      { role: 'user', content: `${prompt}\n${styleCtx}Max 220 chars. Return ONLY raw tweet text. No quotes.` },
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
