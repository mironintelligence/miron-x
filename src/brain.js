// brain.js — Intelligence Layer
// Reads posted.json engagement data → produces brain_report.json
// Generator reads brain_report.json to evolve its own behavior:
//   - typeMultipliers: bias toward tweet types that work
//   - topKeywords: topics that get engagement
//   - formatInsights: optimal length, question endings
//   - recommendations: human-readable insights

require('dotenv').config();
const { logError } = require('./logger');
const fs = require('fs');
const path = require('path');

const POSTED_PATH   = path.join(__dirname, '../data/posted.json');
const TOP_TYPE_PATH = path.join(__dirname, '../data/top_tweets_by_type.json');
const BRAIN_PATH    = path.join(__dirname, '../data/brain_report.json');
const MIN_DATA      = parseInt(process.env.MIN_DATA_POINTS || '8');
const TYPES         = ['general', 'sv', 'london', 'wolf', 'thread'];

function load(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); }
  catch { return fallback; }
}
function saveJSON(p, data) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(data, null, 2));
}
function avg(arr, fn) {
  if (!arr.length) return 0;
  return arr.reduce((s, x) => s + fn(x), 0) / arr.length;
}

function computeTypePerformance(posted) {
  const result = {};
  for (const type of TYPES) {
    const ofType = posted.filter(t => (t.type || 'general') === type && t.id);
    const engaged = ofType.filter(t => (t.score || 0) > 0);
    result[type] = {
      count:          ofType.length,
      withEngagement: engaged.length,
      avgScore:       engaged.length >= 2
        ? parseFloat(avg(engaged, t => t.score || 0).toFixed(2))
        : null,
    };
  }
  return result;
}

function computeTypeMultipliers(typePerf) {
  const generalAvg = typePerf.general?.avgScore || null;
  const multipliers = {};
  for (const [type, stats] of Object.entries(typePerf)) {
    if (stats.withEngagement < 2 || stats.avgScore === null) {
      multipliers[type] = 1.0;
    } else if (generalAvg === null) {
      multipliers[type] = 1.0;
    } else {
      const raw = stats.avgScore / Math.max(generalAvg, 0.5);
      multipliers[type] = Math.max(0.5, Math.min(2.5, parseFloat(raw.toFixed(2))));
    }
  }
  return multipliers;
}

function computeTopKeywords(posted) {
  const withScore = posted.filter(t => t.id && t.text && t.score !== undefined);
  if (withScore.length < 4) return [];

  const keywords = [
    'AI', 'LLM', 'production', 'founder', 'startup', 'VC', 'bootstrap',
    'distribution', 'product', 'build', 'SV', 'London', 'autonomous',
    'marketing', 'growth', 'customer', 'revenue', 'pre-seed', 'YC',
    'Claude', 'OpenAI', 'Anthropic', 'fundrais', 'agent', 'indie',
  ];

  return keywords
    .map(kw => {
      const matches = withScore.filter(t => t.text.toLowerCase().includes(kw.toLowerCase()));
      if (matches.length < 2) return null;
      return {
        keyword:  kw,
        avgScore: parseFloat(avg(matches, t => t.score || 0).toFixed(2)),
        count:    matches.length,
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.avgScore - a.avgScore)
    .slice(0, 10);
}

function computeFormatInsights(posted) {
  const withScore = posted.filter(t => t.id && t.text && t.score !== undefined);
  if (withScore.length < 6) return null;

  const sorted = [...withScore].sort((a, b) => (b.score || 0) - (a.score || 0));
  const topN   = sorted.slice(0, Math.max(3, Math.floor(sorted.length * 0.3)));
  const botN   = sorted.slice(Math.floor(sorted.length * 0.7));

  const avgLenTop = Math.round(avg(topN, t => t.text.length));
  const avgLenBot = Math.round(avg(botN, t => t.text.length));

  const qTop = topN.filter(t => t.text.trim().endsWith('?')).length / Math.max(topN.length, 1);
  const qAll = withScore.filter(t => t.text.trim().endsWith('?')).length / Math.max(withScore.length, 1);

  return {
    avgHighScoreLength:   avgLenTop,
    avgLowScoreLength:    avgLenBot,
    optimalLengthRange:   [Math.round(avgLenTop * 0.8), Math.round(avgLenTop * 1.2)],
    questionEndingInTop:  parseFloat((qTop * 100).toFixed(1)),
    questionEndingOverall:parseFloat((qAll * 100).toFixed(1)),
    questionEndingBoost:  qTop > qAll + 0.05
      ? parseFloat((qTop / Math.max(qAll, 0.01)).toFixed(2))
      : 1.0,
  };
}

function generateRecommendations(typePerf, multipliers, formatInsights, topKeywords) {
  const recs = [];

  const typeEntries = Object.entries(multipliers)
    .map(([type, mult]) => ({ type, mult, data: typePerf[type] }))
    .filter(e => e.data?.withEngagement >= 2)
    .sort((a, b) => b.mult - a.mult);

  if (typeEntries.length >= 2) {
    const best  = typeEntries[0];
    const worst = typeEntries[typeEntries.length - 1];
    recs.push(`${best.type.toUpperCase()} tweets perform best — ${best.mult}x multiplier, avg score ${typePerf[best.type]?.avgScore}`);
    if (worst.mult < 0.75) {
      recs.push(`${worst.type.toUpperCase()} tweets underperform (${worst.mult}x) — consider reducing frequency`);
    }
  } else if (typeEntries.length === 1) {
    recs.push(`${typeEntries[0].type.toUpperCase()} tweets: ${typeEntries[0].mult}x multiplier`);
  }

  if (formatInsights) {
    const optLen = `${formatInsights.optimalLengthRange[0]}–${formatInsights.optimalLengthRange[1]}`;
    recs.push(`Optimal length: ${optLen} chars (high performers: ${formatInsights.avgHighScoreLength}c, low: ${formatInsights.avgLowScoreLength}c)`);
    if (formatInsights.questionEndingBoost > 1.3) {
      recs.push(`Question-ending tweets get ${formatInsights.questionEndingBoost}x more engagement — use more often`);
    }
  }

  if (topKeywords.length >= 3) {
    const topKw = topKeywords.slice(0, 3).map(k => `"${k.keyword}" (${k.avgScore}pts)`).join(', ');
    recs.push(`High-performing keywords: ${topKw}`);
  }

  if (!recs.length) recs.push('Keep posting — accumulating data for pattern recognition');
  return recs;
}

async function main() {
  console.log('▶ brain.js — Intelligence analysis');

  const posted = load(POSTED_PATH, []);
  const tweetsWithId = posted.filter(t => t.id);

  console.log(`Posted: ${posted.length} total, ${tweetsWithId.length} with IDs`);

  if (tweetsWithId.length < MIN_DATA) {
    const placeholder = {
      updatedAt:       new Date().toISOString(),
      status:          'insufficient_data',
      totalTweets:     posted.length,
      tweetsWithId:    tweetsWithId.length,
      minRequired:     MIN_DATA,
      typeMultipliers: Object.fromEntries(TYPES.map(t => [t, 1.0])),
      topKeywords:     [],
      formatInsights:  null,
      recommendations: ['Keep posting — brain needs more data to learn patterns'],
    };
    saveJSON(BRAIN_PATH, placeholder);
    console.log(`Not enough data (${tweetsWithId.length} < ${MIN_DATA}) — placeholder saved`);
    return;
  }

  // Ensure score field is populated
  const scored = posted.map(t => ({
    ...t,
    score: t.score !== undefined
      ? t.score
      : (t.likes || 0) * 3 + (t.retweets || 0) * 5 + (t.replies || 0) * 2,
  }));

  const withEngagement = scored.filter(t => t.id && (t.score || 0) > 0);

  const typePerf    = computeTypePerformance(scored);
  const multipliers = computeTypeMultipliers(typePerf);
  const topKeywords = computeTopKeywords(scored);
  const formatInsights = computeFormatInsights(scored);
  const recommendations = generateRecommendations(typePerf, multipliers, formatInsights, topKeywords);

  const report = {
    updatedAt:            new Date().toISOString(),
    status:               'active',
    totalTweets:          posted.length,
    tweetsWithEngagement: withEngagement.length,
    typePerformance:      typePerf,
    typeMultipliers:      multipliers,
    topKeywords,
    formatInsights,
    recommendations,
  };

  saveJSON(BRAIN_PATH, report);

  console.log('\nInsights:');
  recommendations.forEach(r => console.log(`  • ${r}`));

  console.log('\nType multipliers:');
  for (const [type, mult] of Object.entries(multipliers)) {
    const bar = '█'.repeat(Math.round(mult * 4));
    console.log(`  ${type.padEnd(8)}: ${String(mult).padStart(4)}x  ${bar}`);
  }

  console.log('\n✅ Brain report saved');
}

if (require.main === module) {
  main().catch(e => {
    logError('brain.js', e, { phase: 'uncaught' });
    process.exit(1);
  });
}
