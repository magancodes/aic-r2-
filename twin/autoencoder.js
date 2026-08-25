'use strict';

/**
 * 12→4→12 autoencoder, tanh hidden, SGD, standardised inputs.
 * Reconstruction MSE is the anomaly score.
 */

function zeros(n) {
  return new Array(n).fill(0);
}

function randMat(rows, cols, rng, scale) {
  const m = new Array(rows);
  for (let i = 0; i < rows; i++) {
    m[i] = new Array(cols);
    for (let j = 0; j < cols; j++) m[i][j] = rng.normal(0, scale);
  }
  return m;
}

class Autoencoder {
  /**
   * @param {object} [opts]
   * @param {number} [opts.hidden=4]
   * @param {number} [opts.lr=0.05]
   * @param {number} [opts.epochs=40]
   */
  constructor(opts = {}) {
    this.hidden = opts.hidden != null ? opts.hidden : 4;
    this.lr = opts.lr != null ? opts.lr : 0.05;
    this.epochs = opts.epochs != null ? opts.epochs : 40;
    this.mean = null;
    this.sd = null;
    this.W1 = null;
    this.b1 = null;
    this.W2 = null;
    this.b2 = null;
  }

  _standardizeFit(data) {
    const d = data[0].length;
    this.mean = zeros(d);
    this.sd = zeros(d);
    for (const row of data) {
      for (let j = 0; j < d; j++) this.mean[j] += row[j];
    }
    for (let j = 0; j < d; j++) this.mean[j] /= data.length;
    for (const row of data) {
      for (let j = 0; j < d; j++) {
        const z = row[j] - this.mean[j];
        this.sd[j] += z * z;
      }
    }
    for (let j = 0; j < d; j++) {
      this.sd[j] = Math.sqrt(this.sd[j] / Math.max(1, data.length - 1)) || 1;
    }
  }

  _std(row) {
    return row.map((v, j) => (v - this.mean[j]) / this.sd[j]);
  }

  _forward(x) {
    const h = new Array(this.hidden);
    for (let i = 0; i < this.hidden; i++) {
      let s = this.b1[i];
      for (let j = 0; j < x.length; j++) s += this.W1[i][j] * x[j];
      h[i] = Math.tanh(s);
    }
    const y = new Array(x.length);
    for (let j = 0; j < x.length; j++) {
      let s = this.b2[j];
      for (let i = 0; i < this.hidden; i++) s += this.W2[j][i] * h[i];
      y[j] = s; // linear output
    }
    return { h, y };
  }

  fit(data, rng) {
    if (!data.length) return this;
    this._standardizeFit(data);
    const d = data[0].length;
    const scale = 1 / Math.sqrt(d);
    this.W1 = randMat(this.hidden, d, rng, scale);
    this.b1 = zeros(this.hidden);
    this.W2 = randMat(d, this.hidden, rng, 1 / Math.sqrt(this.hidden));
    this.b2 = zeros(d);

    const xs = data.map((r) => this._std(r));
    for (let ep = 0; ep < this.epochs; ep++) {
      // shuffle
      for (let i = xs.length - 1; i > 0; i--) {
        const j = Math.floor(rng.next() * (i + 1));
        const tmp = xs[i];
        xs[i] = xs[j];
        xs[j] = tmp;
      }
      for (const x of xs) {
        const { h, y } = this._forward(x);
        const dy = new Array(d);
        for (let j = 0; j < d; j++) dy[j] = y[j] - x[j];

        // dW2, db2
        for (let j = 0; j < d; j++) {
          this.b2[j] -= this.lr * dy[j];
          for (let i = 0; i < this.hidden; i++) {
            this.W2[j][i] -= this.lr * dy[j] * h[i];
          }
        }
        // backprop to hidden
        const dh = new Array(this.hidden).fill(0);
        for (let i = 0; i < this.hidden; i++) {
          let s = 0;
          for (let j = 0; j < d; j++) s += this.W2[j][i] * dy[j];
          dh[i] = s * (1 - h[i] * h[i]); // tanh'
        }
        for (let i = 0; i < this.hidden; i++) {
          this.b1[i] -= this.lr * dh[i];
          for (let j = 0; j < d; j++) {
            this.W1[i][j] -= this.lr * dh[i] * x[j];
          }
        }
      }
    }
    return this;
  }

  /** Reconstruction MSE on standardised space. */
  score(row) {
    if (!this.W1) return 0;
    const x = this._std(row);
    const { y } = this._forward(x);
    let mse = 0;
    for (let j = 0; j < x.length; j++) {
      const e = y[j] - x[j];
      mse += e * e;
    }
    return mse / x.length;
  }
}

module.exports = { Autoencoder };
