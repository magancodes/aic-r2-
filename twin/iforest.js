'use strict';

/**
 * Isolation Forest from scratch.
 * 100 trees, subsample 256, depth limit ceil(log2(256)).
 * Anomaly score: 2^(-E(h)/c(n)) where c(n) = 2H(n-1) - 2(n-1)/n.
 */

function harmonic(i) {
  // H(i) ≈ ln(i) + γ
  if (i < 1) return 0;
  return Math.log(i) + 0.5772156649;
}

function cFactor(n) {
  if (n <= 1) return 0;
  if (n === 2) return 1;
  return 2 * harmonic(n - 1) - (2 * (n - 1)) / n;
}

function buildTree(points, rng, depth, maxDepth) {
  const n = points.length;
  if (depth >= maxDepth || n <= 1) {
    return { size: n, leaf: true };
  }
  const dim = Math.floor(rng.next() * points[0].length);
  let lo = Infinity;
  let hi = -Infinity;
  for (const p of points) {
    if (p[dim] < lo) lo = p[dim];
    if (p[dim] > hi) hi = p[dim];
  }
  if (!(hi > lo)) {
    return { size: n, leaf: true };
  }
  const split = lo + rng.next() * (hi - lo);
  const left = [];
  const right = [];
  for (const p of points) {
    if (p[dim] < split) left.push(p);
    else right.push(p);
  }
  if (!left.length || !right.length) {
    return { size: n, leaf: true };
  }
  return {
    leaf: false,
    dim,
    split,
    left: buildTree(left, rng, depth + 1, maxDepth),
    right: buildTree(right, rng, depth + 1, maxDepth),
  };
}

function pathLength(point, node, depth) {
  if (node.leaf) {
    return depth + cFactor(node.size);
  }
  if (point[node.dim] < node.split) return pathLength(point, node.left, depth + 1);
  return pathLength(point, node.right, depth + 1);
}

class IsolationForest {
  /**
   * @param {object} [opts]
   * @param {number} [opts.nTrees=100]
   * @param {number} [opts.subsample=256]
   * @param {object} rng seeded rng with .next()
   */
  constructor(opts = {}) {
    this.nTrees = opts.nTrees != null ? opts.nTrees : 100;
    this.subsample = opts.subsample != null ? opts.subsample : 256;
    this.maxDepth = Math.ceil(Math.log2(this.subsample));
    this.trees = [];
    this.c = cFactor(this.subsample);
  }

  fit(data, rng) {
    this.trees = [];
    const n = data.length;
    if (n < 2) return this;
    const sub = Math.min(this.subsample, n);
    this.c = cFactor(sub);
    this.maxDepth = Math.ceil(Math.log2(Math.max(2, sub)));
    for (let t = 0; t < this.nTrees; t++) {
      const sample = [];
      for (let i = 0; i < sub; i++) {
        sample.push(data[Math.floor(rng.next() * n)]);
      }
      this.trees.push(buildTree(sample, rng, 0, this.maxDepth));
    }
    return this;
  }

  /** Higher = more anomalous (in [0,1]-ish). */
  score(point) {
    if (!this.trees.length) return 0;
    let eh = 0;
    for (const tree of this.trees) eh += pathLength(point, tree, 0);
    eh /= this.trees.length;
    return Math.pow(2, -eh / Math.max(1e-9, this.c));
  }

  scores(points) {
    return points.map((p) => this.score(p));
  }
}

module.exports = { IsolationForest, cFactor, harmonic };
