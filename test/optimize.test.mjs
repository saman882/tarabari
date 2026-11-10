import { optimizeOrder, pathCost, haversine } from '../src/optimize.js';
import assert from 'node:assert/strict';
const pts = (n, seed) => { let s = seed; const r = () => (s = (s * 16807) % 2147483647) / 2147483647; return Array.from({ length: n }, () => [35 + r(), 51 + r()]); };
const mat = (p) => p.map(a => p.map(b => haversine(a, b) * 1.3));
function brute(m, ranks) {
  const n = ranks.length; let best = Infinity, bo;
  const R = ranks.map(r => r == null ? Infinity : r);
  const perm = (arr, used) => { if (arr.length === n) { for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) if (R[arr[j]] < R[arr[i]]) return; const c = pathCost(m, arr); if (c < best) { best = c; bo = [...arr]; } return; }
    for (let k = 0; k < n; k++) if (!used[k]) { used[k] = 1; arr.push(k); perm(arr, used); arr.pop(); used[k] = 0; } };
  perm([], []); return best;
}
// 1) سه مقصد: نزدیک‌ترین سومی است ولی اولویت دارد
{ const o = [35.7, 51.4]; const p = [o, [35.71, 51.41], [35.8, 51.5], [35.9, 51.6]];
  const m = mat(p); assert.deepEqual(optimizeOrder(m, [null, null, null]), [0, 1, 2]);
  assert.deepEqual(optimizeOrder(m, [null, null, 1]), [2, 1, 0]); console.log('priority-first OK'); }
// 2) دقیق در برابر brute force
for (let t = 0; t < 40; t++) { const p = pts(8, t + 7); const m = mat(p); const ranks = Array.from({ length: 7 }, (_, i) => [null, null, 1, 2, null, 1, null][(i + t) % 7]);
  const o = optimizeOrder(m, ranks); assert.equal(new Set(o).size, 7);
  assert.ok(Math.abs(pathCost(m, o) - brute(m, ranks)) < 1e-6, 'not optimal t=' + t);
  const R = ranks.map(r => r ?? Infinity); for (let i = 1; i < o.length; i++) assert.ok(R[o[i]] >= R[o[i - 1]]); }
console.log('held-karp exact OK');
// 3) heuristic بزرگ
{ const p = pts(31, 99); const m = mat(p); const ranks = Array.from({ length: 30 }, (_, i) => i % 7 === 0 ? 1 : null);
  const o = optimizeOrder(m, ranks); assert.equal(new Set(o).size, 30); const R = ranks.map(r => r ?? Infinity);
  for (let i = 1; i < o.length; i++) assert.ok(R[o[i]] >= R[o[i - 1]]); console.log('heuristic OK', Math.round(pathCost(m, o) / 1000), 'km'); }
// 4) زمان برای 13 مقصد
{ const p = pts(14, 5); const m = mat(p); const t0 = Date.now(); optimizeOrder(m, Array(13).fill(null)); console.log('13 stops ms', Date.now() - t0); }
