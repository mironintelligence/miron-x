// growth.js — Follower & account growth tracker
// Saves daily snapshots of follower count to data/growth.json
// Detects stagnation — signals self-improve.js to adjust strategy

require('dotenv').config();
const { XClient } = require('./xclient');
const { logError } = require('./logger');
const fs = require('fs');
const path = require('path');

const GROWTH_PATH = path.join(__dirname, '../data/growth.json');
const HANDLE      = process.env.TWITTER_HANDLE || 'kerimaydemirco';

function load() {
  try { return JSON.parse(fs.readFileSync(GROWTH_PATH, 'utf8')); }
  catch { return []; }
}

function save(data) {
  fs.mkdirSync(path.dirname(GROWTH_PATH), { recursive: true });
  // Keep last 90 snapshots (3 months of daily data)
  fs.writeFileSync(GROWTH_PATH, JSON.stringify(data.slice(-90), null, 2));
}

async function main() {
  console.log('▶ growth.js — Profile stats tracker');

  const x = new XClient(process.env.XACTIONS_SESSION_COOKIE);

  let profile;
  try {
    profile = await x.getProfile(HANDLE);
  } catch (e) {
    logError('growth.js', e, { phase: 'get_profile' });
    process.exit(1);
  }

  const history = load();
  const entry = {
    ts:        new Date().toISOString(),
    followers: profile.followersCount || 0,
    name:      profile.name,
  };
  history.push(entry);
  save(history);

  // Growth rate analysis
  if (history.length >= 2) {
    const prev = history[history.length - 2];
    const diff = entry.followers - (prev.followers || 0);
    console.log(`\nFollowers: ${entry.followers}  (${diff >= 0 ? '+' : ''}${diff} since last snapshot)`);

    if (history.length >= 7) {
      const weekAgo  = history[Math.max(0, history.length - 8)];
      const weekGain = entry.followers - (weekAgo.followers || 0);
      const days = (new Date(entry.ts) - new Date(weekAgo.ts)) / 86400000;
      const rate = days > 0 ? (weekGain / days).toFixed(1) : '—';
      console.log(`7-day gain: ${weekGain >= 0 ? '+' : ''}${weekGain} followers  (${rate}/day)`);
      if (weekGain === 0 && days >= 5) {
        console.log('  ⚠ STAGNANT — no follower growth in 5+ days. Review engagement strategy.');
      }
    }
  } else {
    console.log(`\nFollowers: ${entry.followers}  (baseline saved)`);
  }

  console.log('\n✅ Growth data saved');
}

if (require.main === module) {
  main().catch(e => {
    logError('growth.js', e, { phase: 'uncaught' });
    process.exit(1);
  });
}
