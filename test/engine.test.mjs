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

/* ---------- Task 3.1：Student-t 抽樣（厚尾） ---------- */

import { studentT } from '../engine.mjs';

test('studentT: 標準化後均值≈0、標準差≈1', () => {
  const r = makeRng(3);
  let n = 0, s = 0, ss = 0;
  for (let i = 0; i < 40000; i++) { const z = studentT(r, 6); n++; s += z; ss += z * z; }
  const m = s / n, sd = Math.sqrt(ss / n - m * m);
  assert.ok(Math.abs(m) < 0.05, `均值 ${m}`);
  assert.ok(Math.abs(sd - 1) < 0.1, `標準差 ${sd}`);
});

test('studentT: 尾部比常態胖（極端值比例更高）', () => {
  const r1 = makeRng(9), r2 = makeRng(9);
  let tTail = 0, nTail = 0; const TH = 2.5, K = 40000;
  for (let i = 0; i < K; i++) if (Math.abs(studentT(r1, 4)) > TH) tTail++;
  for (let i = 0; i < K; i++) { const [a] = gaussianPair(r2); if (Math.abs(a) > TH) nTail++; }
  assert.ok(tTail > nTail, `t 尾 ${tTail} 應 > 常態尾 ${nTail}`);
});

test('studentT: 超峰態為正（比常態厚尾）', () => {
  // 厚尾的定義性檢驗：峰態 > 3（常態），且 nu=5 理論峰態=9，留充裕餘裕避免抽樣雜訊誤判。
  const r = makeRng(21); const xs = [];
  for (let i = 0; i < 60000; i++) xs.push(studentT(r, 5));
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  let m2 = 0, m4 = 0;
  for (const x of xs) { const d = x - m; m2 += d * d; m4 += d * d * d * d; }
  m2 /= xs.length; m4 /= xs.length;
  const kurt = m4 / (m2 * m2);
  assert.ok(kurt > 3.5, `峰態 ${kurt} 應 > 3（常態厚尾門檻）`);
});

test('monteCarlo dist=t、σ=0：仍貼齊直線試算（一致性不破）', () => {
  // t 分布只改變衝擊形狀；σ=0 時無衝擊，期末必須仍等於確定性試算（核心一致性）。
  const args = { instruments: INST1, mode: 'lump', budget: 1000, gross: 6, years: 10 };
  const mc = monteCarlo({ ...args, sigma: 0, dist: 't', nu: 5, paths: 100, seed: 7 });
  const last = mc.series[10];
  assert.ok(Math.abs(last.p10 - last.p90) < 1e-6, `p10=${last.p10} p90=${last.p90}`);
  const det = simulate({ ...args, sweepId: 'a' });
  assert.ok(Math.abs(last.p50 - det.finalTotal) / det.finalTotal < 1e-9, `mc=${last.p50} det=${det.finalTotal}`);
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

/* ---------- Task 2.2：stationaryBootstrap 平穩拔靴 ---------- */

import { stationaryBootstrap } from '../engine.mjs';

// 計算各路徑 lag-1 自相關的平均（用來驗證序列相依是否被保留）
function avgLag1(paths) {
  let acc = 0, k = 0;
  for (const row of paths) {
    const n = row.length, m = row.reduce((s, x) => s + x, 0) / n;
    let num = 0, den = 0;
    for (let i = 0; i < n; i++) { den += (row[i] - m) ** 2; if (i) num += (row[i] - m) * (row[i - 1] - m); }
    if (den > 0) { acc += num / den; k++; }
  }
  return acc / k;
}

test('stationaryBootstrap: 輸出形狀正確', () => {
  const out = stationaryBootstrap({ pool: [0.01, -0.02, 0.03], months: 12, paths: 50, avgBlock: 6, rng: makeRng(3) });
  assert.equal(out.length, 50);
  assert.equal(out[0].length, 12);
});

test('stationaryBootstrap: recenter 後路徑平均月報酬≈目標', () => {
  const out = stationaryBootstrap({ pool: [0.05, -0.03, 0.02, 0.04], months: 120, paths: 500, avgBlock: 6, recenterTo: 0.005, rng: makeRng(4) });
  const all = out.flat();
  const m = all.reduce((s, x) => s + x, 0) / all.length;
  assert.ok(Math.abs(m - 0.005) < 5e-4, `平均 ${m}`);
});

test('stationaryBootstrap: 保留序列相依（區塊 vs IID 對照）', () => {
  // 用正自相關的 AR(1) 序列當 pool
  const r = makeRng(11); const pool = []; let x = 0;
  for (let i = 0; i < 240; i++) { x = 0.8 * x + (r() - 0.5) * 0.1; pool.push(x); }
  const block = stationaryBootstrap({ pool, months: 240, paths: 30, avgBlock: 12, rng: makeRng(5) });
  const iid = stationaryBootstrap({ pool, months: 240, paths: 30, avgBlock: 1, rng: makeRng(5) });
  assert.ok(avgLag1(block) > avgLag1(iid) + 0.2, `block ${avgLag1(block).toFixed(3)} 應顯著高於 IID ${avgLag1(iid).toFixed(3)}`);
});

/* ---------- Task 2.3：riskMetrics 風險指標 ---------- */

import { riskMetrics } from '../engine.mjs';

test('riskMetrics: CVaR(5%)=最差5%期末均值、達標率、回撤分位', () => {
  const finals = [100, 200, 300, 400, 1000];
  const paths = [[100, 150, 120, 200], [100, 50, 160]];  // 路徑1 最大回撤0.2；路徑2 最大回撤0.5
  const m = riskMetrics(finals, paths, { target: 300, invested: 100 });
  assert.equal(m.cvar05, 100);                       // 最差5%（n=5→取最差1筆）
  assert.ok(Math.abs(m.successRate - 0.6) < 1e-9);   // ≥300 者 3/5
  assert.ok(Math.abs(m.maxDrawdownP50 - 0.35) < 1e-9, `P50=${m.maxDrawdownP50}`);
  assert.ok(Math.abs(m.maxDrawdownP90 - 0.47) < 1e-9, `P90=${m.maxDrawdownP90}`);
});

/* ---------- Task 2.4：bootstrapSimulate 組裝 ---------- */

import { bootstrapSimulate } from '../engine.mjs';

test('bootstrapSimulate: 機率帶有寬度、達標率∈[0,1]、可重現', () => {
  const args = { instruments: INST1, mode: 'lump', budget: 10000, gross: 6, years: 20, paths: 300, avgBlock: 6, seed: 42, target: 20000 };
  const a = bootstrapSimulate(args), b = bootstrapSimulate(args);
  const last = a.series[a.series.length - 1];
  assert.ok(last.p90 > last.p10, 'P90 應 > P10');
  assert.ok(last.p50 > 0);
  assert.ok(a.risk.successRate >= 0 && a.risk.successRate <= 1, `successRate=${a.risk.successRate}`);
  assert.equal(a.series[20].p50, b.series[20].p50);  // 同種子可重現
});

test('bootstrapSimulate: 期末中位數隨報酬假設提高而提高（recenter 生效）', () => {
  const base = { instruments: INST1, mode: 'lump', budget: 10000, years: 20, paths: 300, avgBlock: 6, seed: 7 };
  const lo = bootstrapSimulate({ ...base, gross: 2 }).series[20].p50;
  const hi = bootstrapSimulate({ ...base, gross: 10 }).series[20].p50;
  assert.ok(hi > lo, `hi ${hi} 應 > lo ${lo}`);
});

/* ---------- Task 2.5：historicalBacktest 歷史滾動回測 ---------- */

import { historicalBacktest } from '../engine.mjs';

test('historicalBacktest: 零報酬池 → 單筆期末=本金、視窗數正確', () => {
  const pool = new Array(24).fill(0);
  const r = historicalBacktest({ pool, mode: 'lump', budget: 1000, years: 1 });
  assert.equal(r.windows, 13);                       // 24-12+1
  assert.equal(r.p50, 1000);
  assert.equal(r.last.series[r.last.series.length - 1].total, 1000);
});

test('historicalBacktest: 固定正報酬池 → 單筆期末=本金·(1+r)^月數', () => {
  const pool = new Array(24).fill(0.01);
  const r = historicalBacktest({ pool, mode: 'lump', budget: 1000, years: 1 });
  assert.ok(Math.abs(r.p50 - 1000 * Math.pow(1.01, 12)) < 1e-6, `p50=${r.p50}`);
});

test('historicalBacktest: 定期定額零報酬 → 期末=投入總額', () => {
  const pool = new Array(24).fill(0);
  const r = historicalBacktest({ pool, mode: 'monthly', budget: 100, years: 1 });
  assert.equal(r.p50, 1200);
});
