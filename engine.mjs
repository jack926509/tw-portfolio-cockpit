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
