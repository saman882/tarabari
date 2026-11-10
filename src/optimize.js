// بهینه‌سازی ترتیب مقصدها با رعایت اولویت
// matrix[i][j]: هزینه (متر) از نقطه i به j. اندیس 0 = مبدأ، 1..n = مقصدها
// ranks[k] برای مقصد k (0-based): عدد اولویت (1 = اول) یا null = بدون اولویت
// قانون: مقصدی با اولویت عددی کوچک‌تر همیشه قبل از مقصدهای با اولویت بزرگ‌تر/بدون اولویت دیده می‌شود.
// خروجی: آرایه‌ی اندیس مقصدها (0-based) به ترتیب بازدید

const BIG = 1e12;
const cost = (m, i, j) => {
  const v = m[i]?.[j];
  return v == null || !Number.isFinite(v) ? BIG : v;
};
const rankOf = (r) => (r == null || r === '' ? Infinity : Number(r));

export function optimizeOrder(matrix, ranks, { exactLimit = 15 } = {}) {
  const n = ranks.length;
  if (n === 0) return [];
  if (n === 1) return [0];
  const R = ranks.map(rankOf);
  return n <= exactLimit ? heldKarp(matrix, R) : heuristic(matrix, R);
}

// برنامه‌ریزی پویا (جواب دقیق) با محدودیت تقدم
function heldKarp(m, R) {
  const n = R.length;
  const full = (1 << n) - 1;
  // need[j] = ماسک مقصدهایی که باید قبل از j دیده شوند
  const need = R.map((rj) => R.reduce((acc, ri, i) => (ri < rj ? acc | (1 << i) : acc), 0));
  const size = 1 << n;
  const dp = new Float64Array(size * n).fill(Infinity);
  const par = new Int8Array(size * n).fill(-1);
  for (let j = 0; j < n; j++) if (need[j] === 0) dp[(1 << j) * n + j] = cost(m, 0, j + 1);
  for (let mask = 1; mask <= full; mask++) {
    for (let j = 0; j < n; j++) {
      const cur = dp[mask * n + j];
      if (cur === Infinity) continue;
      for (let k = 0; k < n; k++) {
        const bit = 1 << k;
        if (mask & bit) continue;
        if ((need[k] & mask) !== need[k]) continue;
        const nm = mask | bit;
        const v = cur + cost(m, j + 1, k + 1);
        if (v < dp[nm * n + k]) { dp[nm * n + k] = v; par[nm * n + k] = j; }
      }
    }
  }
  let best = Infinity, last = -1;
  for (let j = 0; j < n; j++) if (dp[full * n + j] < best) { best = dp[full * n + j]; last = j; }
  const order = [];
  let mask = full;
  while (last !== -1) {
    order.push(last);
    const p = par[mask * n + last];
    mask &= ~(1 << last);
    last = p;
  }
  return order.reverse();
}

// برای تعداد زیاد مقصد: نزدیک‌ترین همسایه در هر گروه اولویت + بهبود 2-opt داخل هر گروه
function heuristic(m, R) {
  const groups = [...new Set(R)].sort((a, b) => a - b).map((r) => R.map((x, i) => (x === r ? i : -1)).filter((i) => i >= 0));
  const order = [];
  let at = 0; // اندیس ماتریس
  for (const g of groups) {
    const left = new Set(g);
    const seg = [];
    while (left.size) {
      let best = -1, bv = Infinity;
      for (const k of left) { const v = cost(m, at, k + 1); if (v < bv) { bv = v; best = k; } }
      seg.push(best); left.delete(best); at = best + 1;
    }
    const startNode = order.length ? order[order.length - 1] + 1 : 0;
    twoOpt(m, seg, startNode);
    order.push(...seg);
    at = order[order.length - 1] + 1;
  }
  return order;
}

function twoOpt(m, seg, startNode) {
  const node = (i) => (i < 0 ? startNode : seg[i] + 1);
  let improved = true, guard = 0;
  while (improved && guard++ < 200) {
    improved = false;
    for (let i = 0; i < seg.length - 1; i++) {
      for (let k = i + 1; k < seg.length; k++) {
        const a = node(i - 1), b = node(i), c = node(k), d = k + 1 < seg.length ? node(k + 1) : null;
        const before = cost(m, a, b) + (d == null ? 0 : cost(m, c, d));
        const after = cost(m, a, c) + (d == null ? 0 : cost(m, b, d));
        // مسیر نامتقارن است؛ معکوس کردن بخش میانی را هم در نظر بگیر
        let inner = 0, innerRev = 0;
        for (let t = i; t < k; t++) { inner += cost(m, node(t), node(t + 1)); innerRev += cost(m, node(t + 1), node(t)); }
        if (after + innerRev + 1e-6 < before + inner) {
          const rev = seg.slice(i, k + 1).reverse();
          seg.splice(i, rev.length, ...rev);
          improved = true;
        }
      }
    }
  }
}

export function pathCost(matrix, order) {
  let s = 0, at = 0;
  for (const k of order) { s += cost(matrix, at, k + 1); at = k + 1; }
  return s;
}

// فاصله‌ی مستقیم (برای حالت بدون اینترنتِ سرویس مسیریابی)
export function haversine(a, b) {
  const R = 6371000, rad = Math.PI / 180;
  const dLat = (b[0] - a[0]) * rad, dLng = (b[1] - a[1]) * rad;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * rad) * Math.cos(b[0] * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}
