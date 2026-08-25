'use strict';
/** Write aggregate results.json from current suite measurements. */
const fs = require('fs');
const { makeRng } = require('./lib/rng');
const { LAYOUT } = require('./plant/layout');
const { Plant } = require('./plant/kernel');
const { Ingest } = require('./twin/ingest');
const {
  averageActivePeriods,
  utilisationRanking,
  separates,
  shiftingBottlenecks,
} = require('./twin/apm');

function median(xs) {
  const s = xs.slice().sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : 0.5 * (s[m - 1] + s[m]);
}

function mean(xs) {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}
function sd(xs) {
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / Math.max(1, xs.length - 1));
}

const out = { generatedAt: new Date().toISOString(), seed: 20260822 };

// Day 1
{
  const plant = new Plant(LAYOUT, makeRng(20260822), { emitDR: false });
  const t0 = Date.now();
  plant.run(1000);
  const s = plant.stats();
  const warmT = 6 * 3600;
  const post = plant.groundTruth.filter((e) => e.e === 'unit_complete' && e.t >= warmT);
  const mid = warmT + (s.t - warmT) / 2;
  const first = post.filter((e) => e.t <= mid).length;
  const second = post.filter((e) => e.t > mid).length;
  const drift = Math.abs(first - second) / Math.max(first, second, 1);
  out.day1 = {
    throughput_u_per_h: +s.throughput.toFixed(2),
    effectiveTakt_s: +s.effectiveTakt.toFixed(2),
    targetTakt_s: LAYOUT.targetTakt,
    welds: s.welds,
    defectRate_pct: +(100 * s.defectRate).toFixed(3),
    caught: s.caught,
    escaped: s.escaped,
    darkLeaks: s.darkLeaks,
    taktDrift_pct: +(100 * drift).toFixed(2),
    runtime_s: +((Date.now() - t0) / 1000).toFixed(2),
    reproducible: true,
  };
}

// Day 2
{
  const blinds = [];
  const carriers = [];
  const lats = [];
  for (let rep = 0; rep < 40; rep++) {
    const plant = new Plant(LAYOUT, makeRng(1000 + rep * 17), {
      emitDR: false,
      accelStation: 'S07',
      accelGun: 0,
      accelFromUnit: 140,
      accelMul: 11,
    });
    plant.run(400);
    const defects = plant.groundTruth.filter(
      (e) => e.e === 'defect_created' && e.s === 'S07' && e.accelerated && e.u >= 140
    );
    if (!defects.length) {
      blinds.push(260);
      carriers.push(0);
      lats.push((260 * (plant.stats().effectiveTakt || 60)) / 60);
      continue;
    }
    const blind = defects[0].u - 140;
    blinds.push(blind);
    carriers.push(new Set(defects.map((d) => d.u)).size);
    lats.push((blind * (plant.stats().effectiveTakt || 60)) / 60);
  }
  out.day2 = {
    reps: 40,
    medianBlindUnits: median(blinds),
    blindRange: [Math.min(...blinds), Math.max(...blinds)],
    medianCarrierUnits: median(carriers),
    carrierRange: [Math.min(...carriers), Math.max(...carriers)],
    medianLatency_min: +median(lats).toFixed(1),
  };
}

// Day 3
{
  const REPS = 8;
  const utilTop = [];
  const utilSecond = [];
  const apmTop = [];
  let shift = null;
  for (let rep = 0; rep < REPS; rep++) {
    const plant = new Plant(LAYOUT, makeRng(42 + rep * 99), { emitDR: false });
    plant.run(1200);
    const ingest = new Ingest(LAYOUT).pushAll(plant.events);
    const warmT = 6 * 3600;
    const measT = warmT + 6 * 3600;
    const util = utilisationRanking(ingest, warmT, measT);
    utilTop.push(util[0]);
    utilSecond.push(util[1]);
    apmTop.push(averageActivePeriods(ingest, warmT, measT)[0]);
    if (rep === 0) shift = shiftingBottlenecks(ingest, warmT, warmT + 12 * 3600);
  }
  const u1m = mean(utilTop.map((r) => r.pct));
  const u1s = sd(utilTop.map((r) => r.pct));
  const u2m = mean(utilSecond.map((r) => r.pct));
  const u2s = sd(utilSecond.map((r) => r.pct));
  const gap = u1m - u2m;
  const pooled = Math.sqrt(u1s * u1s + u2s * u2s) || 1e-9;
  out.day3 = {
    util: {
      top: utilTop[0].station,
      topPct: +u1m.toFixed(2),
      topSd: +u1s.toFixed(2),
      second: utilSecond[0].station,
      secondPct: +u2m.toFixed(2),
      secondSd: +u2s.toFixed(2),
      sigmaGap: +((gap / pooled)).toFixed(2),
    },
    apm: {
      top: apmTop.sort((a, b) =>
        apmTop.filter((x) => x.station === b.station).length -
        apmTop.filter((x) => x.station === a.station).length
      )[0].station,
      avgActive_s: +mean(apmTop.map((r) => r.avgActive)).toFixed(1),
    },
    shifting: {
      S19: shift.summary.find((r) => r.station === 'S19'),
      S22: shift.summary.find((r) => r.station === 'S22'),
      S28: shift.summary.find((r) => r.station === 'S28'),
    },
  };
}

let lead = null;
try {
  lead = JSON.parse(fs.readFileSync('./results_leadtime.json', 'utf8'));
} catch (_) {}
out.day4_leadtime = lead
  ? {
      n: lead.n,
      medianMin: lead.medianMin,
      meanMin: lead.meanMin,
      p10Min: lead.p10Min,
      p90Min: lead.p90Min,
      censored: lead.censored,
      target: lead.target,
    }
  : null;

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (_) {
    return null;
  }
}

const det = readJson('./results_detectors.json');
out.day5_detectors = det
  ? {
      roc_auc: det.roc_auc,
      operating: det.operating,
      spc_baseline: det.spc_baseline,
      beatsSPC: det.beatsSPC,
      defects: det.defects,
      alerts: det.alerts,
    }
  : null;

const virt = readJson('./results_virtual.json');
out.day6_virtual = virt
  ? {
      n: virt.n,
      overallCoverage80: virt.overallCoverage80,
      overallPct: virt.overallPct,
      sentence: virt.sentence,
      voiTop5: virt.voiTop5,
    }
  : null;

const apmv = readJson('./results_apm_validate.json');
out.day7_apm = apmv
  ? {
      target: apmv.target,
      solePct: apmv.solePct,
      totalPct: apmv.totalPct,
      predictedBand_s: apmv.predictedBand_s,
      meanGain_s: apmv.meanGain_s,
      validated: apmv.validated,
    }
  : null;

fs.writeFileSync('./results.json', JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
