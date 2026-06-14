require('dotenv').config();
const { getTodaysTrends } = require('./trends');
const { generateThread } = require('./generator');
const { XClient } = require('./xclient');

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

  const x = new XClient(process.env.XACTIONS_SESSION_COOKIE);

  let lastId = null;
  for (let i = 0; i < tweets.length; i++) {
    try {
      const result = await x.sendTweet(tweets[i], lastId ? { replyTo: lastId } : {});
      lastId = result?.id || null;
      console.log(`✅ Tweet ${i + 1}/${tweets.length} posted`);
      if (i < tweets.length - 1) await sleep(4500);
    } catch (err) {
      console.error(`⚠ Tweet ${i + 1} failed:`, err.message);
    }
  }

  console.log('✅ Thread complete');
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
