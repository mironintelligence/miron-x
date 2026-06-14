require('dotenv').config();
const { getTodaysTrends } = require('./trends');
const { generateThread } = require('./generator');

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  console.log('▶ thread.js — Morning thread');

  const trends = await getTodaysTrends();
  const tweets = await generateThread(trends);

  if (!tweets || tweets.length < 3) {
    console.error('Thread generation failed or too short');
    process.exit(1);
  }

  console.log(`Generated ${tweets.length}-tweet thread:`);
  tweets.forEach((t, i) => console.log(`  ${i + 1}: ${t.substring(0, 70)}...`));

  // XACTIONS_SESSION_COOKIE = "auth_token=XXX; ct0=YYY"
  const { Scraper } = await import('xactions');
  const scraper = new Scraper();
  await scraper.setCookies(process.env.XACTIONS_SESSION_COOKIE);

  if (!await scraper.isLoggedIn()) {
    console.error('Auth failed — check XACTIONS_SESSION_COOKIE includes both auth_token and ct0');
    process.exit(1);
  }

  let lastId = null;
  for (let i = 0; i < tweets.length; i++) {
    try {
      const result = await scraper.sendTweet(tweets[i], lastId ? { replyTo: lastId } : {});
      lastId = result?.id || result?.rest_id || null;
      console.log(`✅ Tweet ${i + 1}/${tweets.length} posted`);
      if (i < tweets.length - 1) await sleep(4500);
    } catch (err) {
      console.error(`⚠ Tweet ${i + 1} failed:`, err.message);
    }
  }

  console.log('✅ Thread complete');
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
