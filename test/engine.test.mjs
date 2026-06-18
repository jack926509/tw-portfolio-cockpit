import test from 'node:test';
import assert from 'node:assert/strict';
import { num, quantile, makeRng, gaussianPair, simulate } from '../engine.mjs';

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
