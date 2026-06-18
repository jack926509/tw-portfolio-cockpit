import test from 'node:test';
import assert from 'node:assert/strict';
import { num, quantile, makeRng, gaussianPair, simulate, monteCarlo } from '../engine.mjs';

const INST1 = [{ id: 'a', ticker: 'a', price: 10, alloc: 100, fee: 0, divYield: 0, tsmcW: 0, distributes: false }];

/* ---------- Task 1.1：num / quantile ---------- */

test('num: 非數字回退下限', () => {
  assert.equal(num('x'), 0);
  assert.equal(num('x', 5), 5);
});

test('num: 夾在下限以上', () => {
  assert.equal(num(-3, 0), 0);
  assert.equal(num(2.5), 2.5);
});

test('quantile: 線性內插', () => {
  assert.equal(quantile([0, 10], 0.5), 5);
  assert.equal(quantile([1, 2, 3, 4], 0.5), 2.5);
});

/* ---------- Task 1.2：makeRng / gaussianPair ---------- */

test('makeRng: 同種子可重現', () => {
  const a = makeRng(42), b = makeRng(42);
  for (let i = 0; i < 5; i++) assert.equal(a(), b());
});

test('makeRng: 輸出落在 [0,1)', () => {
  const r = makeRng(7);
  for (let i = 0; i < 1000; i++) { const x = r(); assert.ok(x >= 0 && x < 1); }
});

test('gaussianPair: 大樣本均值≈0、標準差≈1', () => {
  const r = makeRng(1);
  let n = 0, s = 0, ss = 0;
  for (let i = 0; i < 20000; i++) {
    const [a, b] = gaussianPair(r);
    for (const z of [a, b]) { n++; s += z; ss += z * z; }
  }
  const m = s / n, sd = Math.sqrt(ss / n - m * m);
  assert.ok(Math.abs(m) < 0.05, `均值 ${m}`);
  assert.ok(Math.abs(sd - 1) < 0.05, `標準差 ${sd}`);
});

/* ---------- Task 1.3：simulate 連續複利 ---------- */

test('simulate 零報酬：期末=投入（定期定額）', () => {
  const r = simulate({ instruments: INST1, sweepId: 'a', mode: 'monthly', budget: 1000, gross: 0, years: 10 });
  assert.ok(Math.abs(r.finalTotal - r.invested) < 1e-6);
});

test('simulate 單筆連續複利：finalTotal≈本金·e^(g·t)', () => {
  const r = simulate({ instruments: INST1, sweepId: 'a', mode: 'lump', budget: 1000, gross: 5, years: 10 });
  assert.ok(Math.abs(r.finalTotal - 1000 * Math.exp(0.05 * 10)) < 1e-3, `finalTotal=${r.finalTotal}`);
});

test('simulate 配置正規化：合計≠100 仍按比例', () => {
  const two = [
    { id: 'a', ticker: 'a', price: 10, alloc: 50, fee: 0, divYield: 0, tsmcW: 0, distributes: false },
    { id: 'b', ticker: 'b', price: 10, alloc: 50, fee: 0, divYield: 0, tsmcW: 100, distributes: false },
  ];
  const r = simulate({ instruments: two, sweepId: 'a', mode: 'lump', budget: 1000, gross: 0, years: 1 });
  assert.ok(Math.abs(r.lookTsmc - 50) < 1e-6, `lookTsmc=${r.lookTsmc}`);
});

/* ---------- Task 1.4：monteCarlo GBM 對數常態 ---------- */

test('monteCarlo σ=0：三分位重合且=simulate 期末（核心一致性）', () => {
  const args = { instruments: INST1, mode: 'lump', budget: 1000, gross: 6, years: 20 };
  const mc = monteCarlo({ ...args, sigma: 0, paths: 200, seed: 7 });
  const last = mc.series[20];
  assert.ok(Math.abs(last.p10 - last.p90) < 1e-6, `p10=${last.p10} p90=${last.p90}`);
  const det = simulate({ ...args, sweepId: 'a' });
  assert.ok(Math.abs(last.p50 - det.finalTotal) / det.finalTotal < 1e-9, `mc=${last.p50} det=${det.finalTotal}`);
});

test('monteCarlo cagrImplied = μ − σ²/2', () => {
  const mc = monteCarlo({ instruments: INST1, mode: 'lump', budget: 1000, gross: 8, years: 5, sigma: 20, paths: 100, seed: 1 });
  assert.ok(Math.abs(mc.cagrImplied - (8 - 0.2 * 0.2 / 2 * 100)) < 1e-6, `cagrImplied=${mc.cagrImplied}`);
});

test('monteCarlo 同種子可重現', () => {
  const mk = () => monteCarlo({ instruments: INST1, mode: 'lump', budget: 1000, gross: 7, years: 10, sigma: 18, paths: 300, seed: 99 });
  assert.equal(mk().medianFinal, mk().medianFinal);
});

/* ---------- Task 2.1：HIST_RETURNS 歷史月報酬資料 ---------- */

import { HIST_RETURNS } from '../engine.mjs';

test('HIST_RETURNS: 長度與數值合理', () => {
  assert.ok(Array.isArray(HIST_RETURNS.monthly), '需為陣列');
  assert.ok(HIST_RETURNS.monthly.length >= 120, `長度 ${HIST_RETURNS.monthly.length} 應≥120`);
  for (const r of HIST_RETURNS.monthly) assert.ok(Math.abs(r) < 0.5, `單月報酬 ${r} 異常`);
  const m = HIST_RETURNS.monthly.reduce((s, x) => s + x, 0) / HIST_RETURNS.monthly.length;
  assert.ok(m > 0 && m < 0.03, `月均 ${m} 不在合理區間`);
  assert.ok(typeof HIST_RETURNS.range === 'string' && HIST_RETURNS.range.length > 0, '需標註區間');
  assert.ok(typeof HIST_RETURNS.source === 'string' && HIST_RETURNS.source.length > 0, '需標註來源');
});
