'use strict';

/**
 * HIDDEN plant physics. Twin must never import this module.
 *
 * tipRatio = 1 + residual + k·wearMul·welds^0.7
 * nugget   = 5.2·(1/tipRatio)^0.9·fitUp·(1+ε)
 * defect when nugget < 4.0 mm (4√t rule for 1 mm sheet)
 *
 * MAX_DRESSINGS / DRESS_RESIDUAL keep defect rate ~0.345 % — do not unbounded-accumulate.
 */

const MAX_DRESSINGS = 15;
const DRESS_RESIDUAL = 0.006;
const DRESS_EVERY = 80; // welds between tip dresses (per gun)
const WEAR_K = 0.000761;
const NUGGET_BASE = 5.2;
const NUGGET_THRESH = 4.0;

class Gun {
  constructor(stationId, gunIdx) {
    this.stationId = stationId;
    this.gunIdx = gunIdx;
    this.welds = 0;
    this.dressings = 0;
    this.residual = 0;
    this.wearMul = 1;
    this.accelerated = false;
    this.accelFromUnit = null;
  }

  tipRatio() {
    return 1 + this.residual + WEAR_K * this.wearMul * Math.pow(this.welds, 0.7);
  }

  recordWeld(unitSeq) {
    this.welds += 1;
    if (this.accelerated && this.accelFromUnit != null && unitSeq >= this.accelFromUnit) {
      // already set wearMul
    }
    if (this.welds > 0 && this.welds % DRESS_EVERY === 0) {
      this.dress();
    }
  }

  dress() {
    if (this.dressings >= MAX_DRESSINGS) {
      // Cap replacement — reset tip completely
      this.welds = 0;
      this.dressings = 0;
      this.residual = 0;
      this.wearMul = this.accelerated ? this.wearMul : 1;
      return;
    }
    this.dressings += 1;
    this.residual += DRESS_RESIDUAL;
    this.welds = Math.floor(this.welds * 0.15); // dressing removes most mushrooming
  }

  accelerate(fromUnit, mul) {
    this.accelerated = true;
    this.accelFromUnit = fromUnit;
    this.wearMul = mul;
  }
}

const { makeRng } = require('../lib/rng');

function hashU32(a, b, c, salt) {
  let h = (salt >>> 0) ^ 0x9e3779b9;
  h = Math.imul(h ^ (a >>> 0), 0x85ebca6b);
  h = Math.imul(h ^ (b >>> 0), 0xc2b2ae35);
  h = Math.imul(h ^ (c >>> 0), 0x27d4eb2f);
  h ^= h >>> 16;
  return h >>> 0;
}

class Degradation {
  constructor(layout, rng, opts = {}) {
    this.layout = layout;
    this.rng = rng;
    this.seed = (rng.seed != null ? rng.seed : 1) >>> 0;
    this.guns = new Map();
    this.operatorSkill = 1.0;
    this.fatigue = 0;
    this.lotFitUp = 1.0;
    this.lotBad = false;
    this.currentLot = -1;
    this.lotSize = opts.lotSize || 60;
    this.badLotProb = opts.badLotProb || 0.12;
    this.accelStation = opts.accelStation || null;
    this.accelGun = opts.accelGun != null ? opts.accelGun : 0;
    this.accelFromUnit = opts.accelFromUnit != null ? opts.accelFromUnit : null;
    this.accelMul = opts.accelMul || 4.5;

    for (const [sid, cfg] of Object.entries(layout.weldStations)) {
      const guns = [];
      for (let g = 0; g < cfg.guns; g++) guns.push(new Gun(sid, g));
      this.guns.set(sid, guns);
    }

    if (this.accelStation && this.guns.has(this.accelStation)) {
      const g = this.guns.get(this.accelStation)[this.accelGun];
      if (g) g.accelerate(this.accelFromUnit != null ? this.accelFromUnit : 140, this.accelMul);
    }

    this._ensureLot(1);
  }

  _rngAt(...parts) {
    return makeRng(hashU32(parts[0] || 0, parts[1] || 0, parts[2] || 0, this.seed ^ (parts[3] || 0)));
  }

  _ensureLot(unitSeq) {
    const lot = Math.floor((unitSeq - 1) / this.lotSize);
    if (lot === this.currentLot) return;
    this.currentLot = lot;
    const lr = this._rngAt(lot, 0, 0, 0xa11e7);
    this.lotBad = lr.bernoulli(this.badLotProb);
    this.lotFitUp = this.lotBad
      ? lr.uniform(0.84, 0.92)
      : lr.uniform(0.97, 1.03);
  }

  onUnitStart(unitSeq) {
    this._ensureLot(unitSeq);
    this.fatigue = Math.min(0.08, (unitSeq % 500) / 500 * 0.08);
    const or = this._rngAt(unitSeq, 0, 0, 0x0b07);
    this.operatorSkill = 1.0 - this.fatigue + or.normal(0, 0.005);
  }

  cycleMul() {
    return Math.max(0.9, Math.min(1.15, 1 / this.operatorSkill));
  }

  weld(stationId, spotIdx, unitSeq) {
    const guns = this.guns.get(stationId);
    if (!guns) return null;
    const gun = guns[spotIdx % guns.length];
    if (gun.accelerated && gun.accelFromUnit != null && unitSeq >= gun.accelFromUnit) {
      gun.wearMul = this.accelMul;
    }
    gun.recordWeld(unitSeq);
    this._ensureLot(unitSeq);
    const tipRatio = gun.tipRatio();
    const fitUp = this.lotFitUp;
    const sidNum = parseInt(String(stationId).replace(/\D/g, ''), 10) || 0;
    const wr = this._rngAt(sidNum, unitSeq, spotIdx, 0x11e1d);
    const eps = wr.normal(0, 0.025);
    const nugget = NUGGET_BASE * Math.pow(1 / tipRatio, 0.9) * fitUp * (1 + eps);
    const defect = nugget < NUGGET_THRESH;
    return {
      gun: gun.gunIdx,
      tipRatio,
      nugget,
      defect,
      fitUp,
      accelerated: gun.accelerated && unitSeq >= (gun.accelFromUnit || 0),
    };
  }

  snapshotGuns(stationId) {
    const guns = this.guns.get(stationId) || [];
    return guns.map((g) => ({
      gun: g.gunIdx,
      welds: g.welds,
      tipRatio: g.tipRatio(),
      accelerated: g.accelerated,
      residual: g.residual,
    }));
  }
}

module.exports = {
  Degradation,
  Gun,
  MAX_DRESSINGS,
  DRESS_RESIDUAL,
  NUGGET_THRESH,
  WEAR_K,
};
