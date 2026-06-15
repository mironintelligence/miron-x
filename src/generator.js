const Groq = require('groq-sdk');
const config = require('./config');
const fs = require('fs');
const path = require('path');

const MODEL = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';
const groq  = new Groq({ apiKey: process.env.GROQ_API_KEY });

// Data file paths
const POSTED_PATH   = path.join(__dirname, '../data/posted.json');
const TOP_PATH      = path.join(__dirname, '../data/top_tweets.json');
const TOP_TYPE_PATH = path.join(__dirname, '../data/top_tweets_by_type.json');
const BRAIN_PATH    = path.join(__dirname, '../data/brain_report.json');
const DYN_CFG_PATH  = path.join(__dirname, '../data/dynamic_config.json');

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

// ── Data loaders ─────────────────────────────────────────────────────────────
function loadJSON(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); }
  catch { return fallback; }
}
function loadRecentTweets(n = 40) {
  return loadJSON(POSTED_PATH, []).slice(-n);
}
function loadTopTweets() {
  return loadJSON(TOP_PATH, []).slice(0, 8);
}
function loadTopTweetsByType(type) {
  const byType = loadJSON(TOP_TYPE_PATH, {});
  return (byType[type] || []).slice(0, 6);
}
function loadBrainReport() {
  return loadJSON(BRAIN_PATH, null);
}
function loadDynamicConfig() {
  return loadJSON(DYN_CFG_PATH, null);
}

// ── Context builders ──────────────────────────────────────────────────────────
function buildDedupContext(recent) {
  if (!recent.length) return '';
  const summaries = recent
    .map(t => t.text.replace(/^"/, '').replace(/"$/, '').substring(0, 80))
    .join('\n- ');
  return `\nAVOID repeating these recent topics/angles:\n- ${summaries}\n\nWrite something COMPLETELY different in topic AND framing.`;
}

function buildStyleContext(tweets) {
  if (!tweets.length) return '';
  const examples = tweets
    .map(t => `[${t.score || t.likes || 0}pts] ${t.text.substring(0, 100)}`)
    .join('\n');
  return `\nHIGH-PERFORMING TWEETS — study their structure, tone, hook style:\n${examples}\n\nMatch this energy. Different topic, same sharpness.`;
}

function buildStyleContextForType(type) {
  const typeTweets = loadTopTweetsByType(type);
  if (typeTweets.length >= 2) {
    const examples = typeTweets
      .map(t => `[${t.score}pts] ${t.text.substring(0, 100)}`)
      .join('\n');
    return `\nTOP ${type.toUpperCase()} TWEETS — match this exact energy:\n${examples}\n\nDifferent topic, same punch.`;
  }
  return buildStyleContext(loadTopTweets());
}

// ── Similarity check ─────────────────────────────────────────────────────────
function isTooSimilar(newTweet, recent) {
  const newWords = new Set(newTweet.toLowerCase().split(/\s+/).filter(w => w.length > 4));
  for (const t of recent) {
    const oldWords = new Set(t.text.toLowerCase().split(/\s+/).filter(w => w.length > 4));
    const overlap = [...newWords].filter(w => oldWords.has(w)).length;
    if (overlap / Math.max(newWords.size, 1) > 0.45) return true;
  }
  return false;
}

// ── Human touch ──────────────────────────────────────────────────────────────
function addHumanTouch(text) {
  text = text.trim();
  text = text.replace(/\p{Extended_Pictographic}/gu, '').trim();
  for (let i = 0; i < 3; i++) {
    text = text.replace(/^["""''`]+/, '').replace(/["""''`]+$/, '').trim();
  }
  text = text.replace(/([.!?])["""'']+$/, '$1');
  text = text.replace(/  +/g, ' ').trim();
  const roll = Math.random();
  if (roll < 0.15 && text.endsWith('.')) text = text.slice(0, -1);
  else if (roll < 0.25 && text.includes(',')) {
    const idx = text.indexOf(',');
    text = text.slice(0, idx) + text.slice(idx + 1);
  }
  return text;
}

// ── Format trend context ──────────────────────────────────────────────────────
function formatTrendContext(trends) {
  return [
    ...trends.hackerNews.slice(0, 5).map(s => `HN (${s.score}pts): ${s.title}`),
    ...trends.rssNews.slice(0, 4).map(n => `${n.source}: ${n.title}`),
  ].join('\n');
}

// ── Topic pools ───────────────────────────────────────────────────────────────
const SV_TOPICS = [
  'Y Combinator: what the public playbook gets wrong vs. what actually works',
  'OpenAI vs Anthropic vs Google — who is actually winning the real AI race',
  'Sam Altman / Elon / Zuckerberg — reading the Silicon Valley power moves',
  'AI companies raising at insane valuations — what this actually signals',
  'The early SV founder nobody writes about: pre-revenue, post-savings, still building',
  'What YC rejections have in common — and what the accepted ones missed',
  'Distribution is the thing most SV early-stage founders underestimate until month 8',
  'The gap between YC advice and what the first 6 months of building actually looks like',
  "Bootstrapped in SF: the founder who doesn't raise and why that's harder than it sounds",
  'Cold outreach in SV: what works, what burns bridges, what founders get wrong',
  'Build in public with 40 followers — what it actually takes vs. the myth',
  'Pre-seed to seed: the jump that breaks most first-time SV founders',
];

const LONDON_TOPICS = [
  'London startup scene vs. Silicon Valley — why the comparison is both wrong and right',
  'Wise, Monzo, Revolut: what the London fintech playbook actually looks like',
  "UK AI scene right now — who's doing real work vs. riding the hype",
  "Building in London: the advantages nobody in SV talks about (talent, timezone, regulation)",
  "UK pre-seed landscape — what's actually fundable right now vs. 2 years ago",
  'The London indie founder: smaller market, sharper product, longer game',
  "UK founders raising from US VCs — the things they don't tell you going in",
  'European founder mindset vs. US: different constraints, different strengths',
  "What bootstrapping looks like in London when you can't afford to move to SF",
  'The honest struggles of early-stage UK startups: distribution, sales, finding customers',
  "London's quiet builder community — the people shipping real products without the noise",
  'UK founder communities worth being part of — and what they actually do for you',
];

// ── Length hint from brain/dynamic config ─────────────────────────────────────
function getLengthHint(dynCfg) {
  if (!dynCfg?.optimalLengthRange) return 'Max 270 chars.';
  const [lo, hi] = dynCfg.optimalLengthRange;
  return `Target length: ${lo}–${hi} chars (data shows this range performs best).`;
}

// ── generateTweet — brain-aware ───────────────────────────────────────────────
async function generateTweet(trends, slotNumber) {
  const recent   = loadRecentTweets(40);
  const brain    = loadBrainReport();
  const dynCfg   = loadDynamicConfig();
  const dedupCtx = buildDedupContext(recent);
  const ctx      = formatTrendContext(trends);

  const isSV     = process.env.SV_MODE     === 'true';
  const isLondon = process.env.LONDON_MODE === 'true';
  const type     = isLondon ? 'london' : isSV ? 'sv' : 'general';

  // Per-type style examples (learns from own top performers)
  const styleCtx = buildStyleContextForType(type);

  // Adjust temperature based on how well this type is performing
  const mult     = brain?.typeMultipliers?.[type] || 1.0;
  const baseTemp = mult > 1.3 ? 0.82 : mult < 0.7 ? 0.95 : 0.88;

  // Length guidance from brain
  const lengthHint = getLengthHint(dynCfg);

  // Topic pool
  const topicPool = isLondon
    ? [...LONDON_TOPICS, ...config.TOPICS.slice(0, 2)]
    : isSV
    ? [...SV_TOPICS, ...config.TOPICS.slice(0, 2)]
    : config.TOPICS;
  const topicList = topicPool.join('\n- ');

  // High-performing keyword signal from brain
  const kwHint = dynCfg?.topKeywords?.length
    ? `\nHigh-engagement keywords (weave in if natural): ${dynCfg.topKeywords.join(', ')}`
    : '';

  const focus = isSV
    ? ' (Silicon Valley focus — speak TO SV founders, pre-seed builders, indie hackers)'
    : isLondon
    ? ' (London focus — speak TO UK/London startup founders, early-stage builders)'
    : '';

  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await groq.chat.completions.create({
      model:      MODEL,
      max_tokens: 180,
      temperature: baseTemp + attempt * 0.04,
      messages: [
        { role: 'system', content: SYSTEM },
        {
          role: 'user',
          content: `Today's trending:\n${ctx}\n\nPossible topic areas:\n- ${topicList}\n${styleCtx}${kwHint}${dedupCtx}\n\nSlot #${slotNumber}${focus}. Pick ONE angle. Write Kerim's take — sharp opinion, not a summary. Speak TO founders, not about them.\n${lengthHint}\nReturn ONLY the raw tweet text. No quotes, no emojis.`,
        },
      ],
    });
    const candidate = addHumanTouch(res.choices[0].message.content.trim());
    if (!isTooSimilar(candidate, recent)) return candidate;
    console.log(`  Attempt ${attempt + 1}: too similar, retrying...`);
  }

  // Fallback
  const forcedTopic = config.TOPICS[Math.floor(Math.random() * config.TOPICS.length)];
  const res = await groq.chat.completions.create({
    model:      MODEL,
    max_tokens: 180,
    temperature: 0.95,
    messages: [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: `Write a tweet about: ${forcedTopic}\nReturn ONLY the raw tweet text. No quotes.` },
    ],
  });
  return addHumanTouch(res.choices[0].message.content.trim());
}

// ── generateWolfTweet — uses wolf-type top performers ────────────────────────
async function generateWolfTweet() {
  const prompts = [
    'Raw tweet: embracing chaos as the arena, not the threat. Warrior energy.',
    "Raw tweet: enduring pain without complaint. The wolf keeps moving.",
    "Raw tweet: operating alone — not needing the flock's approval.",
    'Raw tweet: men who sharpen under pressure vs men who fold under it.',
    'Raw tweet: doing the work in the dark, no audience, just the grind.',
    'Raw tweet: staying dangerous when life tries to domesticate you.',
    'Raw tweet: the discipline of silence — building while others talk.',
    'Raw tweet: what chaos actually feels like from the inside of it.',
  ];
  const prompt = prompts[Math.floor(Math.random() * prompts.length)];

  // Use wolf-specific top performers for style — falls back to generic if none yet
  const styleCtx = buildStyleContextForType('wolf');
  const dynCfg   = loadDynamicConfig();
  const lengthHint = dynCfg?.optimalLengthRange
    ? `Target: ${dynCfg.optimalLengthRange[0]}–${Math.min(dynCfg.optimalLengthRange[1], 220)} chars.`
    : 'Max 220 chars.';

  const res = await groq.chat.completions.create({
    model:      MODEL,
    max_tokens: 140,
    temperature: 0.92,
    messages: [
      { role: 'system', content: WOLF_SYSTEM },
      { role: 'user', content: `${prompt}\n${styleCtx}\n${lengthHint} Return ONLY raw tweet text. No quotes.` },
    ],
  });
  return addHumanTouch(res.choices[0].message.content.trim());
}

// ── generateThread ────────────────────────────────────────────────────────────
async function generateThread(trends) {
  const recent   = loadRecentTweets(20);
  const dedupCtx = buildDedupContext(recent);
  const styleCtx = buildStyleContext(loadTopTweets());
  const ctx      = formatTrendContext(trends);

  const res = await groq.chat.completions.create({
    model:      MODEL,
    max_tokens: 1400,
    temperature: 0.82,
    messages: [
      { role: 'system', content: SYSTEM },
      {
        role: 'user',
        content: `Today's trending:\n${ctx}\n${styleCtx}${dedupCtx}\n\nWrite a 5-tweet morning thread.\n\n- Tweet 1: Hook. Strong claim. Standalone.\n- Tweets 2-4: One concrete point each. Specific.\n- Tweet 5: The payoff. Drives replies.\n- Number: "1/" ... "5/"\n- Each max 265 chars\n- No quotes around the tweets\n- English only\n\nReturn ONLY a JSON array: ["tweet1","tweet2","tweet3","tweet4","tweet5"]`,
      },
    ],
  });
  const text = res.choices[0].message.content.trim();
  try {
    const match  = text.match(/\[[\s\S]*\]/);
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

// ── generateReply ─────────────────────────────────────────────────────────────
async function generateReply(tweetText, targetAccount) {
  const res = await groq.chat.completions.create({
    model:      MODEL,
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

// ── generateMentionReply ──────────────────────────────────────────────────────
async function generateMentionReply(mentionText, fromUsername) {
  const res = await groq.chat.completions.create({
    model:      MODEL,
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

// ── generateRepostComment ─────────────────────────────────────────────────────
async function generateRepostComment(tweetText, authorHandle) {
  const res = await groq.chat.completions.create({
    model:      MODEL,
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
