const axios = require('axios');
const RssParser = require('rss-parser');
const config = require('./config');

const rssParser = new RssParser({ timeout: 8000 });

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function getHackerNewsStories() {
  try {
    const { data: ids } = await axios.get(
      'https://hacker-news.firebaseio.com/v0/topstories.json',
      { timeout: 8000 }
    );
    const stories = [];
    for (const id of ids.slice(0, 40)) {
      if (stories.length >= 10) break;
      try {
        const { data: s } = await axios.get(
          `https://hacker-news.firebaseio.com/v0/item/${id}.json`,
          { timeout: 4000 }
        );
        if (!s?.title || s.score < 30) continue;
        const lower = s.title.toLowerCase();
        const isRelevant = [
          'ai', 'llm', 'gpt', 'startup', 'founder', 'automation',
          'agent', 'openai', 'anthropic', 'claude', 'autonomous', 'saas',
          'machine learning', 'neural', 'model'
        ].some(kw => lower.includes(kw));
        if (isRelevant) {
          stories.push({
            title: s.title,
            url: s.url || `https://news.ycombinator.com/item?id=${id}`,
            score: s.score,
            comments: s.descendants || 0,
            source: 'HackerNews'
          });
        }
        await sleep(150);
      } catch { continue; }
    }
    return stories;
  } catch (err) {
    console.error('HN error:', err.message);
    return [];
  }
}

async function getRssNews() {
  const items = [];
  for (const url of config.RSS_FEEDS) {
    try {
      const feed = await rssParser.parseURL(url);
      feed.items.slice(0, 4).forEach(item => {
        items.push({
          title: item.title || '',
          summary: (item.contentSnippet || '').substring(0, 200),
          url: item.link || '',
          source: feed.title || url
        });
      });
    } catch { continue; }
  }
  return items;
}

async function getTodaysTrends() {
  console.log('📡 Fetching trends...');
  const [hn, rss] = await Promise.allSettled([
    getHackerNewsStories(),
    getRssNews()
  ]);
  return {
    hackerNews: hn.status === 'fulfilled' ? hn.value : [],
    rssNews: rss.status === 'fulfilled' ? rss.value : [],
    fetchedAt: new Date().toISOString()
  };
}

module.exports = { getTodaysTrends };
