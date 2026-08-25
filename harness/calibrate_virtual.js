'use strict';

/**
 * Day 6 exit test: 80% credible interval coverage of true dark-station cycle times.
 * Target sentence: "the 80% band covered truth X% of the time over N runs."
 */

const fs = require('fs');
const path = require('path');
const { makeRng } = require('../lib/rng');
const { LAYOUT } = require('../plant/layout');
const { Plant } = require('../plant/kernel');
const { Ingest } = require('../twin/ingest');
const { estimateDark, valueOfInformation } = require('../twin/virtual');

function runOne(seed, units, warmT) {
  const plant = new Plant(LAYOUT, makeRng(seed), { emitDR: false, failRate: 0.0005 });
  const sums = {};
  const counts = {};
  for (const id of LAYOUT.dark) {
    sums[id] = 0;
    counts[id] = 0;
  }
  const orig = plant._cycleTime.bind(plant);
  plant._cycleTime = function (stationIdx, unitSeq, tNow) {
    const ct = orig(stationIdx, unitSeq, tNow);
    const st = this.layout.stations[stationIdx];
    if (!st.instrumented && this.t >= warmT) {
      sums[st.id] += ct;
      counts[st.id] += 1;
    }
    return ct;
  };
  plant.run(units);
  const truth = {};
  for (const id of LAYOUT.dark) {
    truth[id] = counts[id] ? sums[id] / counts[id] : null;
  }
  const ingest = new Ingest(LAYOUT).pushAll(plant.events);
  return { truth, ingest };
}

function main() {
  console.log('=== harness/calibrate_virtual.js ===');
  const N = Number(process.env.VIRT_N || 40);
  const UNITS = Number(process.env.VIRT_UNITS || 900);
  const warmT = 6 * 3600;
  const darkIds = LAYOUT.dark.slice();
  const hits = Object.fromEntries(darkIds.map((id) => [id, 0]));
  const totals = Object.fromEntries(darkIds.map((id) => [id, 0]));
  let voiTop = null;

  for (let rep = 0; rep < N; rep++) {
    const { truth, ingest } = runOne(5000 + rep * 31, UNITS, warmT);
    const { estimates } = estimateDark(LAYOUT, ingest, { sinceT: warmT });
    for (const id of darkIds) {
      const est = estimates[id];
      const truthCT = truth[id];
      if (!est || truthCT == null) continue;
      totals[id] += 1;
      if (truthCT >= est.ci80[0] && truthCT <= est.ci80[1]) hits[id] += 1;
    }
    if (rep === 0) {
      voiTop = valueOfInformation(LAYOUT, ingest, { sinceT: warmT }).slice(0, 5);
    }
    if ((rep + 1) % 10 === 0) console.log(`  rep ${rep + 1}/${N}`);
  }

  const perStation = {};
  let hitSum = 0;
  let totSum = 0;
  for (const id of darkIds) {
    const cov = totals[id] ? hits[id] / totals[id] : 0;
    perStation[id] = { coverage80: +cov.toFixed(4), hits: hits[id], n: totals[id] };
    hitSum += hits[id];
    totSum += totals[id];
  }
  const overall = totSum ? hitSum / totSum : 0;
  const out = {
    n: N,
    units: UNITS,
    overallCoverage80: +overall.toFixed(4),
    overallPct: +(100 * overall).toFixed(1),
    perStation,
    voiTop5: voiTop,
    sentence: `the 80% band covered truth ${(100 * overall).toFixed(1)}% of the time over ${N} runs`,
  };
  console.log(JSON.stringify(out, null, 2));
  fs.writeFileSync(path.join(__dirname, '..', 'results_virtual.json'), JSON.stringify(out, null, 2));
  console.log(`Day6 virtual: ${out.sentence}`);
  if (totSum < darkIds.length * N * 0.5) {
    console.error('FAIL: too few calibration observations');
    process.exit(1);
  }
}

main();
