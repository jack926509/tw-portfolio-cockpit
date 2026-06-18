/* =====================================================================
   engine.mjs —— 台股配置控制台純計算引擎（零依賴 ESM）
   所有數學與隨機過程集中於此，方便以 node:test 做 TDD；
   build.mjs 會把本檔內聯進 dist/index.html（IIFE，globalName "Engine"）。
   隨機過程一律接受可注入種子（makeRng(seed)），確保決定性與可重現。
   ===================================================================== */

/* ---------- 數值清理：空白/非數字一律回退，並夾在下限以上 ---------- */
export const num = (v, min = 0) => { const n = +v; return Number.isFinite(n) ? Math.max(min, n) : min; };

/* 已排序（升冪）陣列取分位數（線性內插） */
export function quantile(sorted, p) {
  if (!sorted.length) return 0;
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx), hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}
