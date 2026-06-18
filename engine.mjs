/* =====================================================================
   engine.mjs —— 台股配置控制台純計算引擎（零依賴 ESM）
   所有數學與隨機過程集中於此，方便以 node:test 做 TDD；
   build.mjs 會把本檔內聯進 dist/index.html（IIFE，globalName "Engine"）。
   隨機過程一律接受可注入種子（makeRng(seed)），確保決定性與可重現。
   ===================================================================== */

/* ---------- 數值清理：空白/非數字一律回退，並夾在下限以上 ---------- */
export const num = (v, min = 0) => { const n = +v; return Number.isFinite(n) ? Math.max(min, n) : min; };

/* ---------- 可注入種子亂數（mulberry32），回傳 ()=>[0,1) ---------- */
export function makeRng(seed) {
  let a = (seed >>> 0) || 1;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* 一次抽兩個獨立標準常態（Box–Muller，cos 與 sin 都用，不浪費） */
export function gaussianPair(rng) {
  let u = 0, v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  const r = Math.sqrt(-2 * Math.log(u)), th = 2 * Math.PI * v;
  return [r * Math.cos(th), r * Math.sin(th)];
}

/* 已排序（升冪）陣列取分位數（線性內插） */
export function quantile(sorted, p) {
  if (!sorted.length) return 0;
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx), hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

/* ---------- 確定性試算引擎（連續複利） ----------
   月成長率採連續複利 exp(a/12)-1，使「年化報酬 a、t 年」單筆期末
   恰為 本金·e^(a·t)；σ=0 的蒙地卡羅亦由此貼齊（核心一致性）。     */
export function simulate({ instruments, mode, budget, gross, years, sweepId }) {
  const list = instruments;
  const sumAlloc = list.reduce((s, i) => s + Math.max(0, +i.alloc || 0), 0) || 1;
  const amt = {};
  list.forEach((i) => (amt[i.id] = (budget * Math.max(0, +i.alloc || 0)) / sumAlloc));
  const validSweep = list.some((i) => i.id === sweepId) ? sweepId : null;

  const mrate = (annual) => Math.exp(annual / 100 / 12) - 1;   // 連續複利月率
  const netRate = (i) => {
    if (i.id === validSweep) return gross - i.fee;
    if (i.distributes) return gross - i.divYield - i.fee;
    return gross - i.fee;
  };

  // 每檔月成長率只與輸入有關，預先算好，避免每月迴圈內重複呼叫 exp。
  const monthly = {};
  list.forEach((i) => (monthly[i.id] = mrate(netRate(i))));

  const bal = {};
  list.forEach((i) => (bal[i.id] = mode === "lump" ? amt[i.id] : 0));
  const months = years * 12;
  const total = () => list.reduce((s, i) => s + bal[i.id], 0);
  const snap = () => { const o = {}; list.forEach((i) => (o[i.id] = bal[i.id])); return o; };

  let invested = mode === "lump" ? budget : 0;
  const series = [{ year: 0, total: total(), invested, divSwept: 0, ...snap() }];

  for (let m = 1; m <= months; m++) {
    list.forEach((i) => {
      if (mode === "monthly") bal[i.id] += amt[i.id];
      bal[i.id] *= 1 + monthly[i.id];
    });
    if (mode === "monthly") invested += budget;
    if (m % 12 === 0) {
      let swept = 0;
      list.forEach((i) => {
        if (i.id !== validSweep && i.distributes) {
          const d = bal[i.id] * (i.divYield / 100);
          swept += d;
          if (validSweep) bal[validSweep] += d;
        }
      });
      series.push({ year: m / 12, total: total(), invested, divSwept: swept, ...snap() });
    }
  }

  const lookTsmc = list.reduce((s, i) => s + amt[i.id] * (i.tsmcW / 100), 0) / (budget || 1) * 100;
  const buys = list.map((i) => {
    const a = amt[i.id];
    const sh = i.price > 0 ? Math.floor(a / i.price) : 0;
    return { ...i, amount: a, shares: sh, cost: sh * i.price, leftover: a - sh * i.price };
  });
  return { series, lookTsmc, buys, finalTotal: total(), invested };
}
