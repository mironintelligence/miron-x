// self-improve.js — Code Evolution Engine
// Reads: errors.json + brain_report.json + growth.json
// Writes:
//   data/self_improve_report.json  — human-readable findings
//   data/dynamic_config.json       — live config the generator reads (typeMultipliers, etc.)
//
// This is the "code self-improvement" loop:
// pattern found → dynamic_config updated → generator adapts → next tweets improve

require('dotenv').config();
const { logError } = require('./logger');
const config = require('./config');
const fs = require('fs');
const path = require('path');

const ERRORS_PATH   = path.join(__dirname, '../data/errors.json');
const BRAIN_PATH    = path.join(__dirname, '../data/brain_report.json');
const GROWTH_PATH   = path.join(__dirname, '../data/growth.json');
const POSTED_PATH   = path.join(__dirname, '../data/posted.json');
const REPORT_PATH   = path.join(__dirname, '../data/self_improve_report.json');
const DYN_CFG_PATH  = path.join(__dirname, '../data/dynamic_config.json');

function load(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); }
  catch { return fallback; }
}
function saveJSON(p, data) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(data, null, 2));
}

// ── Error analysis ─────────────────────────────────────────────────────────
function analyzeErrors(errors) {
  const sevenDaysAgo = Date.now() - 7 * 24 * 3600000;
  const recent = errors.filter(e => new Date(e.ts).getTime() > sevenDaysAgo);

  const byScript = {};
  for (const e of recent) {
    const s = e.script || 'unknown';
    if (!byScript[s]) byScript[s] = [];
    byScript[s].push(e);
  }

  const critical = Object.entries(byScript)
    .filter(([, errs]) => errs.length >= 3)
    .map(([script, errs]) => ({
      script,
      count:     errs.length,
      lastError: errs[errs.length - 1]?.error,
    }));

  return {
    totalRecent: recent.length,
    byScript: Object.fromEntries(
      Object.entries(byScript).map(([s, errs]) => [
        s,
        { count: errs.length, lastError: errs[errs.length - 1]?.error },
      ])
    ),
    criticalScripts: critical,
  };
}

// ── Growth analysis ────────────────────────────────────────────────────────
function analyzeGrowth(growth) {
  if (growth.length < 2) return { status: 'insufficient_data', currentFollowers: growth[0]?.followers || 0 };

  const first = growth[0];
  const last  = growth[growth.length - 1];
  const daysDiff   = Math.max(0.1, (new Date(last.ts) - new Date(first.ts)) / 86400000);
  const totalGain  = (last.followers || 0) - (first.followers || 0);
  const dailyRate  = parseFloat((totalGain / daysDiff).toFixed(2));

  // Stagnant = no growth in last 5 snapshots
  const recent5 = growth.slice(-5);
  const recentGain = (recent5[recent5.length - 1]?.followers || 0) - (recent5[0]?.followers || 0);
  const isStagnant = recent5.length >= 5 && recentGain === 0;

  return {
    currentFollowers: last.followers || 0,
    totalGain,
    trackingDays:   Math.round(daysDiff),
    dailyGrowthRate: dailyRate,
    isStagnant,
    recentGain,
  };
}

// ── Dynamic config — generator reads this every run ───────────────────────
function buildDynamicConfig(brain) {
  const base = {
    typeMultipliers:      null,
    topKeywords:          [],
    optimalLengthRange:   null,
    questionEndingBoost:  1.0,
    updatedAt:            new Date().toISOString(),
  };

  if (!brain || brain.status === 'insufficient_data') return base;

  return {
    ...base,
    typeMultipliers:     brain.typeMultipliers || null,
    topKeywords:         (brain.topKeywords || []).slice(0, 6).map(k => k.keyword),
    optimalLengthRange:  brain.formatInsights?.optimalLengthRange || null,
    questionEndingBoost: brain.formatInsights?.questionEndingBoost || 1.0,
  };
}

// ── Suggest new SEARCH_KEYWORDS based on what gets engagement ─────────────
function suggestKeywords(brain, currentKeywords) {
  if (!brain?.topKeywords?.length) return [];

  const topKws = brain.topKeywords.slice(0, 5).map(k => k.keyword.toLowerCase());
  const expansions = {
    'sv':       ['SV bootstrapped founder', 'Bay Area indie founder', 'pre-seed SV building'],
    'london':   ['London indie founder', 'UK startup no VC', 'UK tech bootstrapped'],
    'llm':      ['LLM startup founder', 'Claude API building', 'AI agent shipped'],
    'founder':  ['indie founder distribution', 'no VC founder building', 'early stage founder PMF'],
    'yc':       ['YC W25 building', 'YC rejected keep going', 'post-YC founder bootstrapped'],
    'ai':       ['AI product solofounder', 'AI tools indie hacker', 'vibe coding founder shipped'],
    'build':    ['building in public no audience', 'shipped without funding', 'solo builder week'],
    'openai':   ['OpenAI vs Anthropic founder', 'GPT-4 vs Claude builder'],
    'anthropic':['Claude API production startup', 'Anthropic Claude builder'],
    'bootstrap':['bootstrapped founder SV', 'self-funded founder shipped', 'no VC indie hacker'],
  };

  const suggestions = [];
  for (const kw of topKws) {
    const related = expansions[kw] || [];
    for (const r of related) {
      const alreadyHas = currentKeywords.some(k =>
        k.toLowerCase().includes(r.split(' ')[0].toLowerCase())
      );
      if (!alreadyHas) suggestions.push(r);
    }
  }

  return [...new Set(suggestions)].slice(0, 6);
}

async function main() {
  console.log('▶ self-improve.js — Code evolution analysis');

  const errors = load(ERRORS_PATH, []);
  const brain  = load(BRAIN_PATH,  null);
  const growth = load(GROWTH_PATH, []);

  const errorAnalysis  = analyzeErrors(errors);
  const growthAnalysis = analyzeGrowth(growth);

  // ── Performance summary from brain ──────────────────────────────────────
  let performanceAnalysis = { status: 'no_brain_report' };
  if (brain) {
    const mults = brain.typeMultipliers || {};
    const typeEntries = Object.entries(mults)
      .map(([t, m]) => ({ type: t, mult: m, data: brain.typePerformance?.[t] }))
      .filter(e => e.data?.withEngagement >= 2)
      .sort((a, b) => b.mult - a.mult);

    performanceAnalysis = {
      status:               brain.status,
      tweetsWithEngagement: brain.tweetsWithEngagement || 0,
      bestType:  typeEntries[0]  ? `${typeEntries[0].type} (${typeEntries[0].mult}x)`  : null,
      worstType: typeEntries.slice(-1)[0]
        ? `${typeEntries.slice(-1)[0].type} (${typeEntries.slice(-1)[0].mult}x)`
        : null,
      recommendations: brain.recommendations || [],
    };
  }

  // ── Dynamic config update ────────────────────────────────────────────────
  const dynamicConfig = buildDynamicConfig(brain);
  saveJSON(DYN_CFG_PATH, dynamicConfig);
  console.log('  dynamic_config.json updated');

  // ── Keyword suggestions ─────────────────────────────────────────────────
  const kwSuggestions = suggestKeywords(brain, config.SEARCH_KEYWORDS);

  // ── Overall recommendations ──────────────────────────────────────────────
  const overallRecs = [];

  if (errorAnalysis.criticalScripts.length > 0) {
    const names = errorAnalysis.criticalScripts.map(s => `${s.script} (${s.count}x)`).join(', ');
    overallRecs.push(`CRITICAL: Repeated errors in: ${names} — check errors.json`);
  }
  if (growthAnalysis.isStagnant) {
    overallRecs.push(`GROWTH STAGNANT: No new followers in ${growthAnalysis.trackingDays} tracked days — increase engage.js frequency or adjust content mix`);
  }
  if (performanceAnalysis.bestType) {
    overallRecs.push(`DOUBLE DOWN: ${performanceAnalysis.bestType} content performing best — increase slots or post more of this type`);
  }
  if (performanceAnalysis.worstType) {
    const worstMult = brain?.typeMultipliers?.[performanceAnalysis.worstType.split(' ')[0]];
    if (worstMult && worstMult < 0.7) {
      overallRecs.push(`REDUCE: ${performanceAnalysis.worstType} content underperforming — consider reducing or restructuring`);
    }
  }
  if (kwSuggestions.length > 0) {
    overallRecs.push(`NEW SEARCH KEYWORDS: ${kwSuggestions.slice(0, 3).join(' | ')} — add to config.SEARCH_KEYWORDS`);
  }
  if (!overallRecs.length) {
    overallRecs.push('System healthy — no critical issues found');
  }

  // ── Save report ──────────────────────────────────────────────────────────
  const report = {
    updatedAt: new Date().toISOString(),
    errorAnalysis,
    performanceAnalysis,
    growthAnalysis,
    keywordSuggestions:    kwSuggestions,
    overallRecommendations: overallRecs,
    dynamicConfigUpdated:  true,
  };
  saveJSON(REPORT_PATH, report);

  // ── Console output ───────────────────────────────────────────────────────
  console.log('\nFindings:');
  overallRecs.forEach(r => console.log(`  • ${r}`));

  console.log(`\nErrors (7d): ${errorAnalysis.totalRecent}`);
  if (errorAnalysis.criticalScripts.length) {
    errorAnalysis.criticalScripts.forEach(s =>
      console.log(`  ❌ ${s.script}: ${s.count} errors — last: ${s.lastError}`)
    );
  }

  if (growthAnalysis.currentFollowers !== undefined) {
    console.log(`\nGrowth: ${growthAnalysis.currentFollowers} followers | +${growthAnalysis.totalGain || 0} total | ${growthAnalysis.dailyGrowthRate || 0}/day`);
  }

  console.log('\n✅ Self-improve report saved');
}

if (require.main === module) {
  main().catch(e => {
    logError('self-improve.js', e, { phase: 'uncaught' });
    process.exit(1);
  });
}
