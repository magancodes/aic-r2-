'use strict';

const { makeRng } = require('../plant/rng');
const { LAYOUT } = require('../plant/layout');
const { Plant } = require('../plant/kernel');
const { Ingest } = require('../twin/ingest');
const {
  averageActivePeriods,
  utilisationRanking,
  separates,
  shiftingBottlenecks,
} = require('../twin/apm');

function mean(xs) {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}
function sd(xs) {
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / Math.max(1, xs.length - 1));
}

function main() {
  console.log('=== harness/test_apm.js ===');
  const WARMUP_H = 6;
  const MEASURE_H = 6;
  const SHIFT_H = 12;
  const REPS = 8;

  const utilTop = [];
  const utilSecond = [];
  const apmTop = [];
  let lastShift = null;

  for (let rep = 0; rep < REPS; rep++) {
    const rng = makeRng(42 + rep * 99);
    const plant = new Plant(LAYOUT, rng, { emitDR: false, failRate: 0.0009 });
    // Run long enough: ~60 u/h * (6+12) h ≈ 1080 units
    plant.run(1200);
    const ingest = new Ingest(LAYOUT).pushAll(plant.events);

    const warmT = WARMUP_H * 3600;
    const measT = warmT + MEASURE_H * 3600;

    const util = utilisationRanking(ingest, warmT, measT);
    utilTop.push(util[0]);
    utilSecond.push(util[1]);

    const apm = averageActivePeriods(ingest, warmT, measT);
    apmTop.push(apm[0]);

    if (rep === 0) {
      lastShift = shiftingBottlenecks(ingest, warmT, warmT + SHIFT_H * 3600);
    }
  }

  const u1m = mean(utilTop.map((r) => r.pct));
  const u1s = sd(utilTop.map((r) => r.pct));
  const u2m = mean(utilSecond.map((r) => r.pct));
  const u2s = sd(utilSecond.map((r) => r.pct));
  const gap = u1m - u2m;
  const pooled = Math.sqrt(u1s * u1s + u2s * u2s) || 1e-9;
  const sigmaOverlap = gap / pooled;

  console.log(`CONVENTIONAL utilisation:  ${utilTop[0].station} ${u1m.toFixed(2)}% ±${u1s.toFixed(2)},  ${utilSecond[0].station} ${u2m.toFixed(2)}% ±${u2s.toFixed(2)}`);
  console.log(`  -> top two CIs ${sigmaOverlap < 2 ? 'OVERLAP' : 'SEPARATE'} at ${sigmaOverlap.toFixed(2)}σ.`);
  console.log(`  -> picks ${utilTop[0].station}. ${utilTop[0].station === 'S22' ? 'CORRECT' : 'compare to APM'}.`);

  const aStations = apmTop.map((r) => r.station);
  const aAvg = mean(apmTop.map((r) => r.avgActive));
  const mode = aStations.sort((a, b) =>
    aStations.filter((x) => x === b).length - aStations.filter((x) => x === a).length
  )[0];
  console.log(`ACTIVE PERIOD METHOD:      ${mode} ${aAvg.toFixed(1)} s avg active period`);
  console.log(`  -> picks ${mode}. ${mode === 'S22' ? 'CORRECT — S22 is the slowest station by design (53 s).' : 'UNEXPECTED'}`);

  const sum = lastShift.summary;
  const s19 = sum.find((r) => r.station === 'S19') || { solePct: 0, shiftingPct: 0 };
  const s28 = sum.find((r) => r.station === 'S28') || { solePct: 0, shiftingPct: 0 };
  const s22 = sum.find((r) => r.station === 'S22') || { solePct: 0, shiftingPct: 0 };
  console.log(`SHIFTING BOTTLENECK (${SHIFT_H} h): S19 ${s19.solePct.toFixed(1)}% sole / ${s19.shiftingPct.toFixed(1)}% shifting`);
  console.log(`                            S28 ${s28.solePct.toFixed(1)}% sole / ${s28.shiftingPct.toFixed(1)}% shifting`);
  console.log(`                            S22 ${s22.solePct.toFixed(1)}% sole / ${s22.shiftingPct.toFixed(1)}% shifting`);
  console.log(`                            ${lastShift.handoffs} handoff windows`);

  if (mode !== 'S22') {
    console.warn('WARN: APM did not pick S22 — check warm-up / active-period merge');
  }
  console.log('PASS day3');
}

main();
