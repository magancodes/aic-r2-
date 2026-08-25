'use strict';

/**
 * Pure serial-line mechanics: buffers, blocking, starving, settle loop.
 * Parameterised by cycleTimeFn(stationIdx, unitSeq) -> seconds.
 *
 * Optional takt-paced release (releaseEvery): source may not flood the line.
 * Shared by plant/ (true CT) and twin/ (posterior predictive samples).
 */

class SerialLine {
  /**
   * @param {{n:number, bufferCap?:number}} topology
   * @param {(stationIdx:number, unitSeq:number)=>number} cycleTimeFn
   * @param {object} [opts]
   */
  constructor(topology, cycleTimeFn, opts = {}) {
    this.n = topology.n;
    this.bufferCap = topology.bufferCap != null ? topology.bufferCap : 4;
    this.cycleTimeFn = cycleTimeFn;
    this.onStart = opts.onStart || null;
    this.onEnd = opts.onEnd || null;
    this.onComplete = opts.onComplete || null;
    this.releaseEvery = opts.releaseEvery != null ? opts.releaseEvery : 0; // 0 = as-fast-as-possible
  }

  run(units, seedState = null) {
    const n = this.n;
    const cap = this.bufferCap;
    const releaseEvery = this.releaseEvery;

    const bufQ = seedState && seedState.bufQ
      ? seedState.bufQ.map((q) => q.slice())
      : Array.from({ length: n }, () => []);
    const busy = seedState && seedState.busy
      ? seedState.busy.slice()
      : new Array(n).fill(false);
    const unitAt = seedState && seedState.unitAt
      ? seedState.unitAt.slice()
      : new Array(n).fill(null);
    const finishAt = seedState && seedState.finishAt
      ? seedState.finishAt.slice()
      : new Array(n).fill(Infinity);
    const startedAt = seedState && seedState.startedAt
      ? seedState.startedAt.slice()
      : new Array(n).fill(0);

    let t = seedState && seedState.t != null ? seedState.t : 0;
    let nextUnit = seedState && seedState.nextUnit != null ? seedState.nextUnit : 1;
    let completed = seedState && seedState.completed != null ? seedState.completed : 0;
    let nextReleaseAt = seedState && seedState.nextReleaseAt != null ? seedState.nextReleaseAt : 0;
    const target = completed + units;
    const cycles = [];

    const startStation = (i, u) => {
      busy[i] = true;
      unitAt[i] = u;
      const dur = this.cycleTimeFn(i, u, t);
      startedAt[i] = t;
      finishAt[i] = t + Math.max(0.01, dur);
      if (this.onStart) this.onStart(i, u, t);
    };

    const wipCount = () =>
      busy.reduce((a, b) => a + (b ? 1 : 0), 0) +
      bufQ.reduce((a, q) => a + q.length, 0);

    const canRelease = () => {
      if (completed >= target) return false;
      if (releaseEvery > 0 && t < nextReleaseAt) return false;
      return true;
    };

    const settle = () => {
      let changed = true;
      let guard = 0;
      while (changed && guard++ < n * 6) {
        changed = false;

        for (let i = n - 1; i >= 0; i--) {
          if (!busy[i] || t < finishAt[i]) continue;
          if (i < n - 1 && bufQ[i + 1].length >= cap) continue;

          const u = unitAt[i];
          const dur = finishAt[i] - startedAt[i];
          cycles.push({ station: i, start: startedAt[i], end: t, unit: u, dur });
          if (this.onEnd) this.onEnd(i, u, t, t - startedAt[i]);
          busy[i] = false;
          unitAt[i] = null;
          finishAt[i] = Infinity;

          if (i === n - 1) {
            completed += 1;
            if (this.onComplete) this.onComplete(u, t);
          } else {
            bufQ[i + 1].push(u);
          }
          changed = true;
        }

        for (let i = 0; i < n; i++) {
          if (busy[i]) continue;
          if (i === 0) {
            if (!canRelease()) continue;
            const u = nextUnit++;
            if (releaseEvery > 0) nextReleaseAt = t + releaseEvery;
            startStation(i, u);
            changed = true;
          } else if (bufQ[i].length > 0) {
            const u = bufQ[i].shift();
            startStation(i, u);
            changed = true;
          }
        }
      }
    };

    settle();

    let steps = 0;
    const maxSteps = Math.max(2e7, units * n * 80);

    while (completed < target) {
      if (++steps > maxSteps) {
        throw new Error(`SerialLine deadlock at t=${t} completed=${completed}/${target} wip=${wipCount()}`);
      }

      let nextT = Infinity;

      // Processing finishes
      for (let i = 0; i < n; i++) {
        if (!busy[i]) continue;
        if (finishAt[i] > t) nextT = Math.min(nextT, finishAt[i]);
        else if (i === n - 1 || bufQ[i + 1].length < cap) nextT = Math.min(nextT, t);
      }

      // Takt release
      if (releaseEvery > 0 && !busy[0] && completed < target) {
        if (nextReleaseAt > t) nextT = Math.min(nextT, nextReleaseAt);
        else nextT = Math.min(nextT, t);
      }

      if (nextT === Infinity) {
        for (let i = 0; i < n; i++) {
          if (busy[i]) nextT = Math.min(nextT, Math.max(finishAt[i], t + 1e-9));
        }
        if (nextT === Infinity && completed < target) {
          if (releaseEvery > 0) nextT = Math.max(nextReleaseAt, t + releaseEvery);
          else {
            const u = nextUnit++;
            startStation(0, u);
            continue;
          }
        }
      }

      if (nextT > t) t = nextT;
      settle();
    }

    const buffers = bufQ.map((q) => q.length);
    return {
      t,
      completed,
      buffers,
      bufQ: bufQ.map((q) => q.slice()),
      busy: busy.slice(),
      unitAt: unitAt.slice(),
      finishAt: finishAt.slice(),
      startedAt: startedAt.slice(),
      nextUnit,
      nextReleaseAt,
      cycles,
      state() {
        return {
          t,
          completed,
          nextUnit,
          nextReleaseAt,
          buffers: buffers.slice(),
          bufQ: bufQ.map((q) => q.slice()),
          busy: busy.slice(),
          unitAt: unitAt.slice(),
          finishAt: finishAt.slice(),
          startedAt: startedAt.slice(),
        };
      },
    };
  }
}

module.exports = { SerialLine };
