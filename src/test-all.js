require('dotenv').config();
const { XClient } = require('./xclient');
const { generateTweet, generateWolfTweet, generateReply, generateMentionReply, generateRepostComment } = require('./generator');
const { getTodaysTrends } = require('./trends');
const config = require('./config');

const x = new XClient(process.env.XACTIONS_SESSION_COOKIE);

let pass = 0, fail = 0;
const results = [];

function ok(name, detail = '') {
  pass++;
  results.push({ status: 'PASS', name, detail });
  console.log(`  ✅ PASS  ${name}${detail ? ' — ' + detail : ''}`);
}

function ko(name, error) {
  fail++;
  results.push({ status: 'FAIL', name, error: error?.message || String(error) });
  console.log(`  ❌ FAIL  ${name}`);
  console.log(`         ${error?.message || error}`);
}

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function run() {
  const POST = process.env.POST_TWEETS === 'true';
  console.log('\n══════════════════════════════════════════');
  console.log(`  SYSTEM TEST${POST ? ' (WITH POSTING)' : ' (READ-ONLY)'}`);
  console.log('══════════════════════════════════════════\n');

  // ── 1. OWN PROFILE VIA GRAPHQL ──────────────────────────────────────────
  console.log('1. OWN PROFILE — GraphQL UserByScreenName');
  try {
    const profile = await x.getProfile('kerimaydemirco');
    if (profile?.id) ok('Own profile', `@${profile.username} | ID:${profile.id} | ${profile.followersCount} followers`);
    else ko('Own profile', new Error('No id returned'));
  } catch (e) { ko('Own profile', e); }
  await sleep(1000);

  // ── 2. OWN TIMELINE ─────────────────────────────────────────────────────
  console.log('\n2. OWN TIMELINE — GraphQL UserTweets');
  try {
    const tweets = [];
    for await (const t of x.getTweets('kerimaydemirco', 5)) tweets.push(t);
    ok('Own timeline', `${tweets.length} tweets — last: "${tweets[0]?.text?.substring(0, 50) || 'none'}"`);
  } catch (e) { ko('Own timeline', e); }
  await sleep(1000);

  // ── 3. EXTERNAL TIMELINE — multiple accounts ────────────────────────────
  console.log('\n3. EXTERNAL TIMELINES — naval, levelsio, paulg');
  for (const acc of ['naval', 'levelsio', 'paulg']) {
    try {
      const tweets = [];
      for await (const t of x.getTweets(acc, 3)) tweets.push(t);
      ok(`Timeline @${acc}`, `${tweets.length} tweets — "${tweets[0]?.text?.substring(0, 50) || 'none'}"`);
      await sleep(800);
    } catch (e) { ko(`Timeline @${acc}`, e); await sleep(800); }
  }

  // ── 4. MENTIONS ──────────────────────────────────────────────────────────
  console.log('\n4. MENTIONS TIMELINE');
  try {
    const mentions = [];
    for await (const m of x.getMentions('kerimaydemirco', 10)) mentions.push(m);
    ok('Mentions', `${mentions.length} mentions${mentions[0] ? ` — from @${mentions[0].username}` : ' (yeni hesap = 0 normal)'}`);
  } catch (e) { ko('Mentions', e); }
  await sleep(1000);

  // ── 5. GROQ TWEET GENERATION ────────────────────────────────────────────
  console.log('\n5. GROQ GENERATION');
  let genTweet = null, wolfTweet = null;
  try {
    const trends = await getTodaysTrends();
    genTweet = await generateTweet(trends, 'test');
    const emoji = /\p{Extended_Pictographic}/gu.test(genTweet);
    ok('Groq tweet', `${genTweet.length}c ${emoji ? '⚠ EMOJİ' : '✓ no emoji'} — "${genTweet.substring(0, 70)}"`);
  } catch (e) { ko('Groq tweet', e); }
  await sleep(1000);

  try {
    wolfTweet = await generateWolfTweet();
    const emoji = /\p{Extended_Pictographic}/gu.test(wolfTweet);
    ok('Groq wolf', `${wolfTweet.length}c ${emoji ? '⚠ EMOJİ' : '✓ no emoji'} — "${wolfTweet.substring(0, 70)}"`);
  } catch (e) { ko('Groq wolf', e); }
  await sleep(1000);

  // Groq SV mode
  process.env.SV_MODE = 'true';
  try {
    const trends = await getTodaysTrends();
    const svTweet = await generateTweet(trends, 'sv-test');
    const emoji = /\p{Extended_Pictographic}/gu.test(svTweet);
    ok('Groq SV tweet', `${svTweet.length}c ${emoji ? '⚠ EMOJİ' : '✓ no emoji'} — "${svTweet.substring(0, 70)}"`);
  } catch (e) { ko('Groq SV tweet', e); }
  process.env.SV_MODE = '';
  await sleep(1000);

  // Groq London mode
  process.env.LONDON_MODE = 'true';
  try {
    const trends = await getTodaysTrends();
    const ldnTweet = await generateTweet(trends, 'ldn-test');
    const emoji = /\p{Extended_Pictographic}/gu.test(ldnTweet);
    ok('Groq London tweet', `${ldnTweet.length}c ${emoji ? '⚠ EMOJİ' : '✓ no emoji'} — "${ldnTweet.substring(0, 70)}"`);
  } catch (e) { ko('Groq London tweet', e); }
  process.env.LONDON_MODE = '';
  await sleep(1000);

  // ── 6. REPOST COMMENT GENERATION ────────────────────────────────────────
  console.log('\n6. REPOST — Naval\'dan tweet al, yorum üret');
  try {
    const tweets = [];
    for await (const t of x.getTweets('naval', 5)) tweets.push(t);
    const candidate = tweets.find(t => !t.text.startsWith('RT ') && t.text.length > 40);
    if (candidate) {
      const comment = await generateRepostComment(candidate.text, 'naval');
      ok('Repost comment', `"${comment?.substring(0, 60)}" → on: "${candidate.text.substring(0, 40)}"`);
    } else ko('Repost comment', new Error('No suitable tweet found'));
  } catch (e) { ko('Repost comment', e); }
  await sleep(1000);

  // ── 7. LIKE ──────────────────────────────────────────────────────────────
  console.log('\n7. LIKE — Naval tweet beğen');
  try {
    const tweets = [];
    for await (const t of x.getTweets('naval', 3)) tweets.push(t);
    if (tweets[0]?.id) {
      try {
        await x.likeTweet(tweets[0].id);
        ok('Like tweet', `liked ID: ${tweets[0].id} — "${tweets[0].text.substring(0, 40)}"`);
      } catch (e) {
        // "already favorited" = like endpoint is working, just idempotent
        if (e.message?.includes('already favorited')) {
          ok('Like tweet', `already liked (endpoint working) — ID: ${tweets[0].id}`);
        } else throw e;
      }
    } else ko('Like tweet', new Error('No tweets to like'));
  } catch (e) { ko('Like tweet', e); }
  await sleep(1500);

  // ── 8. POST TWEET (only if POST_TWEETS=true) ────────────────────────────
  if (POST) {
    console.log('\n8. POST TWEETS (POST_TWEETS=true)');
    try {
      const r = await x.sendTweet(genTweet || 'Building without excuses. The work is the answer.');
      if (r?.id) ok('Post tweet', `https://x.com/kerimaydemirco/status/${r.id}`);
      else ko('Post tweet', new Error('No ID returned'));
    } catch (e) { ko('Post tweet', e); }
    await sleep(5000);

    try {
      const r2 = await x.sendTweet(wolfTweet || 'Chaos is not the enemy. Comfort is.');
      if (r2?.id) ok('Post wolf', `https://x.com/kerimaydemirco/status/${r2.id}`);
      else ko('Post wolf', new Error('No ID returned'));
    } catch (e) { ko('Post wolf', e); }
    await sleep(5000);

    // Quote tweet
    try {
      const tweets = [];
      for await (const t of x.getTweets('naval', 5)) tweets.push(t);
      const candidate = tweets.find(t => !t.text.startsWith('RT ') && t.text.length > 40);
      if (candidate) {
        const comment = await generateRepostComment(candidate.text, 'naval');
        const r3 = await x.sendTweet(comment.substring(0, 270), { quoteTweetId: candidate.id });
        if (r3?.id) ok('Quote tweet', `https://x.com/kerimaydemirco/status/${r3.id}`);
        else ko('Quote tweet', new Error('No ID returned'));
      }
    } catch (e) { ko('Quote tweet', e); }
  } else {
    console.log('\n8. POST TWEETS — atlandı (POST_TWEETS=true ile aktifleştir)');
  }

  // ── ÖZET ─────────────────────────────────────────────────────────────────
  console.log('\n══════════════════════════════════════════');
  console.log(`  SONUÇ: ${pass} PASS  |  ${fail} FAIL`);
  console.log('══════════════════════════════════════════');

  if (fail > 0) {
    console.log('\nBAŞARISIZ:');
    results.filter(r => r.status === 'FAIL').forEach(r => {
      console.log(`  ❌ ${r.name}: ${r.error}`);
    });
  }

  const urls = results.filter(r => r.detail?.includes('x.com'));
  if (urls.length > 0) {
    console.log('\nPOSTED URLs:');
    urls.forEach(r => console.log(`  ${r.detail.split('— ')[1] || r.detail}`));
  }
}

run().catch(e => { console.error('TEST CRASHED:', e.message); process.exit(1); });
