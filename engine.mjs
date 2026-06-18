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

/* 一個標準化 Student-t 變量（均值 0、變異數 1，厚尾）。
   t = z / √(χ²ν/ν)，χ²ν 以 ν 個標準常態平方和取得（ν 取整數，退休模擬常用 4–8）；
   原始 t 變異數為 ν/(ν−2)，乘 √((ν−2)/ν) 標準化，方能與常態 z 一樣直接乘上 σ。 */
export function studentT(rng, nu) {
  const v = Math.max(3, Math.round(nu) || 5);   // 需 ν>2 變異數才有限
  const [z] = gaussianPair(rng);
  let chi2 = 0;
  for (let i = 0; i < v; i += 2) {
    const [a, b] = gaussianPair(rng);
    chi2 += a * a;
    if (i + 1 < v) chi2 += b * b;
  }
  const t = z / Math.sqrt(chi2 / v);
  return t * Math.sqrt((v - 2) / v);            // 標準化為單位變異數
}

/* 已排序（升冪）陣列取分位數（線性內插） */
export function quantile(sorted, p) {
  if (!sorted.length) return 0;
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx), hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

/* ---------- 台灣股利稅負 ----------
   單筆股利 ≥ 門檻（預設 NT$20,000）課二代健保補充保費（預設 2.11%，就全額計）；
   另就股利全額課所得稅（divTaxRate%，可填合併或分離 28% 的有效稅率）。回傳稅後淨額。 */
export function applyDividendTax(div, { supplement = true, divTaxRate = 0, threshold = 20000, supplementRate = 0.0211 } = {}) {
  const d = Math.max(0, +div || 0);
  const sup = supplement && d >= threshold ? d * supplementRate : 0;
  const tax = d * (Math.max(0, +divTaxRate || 0) / 100);
  return Math.max(0, d - sup - tax);
}

/* ---------- 確定性試算引擎（連續複利） ----------
   月成長率採連續複利 exp(a/12)-1，使「年化報酬 a、t 年」單筆期末
   恰為 本金·e^(a·t)；σ=0 的蒙地卡羅亦由此貼齊（核心一致性）。     */
export function simulate({ instruments, mode, budget, gross, years, sweepId, tax = null }) {
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
          let d = bal[i.id] * (i.divYield / 100);
          if (tax) d = applyDividendTax(d, tax);   // 稅後才掃入再投資
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

/* ---------- 目標金額回推 ----------
   simulate 的期末對「投入金額」為線性（各標的金額、月扣款、股利掃入皆線性於 budget），
   故以單位投入（budget=1）跑一次取得每元期末值，再線性回推所需投入 = target / 每元期末值。
   回傳達成 target 所需的每月（或單筆）投入金額；target≤0 回 0。            */
export function solveContribution({ instruments, mode, gross, years, sweepId, target, tax = null }) {
  const t = Math.max(0, +target || 0);
  if (t === 0) return 0;
  const perUnit = simulate({ instruments, mode, budget: 1, gross, years, sweepId, tax }).finalTotal;
  return perUnit > 0 ? t / perUnit : 0;
}

/* ---------- 年度明細匯出 CSV（UTF-8 BOM，Excel 開中文不亂碼） ----------
   依 series 內實際存在的欄位輸出（year/invested/total/p10/p50/p90/divSwept），
   並附上各標的當年餘額欄（以 instruments 的 name 為標頭）。數值四捨五入到整數。 */
export function toCsv(series, instruments = []) {
  const BOM = "﻿";
  const has = (k) => series.some((r) => typeof r[k] === "number");
  const cols = [["year", "年"]];
  for (const [k, label] of [["invested", "投入本金"], ["total", "累積總額"], ["p10", "P10（保守）"], ["p50", "P50（中位）"], ["p90", "P90（樂觀）"], ["divSwept", "當年掃入股利"]]) {
    if (has(k)) cols.push([k, label]);
  }
  for (const i of instruments) if (has(i.id)) cols.push([i.id, i.name]);
  const esc = (v) => { const s = String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const header = cols.map((c) => esc(c[1])).join(",");
  const rows = series.map((r) => cols.map((c) => {
    const v = r[c[0]];
    return esc(typeof v === "number" ? Math.round(v) : (v == null ? "" : v));
  }).join(","));
  return BOM + [header].concat(rows).join("\n");
}

/* ---------- 蒙地卡羅引擎（逐標的、單因子等相關、GBM 對數常態） ----------
   每檔月衝擊 ε_i = σ_i/√12 ·(√ρ·z0 + √(1−ρ)·z_i)，z0 為共同（市場）因子、z_i 為個股獨立因子；
   任兩檔相關係數恆為 ρ（等相關）。月 factor_i = exp((μ_i−σ_i²/2)/12 + ε_i)。
   - σ_i 來源：標的有 sigma 欄則用之，否則回退傳入的投組層級 sigma（向後相容）。
   - μ_i = (gross − fee_i)/100；σ_i=0 時無衝擊，期末貼齊 simulate 連續複利（核心一致性）。
   - 對數常態本身 ≥0，無需截斷。dist='t' 時 z0/z_i 改用標準化 Student-t（厚尾），σ 意義不變。
   - 投組幾何報酬 cagrImplied = μ_p − σ_p²/2，σ_p² 由等相關共變異數矩陣求得。
   - 接受可注入 seed，確保可重現。                                              */
export function monteCarlo({ instruments, mode, budget, gross, years, sigma, paths, seed, dist = "normal", nu = 5, rho = 0.7 }) {
  const list = instruments;
  const n = list.length;
  const sumAlloc = list.reduce((s, i) => s + num(i.alloc), 0) || 1;
  const w = list.map((i) => num(i.alloc) / sumAlloc);                 // 配置權重
  const muM = list.map((i) => ((gross - num(i.fee)) / 100) / 12);     // 各標的月算術漂移
  const sigA = list.map((i) => (i.sigma != null ? num(i.sigma) : num(sigma)) / 100); // 各標的年化波動
  const sigM = sigA.map((s) => s / Math.sqrt(12));
  const driftM = list.map((_, k) => muM[k] - (sigA[k] * sigA[k]) / 2 / 12);          // (μ_i−σ_i²/2)/12
  const r = Math.max(0, Math.min(1, num(rho)));
  const rt = Math.sqrt(r), ri = Math.sqrt(1 - r);                     // 共同 / 獨立因子載荷
  const months = years * 12;
  const N = Math.max(1, Math.round(paths));

  const startW = mode === "lump" ? budget : 0;
  const contrib = mode === "monthly" ? budget : 0;
  const rng = makeRng(seed != null ? seed : 1234567);
  const useT = dist === "t";
  let g = null;   // 常態 gaussianPair 一次給兩個，交替使用以免浪費
  const draw = () => {
    if (useT) return studentT(rng, nu);
    if (g !== null) { const v = g; g = null; return v; }
    const pr = gaussianPair(rng); g = pr[1]; return pr[0];
  };

  // yearVals[y] = 該年底各路徑的投組總資產，用來取分位數
  const yearVals = Array.from({ length: years + 1 }, () => new Float64Array(N));
  for (let p = 0; p < N; p++) {
    const bal = w.map((wi) => startW * wi);
    yearVals[0][p] = startW;
    for (let m = 1; m <= months; m++) {
      const z0 = draw();                                  // 共同市場因子
      for (let k = 0; k < n; k++) {
        bal[k] += contrib * w[k];
        const eps = sigM[k] * (rt * z0 + ri * draw());    // 個股 = 共同 + 獨立
        bal[k] *= Math.exp(driftM[k] + eps);
      }
      if (m % 12 === 0) { let tot = 0; for (let k = 0; k < n; k++) tot += bal[k]; yearVals[m / 12][p] = tot; }
    }
  }

  const invested = mode === "lump" ? budget : budget * months;
  const series = yearVals.map((arr, y) => {
    const sorted = Float64Array.prototype.slice.call(arr).sort((a, b) => a - b);
    const p10 = quantile(sorted, 0.10), p50 = quantile(sorted, 0.50), p90 = quantile(sorted, 0.90);
    // band 為 [低, 高] 兩元素陣列，Recharts Area 會渲染成 P10–P90 機率帶
    return { year: y, p10, p50, p90, band: [p10, p90], invested: mode === "lump" ? budget : budget * y * 12 };
  });
  const finals = Float64Array.prototype.slice.call(yearVals[years]).sort((a, b) => a - b);
  const medianFinal = quantile(finals, 0.50);
  const aboveInvested = (yearVals[years].reduce((s, v) => s + (v >= invested ? 1 : 0), 0) / N) * 100;
  const aboveDouble = (yearVals[years].reduce((s, v) => s + (v >= invested * 2 ? 1 : 0), 0) / N) * 100;
  // 投組算術年報酬與等相關變異數：σ_p² = (1−ρ)Σwᵢ²σᵢ² + ρ(Σwᵢσᵢ)²
  const muP = list.reduce((s, _, k) => s + w[k] * ((gross - num(list[k].fee)) / 100), 0);
  const sumW2S2 = list.reduce((s, _, k) => s + w[k] * w[k] * sigA[k] * sigA[k], 0);
  const sumWS = list.reduce((s, _, k) => s + w[k] * sigA[k], 0);
  const varP = (1 - r) * sumW2S2 + r * sumWS * sumWS;
  const cagrImplied = (muP - varP / 2) * 100; // 波動拖累後的幾何年報酬

  return { series, invested, medianFinal, medianMultiple: invested ? medianFinal / invested : 0, aboveInvested, aboveDouble, cagrImplied, paths: N };
}

/* ---------- CAPE 估值調整：盈餘殖利率 ≈ 長期報酬粗估 ----------
   CAPE（席勒本益比）的倒數 1/CAPE 為盈餘殖利率，學理上是長期實質報酬的合理錨點。
   回傳 100/cape（百分比）；cape 無效（≤0 或非數）回傳 0，由 UI 自行決定是否顯示。 */
export function valuationAdjustedReturn({ cape }) {
  const c = +cape;
  return Number.isFinite(c) && c > 0 ? 100 / c : 0;
}

/* ---------- 平穩拔靴（Politis–Romano 1994） ----------
   從歷史月報酬 pool 以「幾何分布區塊長度」重抽，保留波動叢聚與序列相依（厚尾、序列報酬風險）。
   每步以機率 p=1/avgBlock 重新隨機選起點，否則沿用前一索引 +1（環狀繞回）。
   recenterTo 不為 null 時，整體平移使每筆報酬期望均值落在 recenterTo（僅借結構、不借歷史高報酬）。
   回傳 paths × months 的二維陣列。avgBlock=1 等同 IID 重抽。               */
export function stationaryBootstrap({ pool, months, paths, avgBlock, recenterTo = null, rng }) {
  const L = pool.length;
  const p = 1 / Math.max(1, avgBlock);
  const poolMean = pool.reduce((s, x) => s + x, 0) / L;
  const shift = recenterTo == null ? 0 : recenterTo - poolMean;
  const out = [];
  for (let pa = 0; pa < paths; pa++) {
    const row = new Array(months);
    let idx = Math.floor(rng() * L);
    for (let t = 0; t < months; t++) {
      if (t === 0 || rng() < p) idx = Math.floor(rng() * L);  // 開新區塊
      else idx = (idx + 1) % L;                               // 沿用區塊
      row[t] = pool[idx] + shift;
    }
    out.push(row);
  }
  return out;
}

/* ---------- 歷史平穩拔靴模擬（預設模型） ----------
   以 HIST_RETURNS 月報酬為 pool 做平穩拔靴，但用 recenterTo 把均值平移到使用者的報酬假設
   （μ = gross − 配置加權內扣，視為算術年報酬），故借用歷史的波動結構/厚尾/序列相依，
   不強加歷史的高報酬。回傳與 monteCarlo 同形 series（year/p10/p50/p90/band/invested）＋ risk。 */
export function bootstrapSimulate({ instruments, mode, budget, gross, years, paths, avgBlock = 6, seed, target }) {
  const list = instruments;
  const sumAlloc = list.reduce((s, i) => s + num(i.alloc), 0) || 1;
  const wFee = list.reduce((s, i) => s + (num(i.alloc) / sumAlloc) * num(i.fee), 0);
  const muAnnual = (gross - wFee) / 100;
  const recenterTo = muAnnual / 12;                 // 目標月（算術）均值
  const months = years * 12;
  const N = Math.max(1, Math.round(paths));
  const rng = makeRng(seed != null ? seed : 1234567);

  const samples = stationaryBootstrap({ pool: HIST_RETURNS.monthly, months, paths: N, avgBlock, recenterTo, rng });

  const start = mode === "lump" ? budget : 0;
  const contrib = mode === "monthly" ? budget : 0;

  // 各路徑：逐月套用報酬，記錄各年底資產值（年值序列亦供回撤計算）
  const yearVals = Array.from({ length: years + 1 }, () => new Float64Array(N));
  const yearPaths = [];                              // paths × (years+1)，給 riskMetrics 算回撤
  for (let p = 0; p < N; p++) {
    let bal = start;
    const row = samples[p];
    const yp = new Array(years + 1); yp[0] = bal; yearVals[0][p] = bal;
    for (let m = 1; m <= months; m++) {
      bal += contrib;
      bal *= 1 + row[m - 1];
      if (bal < 0) bal = 0;                          // 月報酬理論下限 -100%
      if (m % 12 === 0) { yearVals[m / 12][p] = bal; yp[m / 12] = bal; }
    }
    yearPaths.push(yp);
  }

  const series = yearVals.map((arr, y) => {
    const sorted = Float64Array.prototype.slice.call(arr).sort((a, b) => a - b);
    const p10 = quantile(sorted, 0.10), p50 = quantile(sorted, 0.50), p90 = quantile(sorted, 0.90);
    return { year: y, p10, p50, p90, band: [p10, p90], invested: mode === "lump" ? budget : budget * y * 12 };
  });

  const invested = mode === "lump" ? budget : budget * months;
  const finalsArr = Float64Array.prototype.slice.call(yearVals[years]);
  const finalsSorted = finalsArr.slice().sort((a, b) => a - b);
  const medianFinal = quantile(finalsSorted, 0.50);
  const risk = riskMetrics(finalsArr, yearPaths, { target: target != null ? target : invested, invested });

  return { series, invested, medianFinal, medianMultiple: invested ? medianFinal / invested : 0, risk, paths: N };
}

/* ---------- 歷史滾動回測（校驗用） ----------
   不抽樣、不 recenter：直接用歷史月報酬 pool 的每一段連續 years 視窗，跑實際定期定額/單筆，
   得各視窗期末資產分布（p10/p50/p90）與最近一段視窗的逐年序列（last）。
   用來和模擬的機率帶對照：歷史實績理應落在 P10–P90 之間。               */
export function historicalBacktest({ pool = HIST_RETURNS.monthly, mode, budget, years }) {
  const months = years * 12;
  const start = mode === "lump" ? budget : 0;
  const contrib = mode === "monthly" ? budget : 0;
  const runWindow = (offset, keepSeries) => {
    let bal = start;
    const series = keepSeries ? [{ year: 0, total: bal, invested: start }] : null;
    for (let m = 1; m <= months; m++) {
      bal += contrib;
      bal *= 1 + pool[offset + m - 1];
      if (bal < 0) bal = 0;
      if (keepSeries && m % 12 === 0) series.push({ year: m / 12, total: bal, invested: mode === "lump" ? budget : budget * m });
    }
    return { final: bal, series };
  };
  const windows = pool.length - months + 1;
  const finals = [];
  for (let o = 0; o < windows; o++) finals.push(runWindow(o, false).final);
  const sorted = finals.slice().sort((a, b) => a - b);
  const lastWin = runWindow(Math.max(0, windows - 1), true);
  const invested = mode === "lump" ? budget : budget * months;
  return {
    windows: Math.max(0, windows),
    finals,
    p10: quantile(sorted, 0.10), p50: quantile(sorted, 0.50), p90: quantile(sorted, 0.90),
    invested,
    last: { finalValue: lastWin.final, series: lastWin.series },
  };
}

/* ---------- 實質購買力平減 ----------
   把名目序列平減為「今天的購買力」：第 y 年的值除以 (1+infl)^y。
   平減 p10/p50/p90/invested/total/hist 與 band 兩端；infl=0 時原樣回傳。       */
export function toReal(series, { infl = 0 } = {}) {
  const r = (Math.max(0, +infl || 0)) / 100;
  if (r === 0) return series.map((pt) => ({ ...pt }));
  const KEYS = ["p10", "p50", "p90", "invested", "total", "hist"];
  return series.map((pt) => {
    const f = Math.pow(1 + r, pt.year || 0);
    const out = { ...pt };
    for (const k of KEYS) if (typeof out[k] === "number") out[k] = out[k] / f;
    if (Array.isArray(out.band)) out.band = out.band.map((v) => v / f);
    return out;
  });
}

/* ---------- 風險指標：最大回撤分布 / CVaR / 達標率 ----------
   finals：各路徑期末資產陣列；paths2D：各路徑「資產價值序列」（用來算回撤）。
   - maxDrawdownP50/P90：各路徑最大回撤（峰到谷跌幅）的中位數與第 90 百分位（愈高愈差）。
   - cvar05：期末最差 5%（至少 1 筆）的平均資產（Expected Shortfall）。
   - successRate：期末 ≥ target 的比例，落在 [0,1]。                       */
export function riskMetrics(finals, paths2D, { target, invested } = {}) {
  const n = finals.length || 1;
  const sortedFinals = finals.slice().sort((a, b) => a - b);
  const k = Math.max(1, Math.floor(0.05 * n));
  let cvarSum = 0;
  for (let i = 0; i < k; i++) cvarSum += sortedFinals[i];
  const cvar05 = cvarSum / k;
  const successRate = target != null
    ? finals.reduce((s, v) => s + (v >= target ? 1 : 0), 0) / n
    : null;

  const dd = paths2D.map((row) => {
    let peak = -Infinity, maxDD = 0;
    for (const v of row) { if (v > peak) peak = v; if (peak > 0) { const d = (peak - v) / peak; if (d > maxDD) maxDD = d; } }
    return maxDD;
  }).sort((a, b) => a - b);
  const maxDrawdownP50 = quantile(dd, 0.50);
  const maxDrawdownP90 = quantile(dd, 0.90);

  return { maxDrawdownP50, maxDrawdownP90, cvar05, successRate, invested };
}

/* ---------- 台股歷史月報酬（含息，平穩拔靴用） ----------
   來源：FinMind TaiwanStockTotalReturnIndex（data_id=TAIEX，發行量加權股價「報酬」指數，
   股利已再投入），取每月最後交易日收盤計算月報酬。區間 2003-02..2026-05，共 280 筆。
   實現年化約 15.8%、年化波動約 19%；拔靴時可用 recenterTo 把均值平移到使用者的報酬假設，
   僅借用歷史的波動結構、厚尾與序列相依，不強加歷史的高報酬。資料日期：2026-06-17 擷取。 */
export const HIST_RETURNS = {
  range: "2003-02..2026-05",
  source: "FinMind TaiwanStockTotalReturnIndex / TAIEX 含息報酬指數",
  monthly: [
    -0.116187, -0.025096, -0.039978, 0.098715, 0.073406, 0.105659, 0.067119, -0.006520, 0.077372, -0.045207, 0.020607, 0.082294,
    0.058845, -0.033827, -0.062001, -0.022145, -0.018513, -0.055182, 0.072050, 0.014444, -0.023829, 0.024347, 0.050573, -0.023691,
    0.035655, -0.032532, -0.031238, 0.033438, 0.045022, 0.030105, -0.032915, 0.016606, -0.057830, 0.076202, 0.055618, -0.002467,
    0.004508, 0.007977, 0.084338, -0.045164, -0.014607, -0.019739, 0.039887, 0.042141, 0.020177, 0.077823, 0.033835, -0.015859,
    0.026276, -0.002222, -0.001140, 0.034299, 0.098398, 0.063023, -0.024132, 0.056271, 0.024902, -0.115827, -0.009296, -0.115814,
    0.118550, 0.018998, 0.040517, -0.033702, -0.122420, -0.038300, 0.014980, -0.185864, -0.145339, -0.084206, 0.029308, -0.074761,
    0.072783, 0.143440, 0.150021, 0.149864, -0.065490, 0.118738, -0.026550, 0.100811, -0.022503, 0.032987, 0.079911, -0.066885,
    -0.026746, 0.065084, 0.010630, -0.078634, -0.005474, 0.084620, -0.008449, 0.082382, 0.006005, 0.010307, 0.071680, 0.019265,
    -0.059670, 0.009727, 0.037379, -0.001977, -0.032377, 0.023279, -0.096289, -0.065524, 0.050357, -0.090080, 0.024327, 0.062924,
    0.080398, -0.023202, -0.054365, -0.026476, 0.000280, 0.021728, 0.027579, 0.043481, -0.071134, 0.057790, 0.015742, 0.019549,
    0.006109, 0.002611, 0.022150, 0.019982, -0.022315, 0.024707, -0.002799, 0.020011, 0.033978, -0.005086, 0.024365, -0.017296,
    0.020916, 0.024273, -0.006537, 0.032465, 0.037926, 0.009085, 0.022071, -0.048972, 0.000970, 0.023668, 0.013073, 0.005872,
    0.027793, -0.003706, 0.024368, -0.012064, -0.031509, -0.053748, -0.047569, 0.004232, 0.045693, -0.027297, 0.002096, -0.023129,
    0.032651, 0.039670, -0.041960, 0.018888, 0.026477, 0.054287, 0.018928, 0.014149, 0.013534, -0.005212, 0.001384, 0.021014,
    0.032019, 0.006262, 0.006164, 0.017134, 0.044901, 0.023089, 0.023821, -0.018200, 0.039542, -0.021605, 0.007822, 0.043308,
    -0.025965, 0.009617, -0.023958, 0.020393, 0.005993, 0.043114, 0.008384, -0.004156, -0.109388, 0.008821, -0.016244, 0.021060,
    0.046002, 0.024244, 0.030701, -0.042748, 0.032390, 0.031061, -0.011231, 0.022315, 0.049058, 0.011609, 0.046049, -0.041847,
    -0.017621, -0.138174, 0.132562, -0.004498, 0.067854, 0.108182, -0.000350, -0.003444, 0.002494, 0.093798, 0.075200, 0.027547,
    0.053869, 0.031371, 0.069653, -0.028310, 0.043114, -0.019877, 0.022964, -0.028639, 0.003235, 0.025959, 0.046790, -0.029811,
    -0.001181, 0.004295, -0.061707, 0.013096, -0.103988, 0.030848, 0.011862, -0.108380, -0.035325, 0.149060, -0.048331, 0.079769,
    0.015633, 0.025942, -0.017412, 0.064374, 0.034803, 0.024304, -0.025620, -0.014793, -0.021506, 0.089558, 0.030058, -0.001590,
    0.060214, 0.072260, 0.005786, 0.038200, 0.092835, -0.026348, 0.006200, 0.000046, 0.026823, -0.024419, 0.036297, 0.021937,
    -0.020073, -0.100221, -0.021992, 0.055162, 0.051959, 0.069287, 0.031851, 0.067877, 0.093469, -0.021492, 0.049935, 0.107574,
    0.104502, -0.102498, 0.227244, 0.149199
  ],
};
