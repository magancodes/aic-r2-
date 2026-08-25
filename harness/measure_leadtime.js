'use strict';

/**
 * Day 4 exit test: inject a known slowdown, measure delay until forecast flags it.
 * Report the full distribution across seeds (default 40; set LEAD_N=200 for paper).
 */

const fs = require('fs');
const path = require('path');
const { makeRng } = require('../lib/rng');
const { LAYOUT } = require('../plant/layout');
const { Plant } = require('../plant/kernel');
const { Ingest } = require('../twin/ingest');
const { Belief } = require('../twin/belief');
const { forecastBottleneck, flagBottlenecks } = require('../twin/forecast');

function percentile(xs, p) {
  const s = xs.slice().sort((a, b) => a - b);
  const idx = (s.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return s[lo];
  return s[lo] + (s[hi] - s[lo]) * (idx - lo);
}

function main() {
  console.log('=== harness/measure_leadtime.js ===');
  const TARGET = 'S25';
  const SLOW_MUL = 1.8;
  const INJECT_AFTER_UNITS = 350;
  const THRESHOLD = 0.18;
  const N = parseInt(process.env.LEAD_N || '40', 10);
  const maxLook = 40 * 60; // seconds
  const leads = [];
  let censored = 0;

  for (let seed = 0; seed < N; seed++) {
    const rng = makeRng(5000 + seed * 13);
    const plant = new Plant(LAYOUT, rng, { emitDR: false, failRate: 0.0003 });
    const targetIdx = parseInt(TARGET.slice(1), 10) - 1;
    let injectT = null;

    plant._ctHook = (stationIdx, unitSeq, ct, t) => {
      if (plant.completed >= INJECT_AFTER_UNITS && stationIdx === targetIdx) {
        if (injectT == null) injectT = t;
        return ct * SLOW_MUL;
      }
      return ct;
    };

    plant.run(INJECT_AFTER_UNITS);
    let guard = 0;
    while (injectT == null && guard++ < 50) plant.runMore(5);
    if (injectT == null) {
      censored += 1;
      leads.push(maxLook);
      continue;
    }

    let flaggedAt = null;
    while (plant.t < injectT + maxLook) {
      plant.runMore(8);

      const ingest = new Ingest(LAYOUT).pushAll(plant.events);
      const since = Math.max(0, plant.t - 20 * 60);
      const belief = new Belief(LAYOUT).updateFromIngest(ingest, since);

      const fc = forecastBottleneck({
        layout: LAYOUT,
        ingest,
        belief,
        tNow: plant.t,
        horizonSec: 15 * 60,
        rollouts: 48,
        seed: 9000 + seed,
      });

      const flags = flagBottlenecks(fc, THRESHOLD);
      const top = fc.probs[0];
      const hit =
        flags.some((f) => f.station === TARGET) ||
        (top && top.station === TARGET && top.p >= 0.12);

      if (hit) {
        flaggedAt = plant.t;
        break;
      }
    }

    if (flaggedAt == null) {
      censored += 1;
      leads.push(maxLook);
    } else {
      leads.push(Math.max(0, flaggedAt - injectT));
    }

    if ((seed + 1) % 5 === 0) {
      const last = leads[leads.length - 1] / 60;
      process.stdout.write(`  … ${seed + 1}/${N} last=${last.toFixed(1)} min\n`);
    }
  }

  const leadsMin = leads.map((s) => s / 60);
  const med = percentile(leadsMin, 0.5);
  const p10 = percentile(leadsMin, 0.1);
  const p90 = percentile(leadsMin, 0.9);
  const mean = leadsMin.reduce((a, b) => a + b, 0) / leadsMin.length;

  console.log(`Seeds: ${N}, censored: ${censored}`);
  console.log(
    `Lead time (min): mean=${mean.toFixed(2)}  p10=${p10.toFixed(2)}  median=${med.toFixed(2)}  p90=${p90.toFixed(2)}`
  );
  console.log(`Full distribution (min): ${leadsMin.map((x) => x.toFixed(1)).join(', ')}`);
  console.log('PASS measure_leadtime');

  const out = {
    n: N,
    target: TARGET,
    slowMul: SLOW_MUL,
    threshold: THRESHOLD,
    leadsSec: leads,
    leadsMin,
    meanMin: mean,
    p10Min: p10,
    medianMin: med,
    p90Min: p90,
    censored,
  };
  fs.writeFileSync(path.join(__dirname, '..', 'results_leadtime.json'), JSON.stringify(out, null, 2));
  return out;
}

main();
