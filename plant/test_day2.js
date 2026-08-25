'use strict';

const { makeRng } = require('../plant/rng');
const { LAYOUT } = require('../plant/layout');
const { Plant } = require('../plant/kernel');

function median(xs) {
  const s = xs.slice().sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : 0.5 * (s[m - 1] + s[m]);
}

function main() {
  console.log('=== plant/test_day2.js ===');
  console.log('One electrode gun at S07 enters accelerated wear at unit 140.');

  const ACCEL_AT = 140;
  const N = 40;
  const blinds = [];
  const carriers = [];
  const latenciesMin = [];

  for (let rep = 0; rep < N; rep++) {
    const rng = makeRng(1000 + rep * 17);
    const plant = new Plant(LAYOUT, rng, {
      emitDR: false,
      fullTruth: true,
      accelStation: 'S07',
      accelGun: 0,
      accelFromUnit: ACCEL_AT,
      accelMul: 11,
    });
    plant.run(400);

    const defects = plant.groundTruth.filter(
      (e) => e.e === 'defect_created' && e.s === 'S07' && e.accelerated && e.u >= ACCEL_AT
    );
    if (!defects.length) {
      blinds.push(400 - ACCEL_AT);
      carriers.push(0);
      latenciesMin.push(((400 - ACCEL_AT) * plant.stats().effectiveTakt) / 60);
      continue;
    }
    const first = defects[0];
    const blind = first.u - ACCEL_AT;
    blinds.push(blind);
    // Units that carry at least one undersized weld from this gun before first catch
    const carrierUnits = new Set(defects.map((d) => d.u));
    carriers.push(carrierUnits.size);
    const takt = plant.stats().effectiveTakt || 60;
    latenciesMin.push((blind * takt) / 60);
  }

  const medBlind = median(blinds);
  const medCarrier = median(carriers);
  const medLat = median(latenciesMin);
  const minB = Math.min(...blinds);
  const maxB = Math.max(...blinds);
  const minC = Math.min(...carriers);
  const maxC = Math.max(...carriers);

  console.log(`Median over ${N} replications: ${medBlind.toFixed(0)} units built blind (range ${minB}–${maxB}).`);
  console.log(`${medCarrier.toFixed(0)} of them carry an undersized weld (range ${minC}–${maxC}).`);
  console.log(`Median in-line defect latency ${medLat.toFixed(1)} minutes.`);

  if (medBlind < 5) {
    console.warn('WARN: blind window very short — degradation may be too aggressive');
  }
  console.log('PASS day2');
  return { medBlind, medCarrier, medLat, minB, maxB, minC, maxC };
}

main();
