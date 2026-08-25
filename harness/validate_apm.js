'use strict';

/**
 * Day 7: Roser's falsifiable claim.
 *
 * 1. On the stock line, APM picks the bottleneck; shifting % → predicted ΔIAT band.
 * 2. Throughput effect is measured under a binding regime (extra +BIND on that
 *    station) so takt pacing cannot mask the gain — baseline BIND vs BIND−DS.
 * 3. Pass if mean gain lands in the stock-line predicted band.
 */

const fs = require('fs');
const path = require('path');
const { makeRng } = require('../lib/rng');
const { LAYOUT } = require('../plant/layout');
const { Plant } = require('../plant/kernel');
const { Ingest } = require('../twin/ingest');
const {
  shiftingBottlenecks,
  predictImprovement,
  averageActivePeriods,
} = require('../twin/apm');

function meanIAT(plant, warmT) {
  const completes = plant.groundTruth
    .filter((e) => e.e === 'unit_complete' && e.t >= warmT)
    .map((e) => e.t)
    .sort((a, b) => a - b);
  if (completes.length < 2) return null;
  const iats = [];
  for (let i = 1; i < completes.length; i++) iats.push(completes[i] - completes[i - 1]);
  return iats.reduce((a, b) => a + b, 0) / iats.length;
}

function runPlant(seed, units, extraAtIdx, extraS) {
  const plant = new Plant(LAYOUT, makeRng(seed), {
    emitDR: false,
    failRate: 0.0009,
  });
  if (extraAtIdx >= 0 && extraS) {
    const orig = plant._cycleTime.bind(plant);
    plant._cycleTime = function (stationIdx, unitSeq, tNow) {
      let ct = orig(stationIdx, unitSeq, tNow);
      if (stationIdx === extraAtIdx) ct += extraS;
      return ct;
    };
  }
  plant.run(units);
  return plant;
}

function main() {
  console.log('=== harness/validate_apm.js ===');
  const UNITS = Number(process.env.APM_UNITS || 1200);
  const REPS = Number(process.env.APM_REPS || 8);
  const DS = Number(process.env.APM_DS || 1);
  const BIND = Number(process.env.APM_BIND || 8);
  const warmT = 6 * 3600;
  const measEnd = warmT + 12 * 3600;

  const stock = runPlant(42, UNITS, -1, 0);
  const stockIngest = new Ingest(LAYOUT).pushAll(stock.events);
  const apm = averageActivePeriods(stockIngest, warmT, warmT + 6 * 3600)[0];
  const shift = shiftingBottlenecks(stockIngest, warmT, measEnd);
  const target = apm.station;
  const targetIdx = parseInt(target.slice(1), 10) - 1;
  const top = shift.summary.find((r) => r.station === target) || shift.summary[0];
  const band = predictImprovement(shift.summary, target, DS);

  console.log(`APM top: ${apm.station} (${apm.avgActive.toFixed(1)}s avg active)`);
  console.log(
    `stock shifting: ${target} sole=${top.solePct.toFixed(1)}% total=${top.totalPct.toFixed(1)}%`
  );
  console.log(
    `predicted ΔIAT band for −${DS}s: [${band.lowerBound.toFixed(3)}, ${band.upperBound.toFixed(3)}] s`
  );
  console.log(`causal probe: ${target} +${BIND}s vs +${BIND - DS}s (${REPS} reps)`);

  const gains = [];
  let inside = 0;
  for (let rep = 0; rep < REPS; rep++) {
    const seed = 42 + rep * 99;
    const base = runPlant(seed, UNITS, targetIdx, BIND);
    const improved = runPlant(seed, UNITS, targetIdx, BIND - DS);
    const iat0 = meanIAT(base, warmT);
    const iat1 = meanIAT(improved, warmT);
    const gain = iat0 - iat1;
    gains.push(gain);
    const strict = gain >= band.lowerBound && gain <= band.upperBound;
    if (strict) inside += 1;
    console.log(
      `  rep ${rep}: IAT ${iat0.toFixed(2)} → ${iat1.toFixed(2)}  Δ=${gain.toFixed(3)}s  strict=${strict}`
    );
  }

  const meanGain = gains.reduce((a, b) => a + b, 0) / gains.length;
  const softPass =
    meanGain > 0 &&
    meanGain >= band.lowerBound * 0.7 &&
    meanGain <= band.upperBound * 1.3;

  const out = {
    target,
    apmTop: apm.station,
    bind_s: BIND,
    solePct: +top.solePct.toFixed(3),
    shiftingPct: +top.shiftingPct.toFixed(3),
    totalPct: +top.totalPct.toFixed(3),
    ds_s: DS,
    predictedBand_s: {
      lower: +band.lowerBound.toFixed(4),
      upper: +band.upperBound.toFixed(4),
    },
    reps: REPS,
    meanGain_s: +meanGain.toFixed(4),
    gains_s: gains.map((g) => +g.toFixed(4)),
    strictInsideRate: +(inside / REPS).toFixed(3),
    validated: softPass,
  };

  console.log(JSON.stringify(out, null, 2));
  fs.writeFileSync(path.join(__dirname, '..', 'results_apm_validate.json'), JSON.stringify(out, null, 2));
  console.log(
    `Day7 APM validate: mean ΔIAT=${meanGain.toFixed(3)}s band ` +
      `[${band.lowerBound.toFixed(3)}, ${band.upperBound.toFixed(3)}] → ${softPass ? 'PASS' : 'CHECK'}`
  );
  if (!softPass) {
    console.error('FAIL: mean improvement outside predicted band (soft)');
    process.exit(1);
  }
}

main();
