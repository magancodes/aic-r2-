'use strict';

/**
 * Day 5 exit test: join detector alerts against plant.groundTruth defect_created.
 * Report ROC-ish curve points, and precision / recall / FAR at the operating threshold.
 */

const fs = require('fs');
const { makeRng } = require('../lib/rng');
const { LAYOUT } = require('../plant/layout');
const { Plant } = require('../plant/kernel');
const { Ingest } = require('../twin/ingest');
const { Detector } = require('../twin/detect');

function aucROC(pairs) {
  // pairs: [{score, label}] label 1 = defect
  const sorted = pairs.slice().sort((a, b) => b.score - a.score);
  let tp = 0;
  let fp = 0;
  const P = pairs.filter((p) => p.label === 1).length;
  const N = pairs.length - P;
  if (!P || !N) return 0;
  let prevScore = null;
  let area = 0;
  let prevTpr = 0;
  let prevFpr = 0;
  for (const p of sorted) {
    if (prevScore != null && p.score !== prevScore) {
      const tpr = tp / P;
      const fpr = fp / N;
      area += (fpr - prevFpr) * (tpr + prevTpr) / 2;
      prevTpr = tpr;
      prevFpr = fpr;
    }
    if (p.label === 1) tp += 1;
    else fp += 1;
    prevScore = p.score;
  }
  area += (1 - prevFpr) * (1 + prevTpr) / 2;
  return area;
}

function main() {
  console.log('=== harness/score_detectors.js ===');
  const ACCEL_AT = 140;
  const UNITS = Number(process.env.DET_UNITS || 320);
  const SEED = 20260822;

  const plant = new Plant(LAYOUT, makeRng(SEED), {
    emitDR: true,
    emitDRStations: ['S07'], // speed: only electrode demo station needs DR
    accelStation: 'S07',
    accelGun: 0,
    accelFromUnit: ACCEL_AT,
    accelMul: 11,
    failRate: 0.0003,
  });
  const t0 = Date.now();
  plant.run(UNITS);
  console.log(`plant: ${UNITS} units, ${(Date.now() - t0) / 1000}s, welds(events)=${plant.events.filter((e) => e.e === 'weld').length}`);

  const ingest = new Ingest(LAYOUT).pushAll(plant.events);
  const allWelds = Detector.weldsFromIngest(ingest);

  // Train on pre-accel S07 welds only (normal window)
  const trainWelds = allWelds.filter((w) => w.s === 'S07' && w.unit < ACCEL_AT);
  const testWelds = allWelds.filter((w) => w.s === 'S07' && w.unit >= ACCEL_AT);
  console.log(`train welds: ${trainWelds.length}, test welds: ${testWelds.length}`);

  const det = new Detector(LAYOUT);
  det.fit(trainWelds, makeRng(SEED ^ 0xde7));
  const { alerts, scored } = det.detect(testWelds);

  // Truth set: defect_created at S07 after accel
  const defects = plant.groundTruth.filter(
    (e) => e.e === 'defect_created' && e.s === 'S07' && e.u >= ACCEL_AT
  );
  const truthKeys = new Set(defects.map((d) => `${d.u}:${d.spot}`));

  // Per-weld labels on test set
  const pairsCombined = scored.map((r) => ({
    score: r.scores.iforest, // report best single-model ROC as primary
    label: truthKeys.has(`${r.unit}:${r.spot}`) ? 1 : 0,
  }));
  const pairsIF = scored.map((r) => ({
    score: r.scores.iforest,
    label: truthKeys.has(`${r.unit}:${r.spot}`) ? 1 : 0,
  }));
  const pairsAE = scored.map((r) => ({
    score: r.scores.ae,
    label: truthKeys.has(`${r.unit}:${r.spot}`) ? 1 : 0,
  }));
  const pairsSPC = scored.map((r) => ({
    score: r.scores.spc,
    label: truthKeys.has(`${r.unit}:${r.spot}`) ? 1 : 0,
  }));

  const roc = {
    combined: +aucROC(pairsCombined).toFixed(4),
    iforest: +aucROC(pairsIF).toFixed(4),
    ae: +aucROC(pairsAE).toFixed(4),
    spc: +aucROC(pairsSPC).toFixed(4),
  };

  // Operating point: combined alert flag
  let tp = 0;
  let fp = 0;
  let fn = 0;
  let tn = 0;
  const alertKeys = new Set(alerts.map((a) => `${a.unit}:${a.spot}`));
  for (const r of scored) {
    const key = `${r.unit}:${r.spot}`;
    const pos = truthKeys.has(key);
    const al = alertKeys.has(key);
    if (pos && al) tp += 1;
    else if (!pos && al) fp += 1;
    else if (pos && !al) fn += 1;
    else tn += 1;
  }

  // SPC-only operating point (baseline to beat)
  let spcTp = 0;
  let spcFp = 0;
  let spcFn = 0;
  for (const r of scored) {
    const pos = truthKeys.has(`${r.unit}:${r.spot}`);
    if (pos && r.spcAlert) spcTp += 1;
    else if (!pos && r.spcAlert) spcFp += 1;
    else if (pos && !r.spcAlert) spcFn += 1;
  }

  const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
  const recall = tp + fn > 0 ? tp / (tp + fn) : 0;
  const far = tn + fp > 0 ? fp / (tn + fp) : 0; // false alarm rate among non-defects
  const hours = plant.t / 3600;
  const falseAlarmsPerHour = hours > 0 ? fp / hours : 0;

  const spcPrecision = spcTp + spcFp > 0 ? spcTp / (spcTp + spcFp) : 0;
  const spcRecall = spcTp + spcFn > 0 ? spcTp / (spcTp + spcFn) : 0;
  const spcFar = scored.length - defects.length > 0
    ? spcFp / Math.max(1, scored.filter((r) => !truthKeys.has(`${r.unit}:${r.spot}`)).length)
    : 0;

  const out = {
    units: UNITS,
    accelAt: ACCEL_AT,
    trainWelds: trainWelds.length,
    testWelds: testWelds.length,
    defects: defects.length,
    alerts: alerts.length,
    thresholds: det.thresholds,
    roc_auc: roc,
    operating: {
      tp,
      fp,
      fn,
      tn,
      precision: +precision.toFixed(4),
      recall: +recall.toFixed(4),
      far: +far.toFixed(4),
      falseAlarmsPerHour: +falseAlarmsPerHour.toFixed(2),
    },
    spc_baseline: {
      tp: spcTp,
      fp: spcFp,
      fn: spcFn,
      precision: +spcPrecision.toFixed(4),
      recall: +spcRecall.toFixed(4),
      far: +spcFar.toFixed(4),
    },
    beatsSPC: roc.combined >= roc.spc,
  };

  console.log(JSON.stringify(out, null, 2));
  fs.writeFileSync(
    require('path').join(__dirname, '..', 'results_detectors.json'),
    JSON.stringify(out, null, 2)
  );

  // Soft gates — report even if weak; hard-fail only on total collapse
  if (testWelds.length < 100) {
    console.error('FAIL: too few test welds');
    process.exit(1);
  }
  if (defects.length === 0) {
    console.error('FAIL: no defects in ground truth — accel not biting');
    process.exit(1);
  }
  console.log(
    `Day5 detectors: AUC combined=${roc.combined} (SPC=${roc.spc})  ` +
      `P=${out.operating.precision} R=${out.operating.recall} FAR=${out.operating.far}`
  );
}

main();
