const Groq = require('groq-sdk');
const config = require('./config');

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const SYSTEM = `You are writing content AS ${config.PERSONA.name}.

BACKGROUND:
${config.PERSONA.background}

VOICE:
${config.PERSONA.voice}

RULES:
${config.TWEET_RULES}`;

const STOIC_SYSTEM = `You are writing content AS ${config.PERSONA.name}.

${config.PERSONA.background}

VOICE: Same direct, dry builder voice — but this tweet draws from Stoic philosophy or hard-won mental models.
Not motivational poster fluff. Not "hustle bro" energy. Real, quiet strength.
Think Marcus Aurelius applied to building companies in the 21st century.
Never preachy. Never "you should". State it as personal truth or observation.
English only. Max 240 chars.`;

function formatTrendContext(trends) {
  return [
    ...trends.hackerNews.slice(0, 6).map(s => `HN (${s.score}pts): ${s.title}`),
    ...trends.rssNews.slice(0, 4).map(n => `${n.source}: ${n.title}`)
  ].join('\n');
}

async function generateTweet(trends, slotNumber) {
  // ~25% chance of stoic/philosophy tweet on slots 3 and 4
  const isStoicSlot = (slotNumber === '3' || slotNumber === '4' || slotNumber === 3 || slotNumber === 4);
  const goStoic = isStoicSlot && Math.random() < 0.3;

  if (goStoic) {
    return generateStoicTweet();
  }

  const ctx = formatTrendContext(trends);
  const res = await groq.chat.completions.create({
    model: 'llama-3.3-70b-versatile',
    max_tokens: 180,
    temperature: 0.88,
    messages: [
      { role: 'system', content: SYSTEM },
      {
        role: 'user',
        content: `Today's trending topics:\n${ctx}\n\nThis is tweet slot #${slotNumber} of 6 today.\nPick ONE topic. Write Kerim's TAKE on it — not a summary, his opinion.\nMax 270 chars. Return ONLY the tweet text.`
      }
    ]
  });
  return res.choices[0].message.content.trim();
}

async function generateStoicTweet() {
  const prompts = [
    'Write a short stoic reflection on building something real when everything is uncertain. No advice. Just truth.',
    'Marcus Aurelius meets the startup world. One quiet, hard observation about doing the work when no one is watching.',
    'Write about the gap between planning and shipping — through a stoic lens. Builder perspective. No fluff.',
    'A stoic thought on failure, iteration, and why most people quit too early. Specific. Dry. Not motivational.',
    'Write about staying focused when the world is full of noise. Stoic framing. Builder context.',
    'A thought on patience in building — the kind of patience that comes from knowing what matters, not from waiting.',
  ];
  const prompt = prompts[Math.floor(Math.random() * prompts.length)];

  const res = await groq.chat.completions.create({
    model: 'llama-3.3-70b-versatile',
    max_tokens: 150,
    temperature: 0.85,
    messages: [
      { role: 'system', content: STOIC_SYSTEM },
      { role: 'user', content: `${prompt}\nMax 240 chars. Return ONLY the tweet text.` }
    ]
  });
  return res.choices[0].message.content.trim();
}

async function generateThread(trends) {
  const ctx = formatTrendContext(trends);
  const res = await groq.chat.completions.create({
    model: 'llama-3.3-70b-versatile',
    max_tokens: 1400,
    temperature: 0.82,
    messages: [
      { role: 'system', content: SYSTEM },
      {
        role: 'user',
        content: `Today's trending topics:\n${ctx}\n\nWrite a 5-tweet thread for Kerim's morning post.\n\nRULES:\n- Tweet 1: Hook. Strong claim. Works as standalone tweet.\n- Tweets 2-4: Each = one concrete point. Specific. No fluff.\n- Tweet 5: The payoff. Actionable or thought-provoking. Drives replies.\n- Number them: "1/" "2/" ... "5/"\n- Each tweet max 265 chars\n- Thread must feel like one coherent argument\n- English only\n\nReturn ONLY a JSON array: ["tweet1","tweet2","tweet3","tweet4","tweet5"]`
      }
    ]
  });
  const text = res.choices[0].message.content.trim();
  try {
    const match = text.match(/\[[\s\S]*\]/);
    return match ? JSON.parse(match[0]) : [];
  } catch {
    return text
      .split('\n')
      .filter(l => l.includes('/'))
      .map(l => l.replace(/^["'\d./\s]+/, '').replace(/[",]+$/, '').trim())
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
        content: `@${targetAccount} tweeted:\n"${tweetText}"\n\nWrite a SHORT reply (max 110 chars) that:\n- Adds a genuine angle or pushback\n- NOT "Great point!" or any praise\n- Shows real builder experience\n- Might spark a real conversation\n- English only\n\nIf you can't write a good reply, return: SKIP\nReturn ONLY the reply text or SKIP.`
      }
    ]
  });
  const text = res.choices[0].message.content.trim();
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
        content: `Someone replied to Kerim's tweet:\n@${fromUsername}: "${mentionText}"\n\nWrite a SHORT genuine reply (max 120 chars).\n- Engage authentically — they came to you\n- If they made a good point, build on it or pushback with specifics\n- If it's a question, answer it directly\n- No ass-kissing, no hollow "thanks!"\n- English only\n\nIf the comment adds no value or is unclear, return: SKIP\nReturn ONLY the reply text or SKIP.`
      }
    ]
  });
  const text = res.choices[0].message.content.trim();
  return text === 'SKIP' ? null : text;
}

module.exports = { generateTweet, generateThread, generateReply, generateMentionReply };
