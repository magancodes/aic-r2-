'use strict';

const { SerialLine } = require('../lib/serialline');
const { LAYOUT } = require('./layout');
const { Degradation } = require('./degradation');
const { synthesizeDR } = require('./weld');

/**
 * Synthetic factory. Knows everything. Emits ~200-byte events.
 * Twin must never import this module.
 */
class Plant {
  constructor(config, rng, opts = {}) {
    this.layout = config || LAYOUT;
    this.rng = rng;
    this.bufferCap = opts.bufferCap != null ? opts.bufferCap : this.layout.bufferCap;
    this.failRate = opts.failRate != null ? opts.failRate : 0.0009;
    this.mttrMean = opts.mttrMean != null ? opts.mttrMean : 165;
    this.inspectSensitivity = opts.inspectSensitivity != null ? opts.inspectSensitivity : 0.90;
    this.emitDR = opts.emitDR !== false;
    // Optional allow-list: only these stations emit DR curves (harness speed).
    this.emitDRStations = opts.emitDRStations
      ? new Set(opts.emitDRStations)
      : null;
    this.fullTruth = opts.fullTruth !== false;
    this.releaseEvery = opts.releaseEvery != null ? opts.releaseEvery : this.layout.targetTakt;

    this.deg = new Degradation(this.layout, rng, opts);
    this.events = [];
    this.groundTruth = [];
    this.completed = 0;
    this.t = 0;
    this._unitDefects = new Map(); // unit -> [{station, spot, gun, nugget}]
    this._faultUntil = new Array(this.layout.n).fill(0);
    this._stats = {
      welds: 0,
      defects: 0,
      caught: 0,
      escaped: 0,
      darkLeaks: 0,
    };
  }

  _emit(ev) {
    const st = this.layout.stations[ev._idx != null ? ev._idx : this._idxOf(ev.s)];
    const instrumented = st ? st.instrumented : true;
    if (!instrumented) {
      // Dark stations emit nothing
      this._stats.darkLeaks += 1; // should stay 0 — we never call _emit for dark
      return;
    }
    const { _idx, ...rest } = ev;
    this.events.push(rest);
  }

  _idxOf(id) {
    return parseInt(id.slice(1), 10) - 1;
  }

  _truth(ev) {
    if (this.fullTruth) this.groundTruth.push(ev);
  }

  _cycleTime(stationIdx, unitSeq, tNow) {
    if (tNow != null) this.t = tNow;
    const st = this.layout.stations[stationIdx];
    let ct = st.stdTime;
    // Operator / lot influence
    ct *= this.deg.cycleMul();
    // Log-normal process noise, modest CV — enough for bottleneck migration
    ct = this.rng.lognormal(ct, 0.055);
    // Fault downtime absorbed into cycle if mid-repair
    if (this.t < this._faultUntil[stationIdx]) {
      ct += this._faultUntil[stationIdx] - this.t;
    } else if (this.rng.bernoulli(this.failRate)) {
      const mttr = this.rng.lognormal(this.mttrMean, 0.35);
      this._faultUntil[stationIdx] = this.t + mttr;
      if (st.instrumented) {
        this.events.push({ s: st.id, t: this.t, e: 'fault' });
      }
      this._truth({ e: 'fault_hidden', s: st.id, t: this.t, mttr });
      ct += mttr;
    }
    if (this._ctHook) ct = this._ctHook(stationIdx, unitSeq, ct, this.t);
    return ct;
  }

  _onStart(stationIdx, unitId, t) {
    this.t = t;
    const st = this.layout.stations[stationIdx];
    if (stationIdx === 0) this.deg.onUnitStart(unitId);
    if (st.instrumented) {
      this._emit({ s: st.id, t, e: 'start', u: unitId, _idx: stationIdx });
    }
  }

  _onEnd(stationIdx, unitId, t, dur) {
    this.t = t;
    const st = this.layout.stations[stationIdx];
    if (st.instrumented) {
      this._emit({ s: st.id, t, e: 'end', u: unitId, _idx: stationIdx });
    }

    // Welds
    if (st.weld) {
      const { spots } = st.weld;
      for (let spot = 0; spot < spots; spot++) {
        const meta = this.deg.weld(st.id, spot, unitId);
        this._stats.welds += 1;
        if (meta.defect) {
          this._stats.defects += 1;
          if (!this._unitDefects.has(unitId)) this._unitDefects.set(unitId, []);
          this._unitDefects.get(unitId).push({
            station: st.id, spot, gun: meta.gun, nugget: meta.nugget, t,
          });
          this._truth({
            e: 'defect_created',
            s: st.id,
            t,
            u: unitId,
            spot,
            gun: meta.gun,
            nugget: meta.nugget,
            tipRatio: meta.tipRatio,
            accelerated: meta.accelerated,
          });
        }
        if (
          st.instrumented &&
          this.emitDR &&
          (!this.emitDRStations || this.emitDRStations.has(st.id))
        ) {
          const dr = synthesizeDR(this.rng, meta.tipRatio, meta.fitUp, 1.8);
          this._emit({
            s: st.id, t, e: 'weld', u: unitId, spot, dr, _idx: stationIdx,
          });
        }
      }
    }

    // Bolts
    if (st.bolt && st.bolt.bolts > 0 && st.instrumented) {
      for (let b = 0; b < st.bolt.bolts; b++) {
        const nm = this.rng.normal(100, 3.5);
        const ang = this.rng.normal(30, 4);
        this._emit({ s: st.id, t, e: 'bolt', u: unitId, b, nm, ang, _idx: stationIdx });
      }
    }

    // Audit
    if (st.audit) {
      const defs = this._unitDefects.get(unitId) || [];
      const weldDefs = defs.filter(() => true);
      if (weldDefs.length > 0) {
        // Each defect independently caught with sensitivity
        let caught = false;
        for (const d of weldDefs) {
          if (this.rng.bernoulli(this.inspectSensitivity)) {
            caught = true;
            this._stats.caught += 1;
            this._truth({ e: 'defect_caught', u: unitId, t, origin: d.station, spot: d.spot });
          } else {
            this._stats.escaped += 1;
            this._truth({ e: 'defect_escaped', u: unitId, t, origin: d.station, spot: d.spot });
          }
        }
        if (caught && st.instrumented) {
          this._emit({
            s: st.id, t, e: 'reject', u: unitId, kind: 'weld', origin_unknown: true, _idx: stationIdx,
          });
        }
      }
    }
  }

  _onComplete(unitId, t) {
    this.t = t;
    this.completed += 1;
    this._truth({ e: 'unit_complete', u: unitId, t });
  }

  run(units) {
    const self = this;
    const line = new SerialLine(
      { n: this.layout.n, bufferCap: this.bufferCap },
      (idx, u) => self._cycleTime(idx, u),
      {
        onStart: (i, u, t) => self._onStart(i, u, t),
        onEnd: (i, u, t, d) => self._onEnd(i, u, t, d),
        onComplete: (u, t) => self._onComplete(u, t),
        releaseEvery: this.releaseEvery,
      }
    );
    const result = line.run(units);
    this.t = result.t;
    this.completed = result.completed;
    this._lastState = result.state();
    return this;
  }

  /** Continue from current state (for streaming / injection experiments). */
  runMore(units) {
    const self = this;
    const line = new SerialLine(
      { n: this.layout.n, bufferCap: this.bufferCap },
      (idx, u) => self._cycleTime(idx, u),
      {
        onStart: (i, u, t) => self._onStart(i, u, t),
        onEnd: (i, u, t, d) => self._onEnd(i, u, t, d),
        onComplete: (u, t) => self._onComplete(u, t),
        releaseEvery: this.releaseEvery,
      }
    );
    const result = line.run(units, this._lastState || null);
    this.t = result.t;
    this.completed = result.completed;
    this._lastState = result.state();
    return this;
  }

  stats() {
    const hours = this.t / 3600;
    const throughput = hours > 0 ? this.completed / hours : 0;
    const effTakt = this.completed > 1 ? this.t / this.completed : null;
    return {
      t: this.t,
      completed: this.completed,
      throughput,
      effectiveTakt: effTakt,
      welds: this._stats.welds,
      defects: this._stats.defects,
      defectRate: this._stats.welds ? this._stats.defects / this._stats.welds : 0,
      caught: this._stats.caught,
      escaped: this._stats.escaped,
      darkLeaks: this._stats.darkLeaks,
      events: this.events.length,
    };
  }
}

module.exports = { Plant };
