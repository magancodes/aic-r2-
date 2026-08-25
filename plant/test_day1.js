'use strict';

const { makeRng } = require('../plant/rng');
const { LAYOUT } = require('../plant/layout');
const { Plant } = require('../plant/kernel');

function assert(cond, msg) {
  if (!cond) throw new Error('ASSERT: ' + msg);
}

function main() {
  console.log('=== plant/test_day1.js ===');
  const rng = makeRng(20260822);
  const plant = new Plant(LAYOUT, rng, { emitDR: false, fullTruth: true });
  const t0 = Date.now();
  plant.run(1000);
  const ms = Date.now() - t0;
  const s = plant.stats();

  console.log(`Throughput          ${s.throughput.toFixed(2)} units/h`);
  console.log(`Effective takt      ${s.effectiveTakt.toFixed(2)} s (target ${LAYOUT.targetTakt} s)`);
  console.log(`Welds placed        ${s.welds}`);
  console.log(`Weld defect rate    ${(100 * s.defectRate).toFixed(3)} %`);
  console.log(`Caught / escaped    ${s.caught} / ${s.escaped}`);
  console.log(`Dark station leaks  ${s.darkLeaks}`);
  console.log(`Runtime             ${(ms / 1000).toFixed(2)} s`);

  // Reproducibility
  const rng2 = makeRng(20260822);
  const plant2 = new Plant(LAYOUT, rng2, { emitDR: false, fullTruth: true });
  plant2.run(1000);
  const s2 = plant2.stats();
  assert(s.completed === s2.completed, 'reproducible completed');
  assert(Math.abs(s.t - s2.t) < 1e-6, 'reproducible t');
  assert(s.welds === s2.welds, 'reproducible welds');
  console.log('Reproducible from seed  yes');

  // Intra-shift takt drift after warm-up (exclude first 6 h)
  const warmT = 6 * 3600;
  const post = plant.groundTruth.filter((e) => e.e === 'unit_complete' && e.t >= warmT);
  const mid = warmT + (s.t - warmT) / 2;
  const first = post.filter((e) => e.t <= mid).length;
  const second = post.filter((e) => e.t > mid).length;
  const drift = Math.abs(first - second) / Math.max(first, second, 1);
  console.log(`Intra-shift takt drift ${(100 * drift).toFixed(2)} % — post warm-up`);

  assert(s.completed === 1000, 'completed 1000');
  assert(s.darkLeaks === 0, 'no dark leaks');
  // 701 spots/unit; run leaves ~WIP so total welds ≥ 701000
  assert(s.welds >= 701000, `welds=${s.welds} expected >= 701000`);
  assert(s.welds / s.completed > 700 && s.welds / s.completed < 760, `welds/unit ${s.welds / s.completed}`);
  assert(s.defectRate > 0.001 && s.defectRate < 0.01, `defect rate ${s.defectRate}`);
  assert(s.throughput > 40 && s.throughput < 80, `throughput ${s.throughput}`);
  assert(drift < 0.05, `drift too high ${drift}`);

  // No events from dark stations
  const dark = new Set(LAYOUT.dark);
  for (const ev of plant.events) {
    assert(!dark.has(ev.s), 'dark station leaked event ' + ev.s);
  }

  console.log('PASS day1');
  return s;
}

main();
