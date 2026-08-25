'use strict';

const { SerialLine } = require('../lib/serialline');
const { momentaryAt } = require('./apm');
const { makeRng } = require('../lib/rng');

/**
 * Monte Carlo rollouts on lib/serialline.js.
 * Samples cycle times from posterior predictive ONLY — no plant ground truth.
 *
 * Returns per-station probability of being the momentary bottleneck within horizon.
 */

/**
 * Reconstruct a coarse line state from ingest at time tNow.
 * Twin cannot see buffer contents of dark stations precisely; we approximate
 * from instrumented start/end imbalance (units started − units ended downstream).
 */
function reconstructState(layout, ingest, tNow, belief) {
  const n = layout.n;
  const bufQ = Array.from({ length: n }, () => []);
  const busy = new Array(n).fill(false);
  const unitAt = new Array(n).fill(null);
  const finishAt = new Array(n).fill(Infinity);
  const startedAt = new Array(n).fill(0);

  // Find max unit id observed
  let maxU = 0;
  for (const id of ingest.observedStations()) {
    for (const c of ingest.cycles.get(id) || []) {
      if (c.unit > maxU) maxU = c.unit;
      if (c.start <= tNow && tNow < c.end) {
        const idx = parseInt(id.slice(1), 10) - 1;
        busy[idx] = true;
        unitAt[idx] = c.unit;
        startedAt[idx] = c.start;
        const rem = Math.max(0.01, c.end - tNow);
        finishAt[idx] = tNow + rem;
      }
    }
  }

  // Rough WIP: place phantom units in buffers based on std fill (~half cap)
  const cap = layout.bufferCap;
  let phantom = maxU + 1;
  for (let i = 1; i < n; i++) {
    const fill = Math.min(cap, 2);
    for (let k = 0; k < fill; k++) bufQ[i].push(phantom++);
  }

  return {
    t: tNow,
    completed: 0,
    nextUnit: phantom,
    buffers: bufQ.map((q) => q.length),
    bufQ,
    busy,
    unitAt,
    finishAt,
    startedAt,
  };
}

/**
 * @param {object} opts
 * @param {object} opts.layout
 * @param {import('./ingest').Ingest} opts.ingest
 * @param {import('./belief').Belief} opts.belief
 * @param {number} opts.tNow
 * @param {number} [opts.horizonSec=1800]
 * @param {number} [opts.rollouts=200]
 * @param {number} [opts.seed=1]
 * @param {number} [opts.sampleEvery=30] seconds between momentary samples in a rollout
 */
function forecastBottleneck(opts) {
  const {
    layout,
    ingest,
    belief,
    tNow,
    horizonSec = 30 * 60,
    rollouts = 200,
    seed = 1,
    sampleEvery = 60,
  } = opts;

  const counts = new Map();
  for (const st of layout.stations) counts.set(st.id, 0);
  let samples = 0;

  const baseState = reconstructState(layout, ingest, tNow, belief);

  for (let r = 0; r < rollouts; r++) {
    const rng = makeRng(seed + r * 1009);
    const cycleTimeFn = belief.makeSampler(rng, 'rolling');

    // How many completions to cover the horizon roughly
    const meanCT = layout.stations.reduce((a, s) => a + s.stdTime, 0) / layout.n;
    const units = Math.max(5, Math.ceil((horizonSec / meanCT) * 1.5));

    const moments = [];
    const line = new SerialLine(
      { n: layout.n, bufferCap: layout.bufferCap },
      cycleTimeFn,
      {
        onEnd(i, u, t) {
          // Sample momentary bottleneck proxies: station with longest current busy elapsed
        },
      }
    );

    // Manual rollout with periodic sampling
    const state = {
      t: baseState.t,
      completed: 0,
      nextUnit: baseState.nextUnit,
      bufQ: baseState.bufQ.map((q) => q.slice()),
      busy: baseState.busy.slice(),
      unitAt: baseState.unitAt.slice(),
      finishAt: baseState.finishAt.slice(),
      startedAt: baseState.startedAt.slice(),
    };

    // Use SerialLine but sample during by running short slices
    const tEnd = tNow + horizonSec;
    let sliceState = state;
    let guard = 0;
    while (sliceState.t < tEnd && guard++ < 5000) {
      const sliceUnits = 1;
      const result = new SerialLine(
        { n: layout.n, bufferCap: layout.bufferCap },
        cycleTimeFn,
        { releaseEvery: layout.targetTakt || 0 }
      ).run(sliceUnits, {
        ...sliceState,
        bufQ: sliceState.bufQ.map((q) => q.slice()),
        busy: sliceState.busy.slice(),
        unitAt: sliceState.unitAt.slice(),
        finishAt: sliceState.finishAt.slice(),
        startedAt: sliceState.startedAt.slice(),
        completed: 0, // run() adds units completions; we use absolute target via units=1
        nextUnit: sliceState.nextUnit,
        t: sliceState.t,
      });

      // Sample which station is "momentary bottleneck": longest ongoing busy elapsed
      let best = null;
      let bestElapsed = -1;
      for (let i = 0; i < layout.n; i++) {
        if (!result.busy[i]) continue;
        const elapsed = result.t - result.startedAt[i];
        if (elapsed > bestElapsed) {
          bestElapsed = elapsed;
          best = layout.stations[i].id;
        }
      }
      if (best) {
        counts.set(best, counts.get(best) + 1);
        samples += 1;
      }

      sliceState = result.state();
      // Prevent completed from blocking further releases — reset completed counter semantics
      sliceState.completed = 0;
      if (result.t >= tEnd) break;
    }
  }

  const probs = [...counts.entries()]
    .map(([station, c]) => ({
      station,
      p: samples > 0 ? c / samples : 0,
      count: c,
    }))
    .sort((a, b) => b.p - a.p);

  return { probs, samples, rollouts, horizonSec, tNow };
}

/** Flag stations whose forecast p exceeds threshold. */
function flagBottlenecks(forecastResult, threshold = 0.25) {
  return forecastResult.probs.filter((r) => r.p >= threshold);
}

module.exports = {
  forecastBottleneck,
  flagBottlenecks,
  reconstructState,
};
