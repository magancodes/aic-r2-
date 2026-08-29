'use strict';

const { SerialLine } = require('../lib/serialline');
const { makeRng } = require('../lib/rng');

/**
 * Monte-Carlo bottleneck forecast on lib/serialline.js.
 * Cycle times are drawn from the belief's posterior predictive ONLY — no plant
 * ground truth is ever read here.
 *
 * Each rollout simulates the line forward across the horizon; once per unit
 * completed we take the momentary bottleneck — the busy station whose operation
 * currently in progress has run the longest. Over a short horizon that is the
 * station holding up flow the most (a slowed station shows the longest ongoing
 * cycle), which is exactly the signal Day 4 needs. The forecast for a station
 * is the fraction of sampled instants, across all rollouts, at which it led.
 */

/**
 * Seed a warm line state for a rollout from what the twin can observe.
 *
 * Instrumented stations that are mid-cycle at tNow are seeded busy with their
 * real remaining time (from the observed start/end pair straddling tNow).
 * Buffer levels are unobservable for dark stations, so every internal buffer is
 * given the same neutral warm fill — a deliberately simple prior whose effect
 * washes out within the first minute of a multi-minute horizon, since which
 * station is the bottleneck is driven by the cycle-time posteriors, not by
 * transient WIP.
 */
function reconstructState(layout, ingest, tNow, warmFill = 2) {
  const n = layout.n;
  const bufQ = Array.from({ length: n }, () => []);
  const busy = new Array(n).fill(false);
  const unitAt = new Array(n).fill(null);
  const finishAt = new Array(n).fill(Infinity);
  const startedAt = new Array(n).fill(0);

  let maxU = 0;
  for (const id of ingest.observedStations()) {
    for (const c of ingest.cycles.get(id) || []) {
      if (c.unit > maxU) maxU = c.unit;
      if (c.start <= tNow && tNow < c.end) {
        const idx = layout.station(id).idx;
        busy[idx] = true;
        unitAt[idx] = c.unit;
        startedAt[idx] = c.start;
        finishAt[idx] = tNow + Math.max(0.01, c.end - tNow);
      }
    }
  }

  let phantom = maxU + 1;
  const fill = Math.min(layout.bufferCap, warmFill);
  for (let i = 1; i < n; i++) {
    for (let k = 0; k < fill; k++) bufQ[i].push(phantom++);
  }

  return {
    t: tNow,
    completed: 0,
    nextUnit: phantom,
    bufQ,
    busy,
    unitAt,
    finishAt,
    startedAt,
    nextReleaseAt: tNow,
  };
}

/**
 * Momentary bottleneck at instant t from a live busy/startedAt snapshot: the
 * busy station whose current operation has been running longest. The true
 * constraint is never starved and never blocked, so it is the station most
 * often mid-operation — and a slowed station shows the longest ongoing cycle.
 */
function momentaryBottleneck(busy, startedAt, t) {
  let best = -1;
  let bestElapsed = -1;
  for (let i = 0; i < busy.length; i++) {
    if (!busy[i]) continue;
    const elapsed = t - startedAt[i];
    if (elapsed > bestElapsed) {
      bestElapsed = elapsed;
      best = i;
    }
  }
  return best;
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
  } = opts;

  const counts = new Array(layout.n).fill(0);
  let samples = 0;

  const meanCT = layout.stations.reduce((a, s) => a + s.stdTime, 0) / layout.n;
  const units = Math.max(5, Math.ceil((horizonSec / meanCT) * 1.5));

  for (let r = 0; r < rollouts; r++) {
    const rng = makeRng(seed + r * 1009);
    const cycleTimeFn = belief.makeSampler(rng, 'rolling');
    const base = reconstructState(layout, ingest, tNow);

    // Shadow the line's occupancy through callbacks and take one momentary
    // sample per unit completed — the same cadence and definition the offline
    // APM uses, without re-simulating the line slice by slice.
    const busy = base.busy.slice();
    const startedAt = base.startedAt.slice();
    // A blocked station stays busy (no onEnd) with its startedAt frozen, so its
    // elapsed keeps growing through the block — exactly how a constraint shows up.
    const line = new SerialLine(
      { n: layout.n, bufferCap: layout.bufferCap },
      cycleTimeFn,
      {
        releaseEvery: layout.targetTakt || 0,
        onStart(i, u, t) {
          busy[i] = true;
          startedAt[i] = t;
        },
        onEnd(i) {
          busy[i] = false;
        },
        onComplete(u, t) {
          const bn = momentaryBottleneck(busy, startedAt, t);
          if (bn >= 0) {
            counts[bn] += 1;
            samples += 1;
          }
        },
      }
    );
    line.run(units, base);
  }

  const probs = counts
    .map((c, i) => ({
      station: layout.stations[i].id,
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
  momentaryBottleneck,
};
