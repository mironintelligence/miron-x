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

const WOLF_SYSTEM = `You are writing content AS ${config.PERSONA.name}.
His X bio says "the wolf". His banner is a wolf among sheep. This is his identity — not a costume.

VOICE FOR WOLF TWEETS:
Raw. Masculine. Warrior energy — not motivational poster, not hustle bro.
The kind of thing a man says after he's been through real fire and came out the other side.
Embracing chaos, enduring pain, moving alone, staying dangerous.
No weakness. No complaint. No victim framing.
Short sharp sentences. Hits like a fist.
Never preachy. Speaks from lived experience, not theory.
English only. Max 220 chars. No hashtags. Max 1 emoji.

THEMES TO DRAW FROM:
- The wolf doesn't explain himself to the flock
- Dancing with chaos — chaos is not a threat, it's the arena
- Pain as a teacher, not an enemy
- Solitude, focus, the discipline of doing what others won't
- Building something real while others talk
- Staying sharp when everything is uncertain
- The difference between men who endure and men who fold

GOOD EXAMPLES (tone reference):
"Most people run from chaos. I learned to move inside it. That's where the real game is played."
"Pain doesn't stop you. The story you tell about pain stops you."
"The wolf doesn't need the flock to believe in him. He just needs to know where he's going."
"Every hard thing you didn't quit made you something. Most people will never know what that something is."

BAD (never):
"Rise and grind 💪 #Motivation #Hustle"
"Real men never give up!!!"
"Be a wolf not a sheep 🐺🔥🔥🔥"`;

function formatTrendContext(trends) {
  return [
    ...trends.hackerNews.slice(0, 6).map(s => `HN (${s.score}pts): ${s.title}`),
    ...trends.rssNews.slice(0, 4).map(n => `${n.source}: ${n.title}`)
  ].join('\n');
}

async function generateTweet(trends, slotNumber) {
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

async function generateWolfTweet() {
  const prompts = [
    'Write a raw tweet about embracing chaos — not surviving it, thriving in it. Warrior energy.',
    'Write a tweet about enduring pain without complaint. The wolf keeps moving. No victim framing.',
    'Write about operating alone — the discipline of not needing validation from the flock.',
    'Write about the gap between men who fold under pressure and men who sharpen under it.',
    'Write a tweet about doing the work in the dark — no audience, no applause, just the grind.',
    'Write about chaos being the natural habitat of men who are built differently.',
    'Write about what most men call "risk" being the only real path worth taking.',
    'Write about staying dangerous when life tries to domesticate you.',
    'Write about the difference between those who talk about hard things and those who walk through them.',
    'Write about solitude as a weapon — the clarity that comes from cutting out the noise.',
  ];
  const prompt = prompts[Math.floor(Math.random() * prompts.length)];

  const res = await groq.chat.completions.create({
    model: 'llama-3.3-70b-versatile',
    max_tokens: 140,
    temperature: 0.9,
    messages: [
      { role: 'system', content: WOLF_SYSTEM },
      { role: 'user', content: `${prompt}\nMax 220 chars. Return ONLY the tweet text.` }
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

module.exports = { generateTweet, generateThread, generateReply, generateMentionReply, generateWolfTweet };
