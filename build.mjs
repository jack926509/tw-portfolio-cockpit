// 選用建置步驟：把 index.html 內的瀏覽器端 JSX 預先編譯成純 JS，
// 產出 dist/index.html —— 不再載入 @babel/standalone，首屏明顯更快。
//
// 用法：
//   npm install        # 安裝 esbuild（需連網）
//   npm run build      # 產出 dist/index.html
//
// 原始 index.html 仍可直接開啟使用（零安裝），dist/ 為想要最快載入時的正式版。

import { build } from "esbuild";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(__dirname, "index.html");
const OUT_DIR = resolve(__dirname, "dist");
const OUT = resolve(OUT_DIR, "index.html");

const html = await readFile(SRC, "utf8");

// 1) 取出 <script type="text/babel"> ... </script> 的 JSX 原始碼
const babelRe = /<script type="text\/babel"[^>]*>([\s\S]*?)<\/script>/;
const m = html.match(babelRe);
if (!m) {
  console.error("找不到 <script type=\"text/babel\"> 區塊，build 中止。");
  process.exit(1);
}

// 2) 用 esbuild 把 JSX 編譯成純 JS 並壓縮（不打包，React/Recharts 仍走 CDN 全域變數）
const { code } = await build({
  stdin: { contents: m[1], loader: "jsx", resolveDir: __dirname },
  jsx: "transform",
  bundle: false,
  minify: true,
  write: false,
  format: "iife",
  target: ["es2018"],
}).then((r) => ({ code: r.outputFiles[0].text }));

// 2b) 把 engine.mjs 打包成 IIFE 全域 Engine 並內聯（維持單一檔零安裝，正式版不需 module 請求）
const { code: engineCode } = await build({
  entryPoints: [resolve(__dirname, "engine.mjs")],
  bundle: true,
  minify: true,
  write: false,
  format: "iife",
  globalName: "Engine",
  target: ["es2018"],
  footer: { js: "window.Engine=Engine;" },
}).then((r) => ({ code: r.outputFiles[0].text }));

// 3) 移除 @babel/standalone 與 dev 用的 engine module，內聯引擎，再用編譯後純 JS 取代 babel 區塊
let out = html.replace(/\s*<script src="https?:\/\/[^"]*@babel\/standalone[^"]*"[^>]*><\/script>/, "");
out = out.replace(/\s*<script type="module">import \* as E from "\.\/engine\.mjs";[^<]*<\/script>/, "");
out = out.replace(babelRe, `<script>\n${engineCode}\n</script>\n<script>\n${code}</script>`);

await mkdir(OUT_DIR, { recursive: true });
await writeFile(OUT, out, "utf8");
console.log("已產出", OUT, "（已移除瀏覽器端 Babel，", code.length, "bytes JS）");
