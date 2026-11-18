// ============================================================================
// math: seeded RNG, mesh builder, and the f32-exact terrain function.
// The noise / height code below is mirrored op-for-op in WGSL (shaders.js):
// every arithmetic step goes through Math.fround so the CPU-built near terrain,
// the GPU-displaced far mountains and the water-depth shading agree bit-for-bit.
// ============================================================================

// ---------------------------------------------------------------- rng
let _s = 0;
const rseed = (s) => { _s = s | 0; };
const rnd = () => {
  _s = (_s + 0x6D2B79F5) | 0;
  let t = Math.imul(_s ^ (_s >>> 15), 1 | _s);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const rr = (a, b) => a + (b - a) * rnd();
const fract = (x) => x - Math.floor(x);
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const mix = (a, b, w) => a + (b - a) * w;
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const hypot = Math.hypot;
const TAU = Math.PI * 2;

// ---------------------------------------------------------------- quaternion helpers
const qAxis = (x, y, z, a) => { const s = Math.sin(a / 2); const l = hypot(x, y, z) || 1; return [x / l * s, y / l * s, z / l * s, Math.cos(a / 2)]; };
const qMul = (a, b) => [
  a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
  a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
  a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]];
const qFromY = (x, y, z) => { // shortest rotation taking +Y to (x,y,z)
  const d = hypot(x, z);
  if (d < 1e-6) return y > 0 ? [0, 0, 0, 1] : [1, 0, 0, 0];
  const c = y, s = Math.sqrt(Math.max(0, 1 - c * c));
  return [s * (-z / d), 0, s * (x / d), c];
};
const qRand = () => qMul(qAxis(rr(-1, 1), rr(-1, 1), rr(-1, 1), rr(0, TAU)), qMul(qAxis(0, 1, 0, rr(0, TAU)), qAxis(1, 0, 0, Math.acos(rr(-1, 1)))));
const qrot = (q, v) => { // v + 2*cross(q.xyz, cross(q.xyz, v) + q.w*v)
  const qx = q[0], qy = q[1], qz = q[2], qw = q[3];
  const tx = 2 * (qy * v[2] - qz * v[1]), ty = 2 * (qz * v[0] - qx * v[2]), tz = 2 * (qx * v[1] - qy * v[0]);
  return [v[0] + qw * tx + (qy * tz - qz * ty), v[1] + qw * ty + (qz * tx - qx * tz), v[2] + qw * tz + (qx * ty - qy * tx)];
};

// ---------------------------------------------------------------- f32-exact noise (twin of the WGSL block in shaders.js)
const f = Math.fround;
const ih = (ix, iz, s) => { // integer hash -> f32 in [0,1)
  let q = ((Math.imul(ix | 0, 73856093) ^ Math.imul(iz | 0, 19349663) ^ Math.imul(s | 0, 83492791)) >>> 0);
  q = ((q ^ (q >>> 13)) >>> 0); q = Math.imul(q, 1274126177) >>> 0;
  q = (q ^ (q >>> 16)) >>> 0;
  return f((q & 16777215) * 5.9604645e-8);
};
const vn2 = (x, z, s) => { // value noise, f32 semantics
  x = f(x); z = f(z);
  const px = f(Math.floor(x)), pz = f(Math.floor(z));
  const fx = f(x - px), fz = f(z - pz);
  const ux = f(f(fx * fx) * f(3 - f(2 * fx)));
  const uz = f(f(fz * fz) * f(3 - f(2 * fz)));
  const a = ih(px | 0, pz | 0, s), b = ih((px | 0) + 1, pz | 0, s);
  const c = ih(px | 0, (pz | 0) + 1, s), d = ih((px | 0) + 1, (pz | 0) + 1, s);
  const ab = f(a + f(f(b - a) * ux));
  return f(ab + f(f(f(c + f(f(d - c) * ux)) - ab) * uz));
};
const fbm2 = (x, z, s, oct) => { // fractal value noise
  let a = f(0.5), sum = f(0), px = f(x), pz = f(z);
  for (let i = 0; i < oct; i++) {
    sum = f(sum + f(a * vn2(px, pz, s + i * 101)));
    px = f(f(px * 2.02) + 13.7); pz = f(f(pz * 2.02) + 7.3);
    a = f(a * 0.5);
  }
  return sum;
};
const rid2 = (x, z, s, oct) => { // ridged multifractal (mountain spines)
  let a = f(0.5), sum = f(0), px = f(x), pz = f(z);
  for (let i = 0; i < oct; i++) {
    const n = vn2(px, pz, s + i * 101);
    const r = f(1 - f(f(n * 2) - 1)), ra = f(Math.abs(r));
    sum = f(sum + f(a * f(ra * ra)));
    px = f(f(px * 2.13) + 7.7); pz = f(f(pz * 2.13) + 3.1);
    a = f(a * 0.5);
  }
  return sum;
};
const fss = (a, b, x) => { // f32-exact smoothstep
  let t = f(f(f(f(x) - f(a)) / f(f(b) - f(a))));
  t = Math.min(1, Math.max(0, t));
  return f(f(t * t) * f(3 - f(2 * t)));
};
const fmix = (a, b, w) => f(f(f(a)) + f(f(f(f(b)) - f(f(a))) * f(f(w))));
const flen2 = (x, y) => f(Math.sqrt(f(f(x * x) + f(y * y))));

// ---------------------------------------------------------------- world constants (mirrored in WGSL)
const OX = -768, OZ = -768, EXT = 1536;      // near terrain spans [OX, -OX]^2
const CELLS = 24, CELLW = 64;                // instance culling grid
const GN = 391, GSTEP = 4;                   // height grid: 391 x 391 samples, 4 m apart
const FZ = 312, FZ2 = 300;                   // waterfall lip / pool z
const XR300 = 24 * Math.sin(FZ2 * 0.005 + 1.3) + 48 * Math.sin(FZ2 * 0.0021 + 4.2) + 8 * Math.sin(FZ2 * 0.013 + 0.5);
const XRG = XR300 + 17;                      // grotto bowl centre (alcove beside the pool)
const FCP = [246, 470];                      // fortress centre
const FCH = 342;                             // fortress plateau top
// ramp to the gate: x, z, y of each control point
const RAMP = [[12, 436, 150], [70, 442, 196], [118, 414, 252], [158, 448, 300], [192, 466, 344]];
// river-side footpath: sampled tint curve x = xr(z) + off
const RIVP = [];

// ---------------------------------------------------------------- terrain height (twin of terrH in shaders.js)
const sinf = (x) => f(Math.sin(x));
function terrH(x0, z0) {
  x0 = f(x0); z0 = f(z0);
  const wx = f(fbm2(f(f(x0 * 0.0013) + 13.1), f(f(z0 * 0.0013) + 7.7), 11, 3) - 0.5);
  const wz = f(fbm2(f(f(x0 * 0.0013) + 3.7), f(f(z0 * 0.0013) + 29.3), 17, 3) - 0.5);
  const qx = f(x0 + f(wx * 150)), qz = f(z0 + f(wz * 150));
  const big = fbm2(f(qx * 0.0016), f(qz * 0.0016), 31, 4);
  const r1 = rid2(f(qx * 0.0032), f(qz * 0.0032), 41, 4);
  const hills = fbm2(f(qx * 0.0085), f(qz * 0.0085), 51, 3);
  const south = fss(140, 540, z0), east = fss(40, 500, x0);
  let msf = f(f(south * 0.55) + f(east * 0.45));
  msf = f(f(msf * msf) * f(3 - f(2 * msf)));
  let h = f(f(112 + f(f(f(big - 0.5) * 110) + f(hills * 22))));
  h = f(h + f(msf * f(f(70 + f(360 * r1)) + f(90 * hills))));
  // western hills: the forested ridge that faces the valley
  const westM = f(f(fss(-160, -500, x0)) * f(f(0.4 + f(0.6 * fss(-200, 100, z0)))));
  const rw = rid2(f(qx * 0.0038 + 4.7), f(qz * 0.0038 + 8.1), 43, 4);
  h = f(h + f(westM * f(f(60 + f(150 * rw)) + f(40 * hills))));
  // rock shelves on high ridges
  h = f(h + f(fss(0.62, 0.85, r1) * f(fss(240, 420, h) * 18)));
  // river valley
  const xr = f(f(f(24 * sinf(f(f(z0 * 0.005) + 1.3))) + f(48 * sinf(f(f(z0 * 0.0021) + 4.2)))) + f(8 * sinf(f(f(z0 * 0.013) + 0.5))));
  const d = f(Math.abs(f(x0 - xr)));
  let vly = f(fss(150, 42, d) * 0.9);
  const vf = f(148 + f(f(big - 0.5) * 10));
  h = fmix(h, vf, vly);
  // channel + pool masks
  let bedD = f(1 - fss(15, 30, d));
  const pd = flen2(f(x0 - XR300), f(z0 - FZ2));
  const poolD = f(1 - fss(20, 34, pd));
  const northOfLip = fss(FZ, FZ2, z0);
  bedD = f(Math.max(bedD, f(poolD * northOfLip)));
  bedD = f(bedD * fss(374, 352, z0));                 // the river springs out of the hills
  const wyU = f(144 + f(f(z0 - FZ) * 0.022));
  const wyD = f(120.5 + f(f(z0 - 296) * 0.012));
  let bed = fmix(f(wyD - 2.4), f(wyU - 2.0), fss(FZ2, FZ, z0));
  bed = fmix(bed, 116.6, f(poolD * northOfLip));
  h = fmix(h, bed, bedD);
  // grotto alcove beside the pool: a level terrace the dome shell covers
  const gd = flen2(f(x0 - XRG), f(z0 - 300));
  const gb = f(1 - fss(9.5, 14, gd));
  h = fmix(h, 121.5, gb);
  // fortress plateau + causeway ramp (embankment: raise-only)
  const pfd = flen2(f(x0 - FCP[0]), f(z0 - FCP[1]));
  const pf = f(1 - fss(46, 82, pfd));
  h = fmix(h, f(FCH + f(f(hills - 0.5) * 3.2)), pf);
  for (let k = 0; k < 4; k++) {
    const A = RAMP[k], B = RAMP[k + 1];
    const bax = f(B[0] - A[0]), baz = f(B[1] - A[1]);
    const pax = f(x0 - A[0]), paz = f(z0 - A[1]);
    const bb = f(f(bax * bax) + f(baz * baz));
    let t = f((f(f(pax * bax) + f(paz * baz))) / f(Math.max(bb, 1e-4)));
    t = Math.min(1, Math.max(0, t));
    const cx = f(pax - f(bax * t)), cz = f(paz - f(baz * t));
    const dd = flen2(cx, cz);
    const m = f(1 - fss(7, 15, dd));
    const y = f(A[2] + f(f(B[2] - A[2]) * t));
    h = Math.max(h, fmix(h, y, m));
  }
  // fine detail
  h = f(h + f(f(fbm2(f(x0 * 0.045), f(z0 * 0.045), 61, 2) - 0.5) * 2.4));
  h = f(h + f(f(fbm2(f(x0 * 0.13), f(z0 * 0.13), 67, 2) - 0.5) * 0.5));
  return h;
}

// water surface height inside the channel / pool (JS only: camera + placement)
const waterAt = (x, z) => {
  const xr = 24 * Math.sin(z * 0.005 + 1.3) + 48 * Math.sin(z * 0.0021 + 4.2) + 8 * Math.sin(z * 0.013 + 0.5);
  const d = Math.abs(x - xr);
  const pd = hypot(x - XR300, z - FZ2);
  let m = 1 - sstep(15, 30, d);
  m = Math.max(m, (1 - sstep(20, 34, pd)) * sstep(FZ, FZ2, z));
  m *= sstep(374, 352, z);
  if (m < 0.45) return null;
  const y = mix(120.5 + (z - 296) * 0.012, 144 + (z - FZ) * 0.022, sstep(307.5, 309.5, z));
  return y;
};

// ---------------------------------------------------------------- mesh builder
class Mesh {
  constructor() { this.p = []; this.n = []; this.a = []; this.ib = []; }
  v(x, y, z, aux = 1, nu = 0, nv = 0, nw = 0) { this.p.push(x, y, z); this.n.push(nu, nv, nw); this.a.push(aux); return this.p.length / 3 - 1; }
  quad(a, b, c, d) { this.ib.push(a, b, c, a, c, d); }
  tri(a, b, c) { this.ib.push(a, b, c); }
  // box with yaw about its centre; tone = material aux
  box(cx, cy, cz, sx, sy, sz, yaw, tone) {
    const cs = Math.cos(yaw), sn = Math.sin(yaw);
    const V = [], N = [[0, 0, 1], [0, 0, -1], [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0]];
    for (let i = 0; i < 8; i++) {
      const x = (i & 1 ? 0.5 : -0.5) * sx, y = (i & 2 ? 0.5 : -0.5) * sy, z = (i & 4 ? 0.5 : -0.5) * sz;
      V.push(this.v(cx + x * cs + z * sn, cy + y, cz + z * cs - x * sn, tone));
    }
    const F = [[1, 3, 7, 5], [4, 6, 2, 0], [2, 6, 7, 3], [0, 1, 5, 4], [5, 7, 6, 4], [0, 2, 3, 1]];
    for (let i = 0; i < 6; i++) { const q = F[i]; this.quad(V[q[0]], V[q[1]], V[q[2]], V[q[3]]); }
    return this;
  }
  // round tube along a polyline; rad(k01), aux(k01); sides segments
  tube(pts, rad, sides, capEnd, aux) {
    const rings = [];
    for (let k = 0; k < pts.length; k++) {
      const p = pts[k], prev = pts[Math.max(0, k - 1)], next = pts[Math.min(pts.length - 1, k + 1)];
      let tx = next[0] - prev[0], ty = next[1] - prev[1], tz = next[2] - prev[2];
      const tl = hypot(tx, ty, tz) || 1; tx /= tl; ty /= tl; tz /= tl;
      let ux = -tz, uy = 0, uz = tx; const ul = hypot(ux, uy, uz) || 1; ux /= ul; uz /= ul; // horizontal axis
      // second axis = t x u
      const wx = ty * uz - tz * uy, wy = tz * ux - tx * uz, wz = tx * uy - ty * ux;
      const r = rad(k / (pts.length - 1)), au = aux ? aux(k / (pts.length - 1)) : 1;
      const ring = [];
      for (let s = 0; s <= sides; s++) {
        const a = s / sides * TAU, ca = Math.cos(a), sa = Math.sin(a);
        const nx = ux * ca + wx * sa, ny = uy * ca + wy * sa, nz = uz * ca + wz * sa;
        ring.push(this.v(p[0] + nx * r, p[1] + ny * r, p[2] + nz * r, au, nx * 127, ny * 127, nz * 127));
      }
      rings.push(ring);
    }
    for (let k = 0; k < rings.length - 1; k++)
      for (let s = 0; s < sides; s++) this.quad(rings[k][s], rings[k][s + 1], rings[k + 1][s + 1], rings[k + 1][s]);
    if (capEnd) {
      const e = rings[rings.length - 1], c = this.v(pts[pts.length - 1][0], pts[pts.length - 1][1], pts[pts.length - 1][2], aux ? aux(1) : 1, 0, 127, 0);
      for (let s = 0; s < sides; s++) this.tri(e[s], e[s + 1], c);
      const s0 = rings[0], c0 = this.v(pts[0][0], pts[0][1], pts[0][2], aux ? aux(0) : 1, 0, -127, 0);
      for (let s = 0; s < sides; s++) this.tri(s0[s], c0, s0[s + 1]);
    }
    return this;
  }
  // surface of revolution around a vertical axis at (cx, cz), profile [[r, y, aux], ...]
  lathe(prof, seg, cap, cx = 0, cz = 0) {
    const rings = [];
    for (const [r, y, au] of prof) {
      const ring = [];
      for (let s = 0; s <= seg; s++) {
        const a = s / seg * TAU, ca = Math.cos(a), sa = Math.sin(a);
        ring.push(this.v(cx + ca * r, y, cz + sa * r, au, sa * 127, 0, ca * 127));
      }
      rings.push(ring);
    }
    for (let k = 0; k < rings.length - 1; k++)
      for (let s = 0; s < seg; s++) this.quad(rings[k][s], rings[k][s + 1], rings[k + 1][s + 1], rings[k + 1][s]);
    if (cap) {
      const t = rings[0], c = this.v(cx, prof[0][1], cz, prof[0][2], 0, -127, 0);
      for (let s = 0; s < seg; s++) this.tri(t[s], c, t[s + 1]);
    }
    return rings;
  }
  // normals from triangle geometry, packed f32x3 + snorm8x4
  build(keepAux = false) {
    const nv = this.p.length / 3, nr = new Float32Array(nv * 3);
    for (let i = 0; i < this.ib.length; i += 3) {
      const a = this.ib[i] * 3, b = this.ib[i + 1] * 3, c = this.ib[i + 2] * 3;
      const ax = this.p[a], ay = this.p[a + 1], az = this.p[a + 2];
      const e1x = this.p[b] - ax, e1y = this.p[b + 1] - ay, e1z = this.p[b + 2] - az;
      const e2x = this.p[c] - ax, e2y = this.p[c + 1] - ay, e2z = this.p[c + 2] - az;
      const nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
      nr[a] += nx; nr[a + 1] += ny; nr[a + 2] += nz;
      nr[b] += nx; nr[b + 1] += ny; nr[b + 2] += nz;
      nr[c] += nx; nr[c + 1] += ny; nr[c + 2] += nz;
    }
    const vb = new ArrayBuffer(nv * 16), vf = new Float32Array(vb), v8 = new Int8Array(vb);
    for (let k = 0; k < nv; k++) {
      let nx = nr[k * 3], ny = nr[k * 3 + 1], nz = nr[k * 3 + 2];
      const l = hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
      vf[k * 4] = this.p[k * 3]; vf[k * 4 + 1] = this.p[k * 3 + 1]; vf[k * 4 + 2] = this.p[k * 3 + 2];
      v8[k * 16 + 12] = Math.round(clamp(nx, -1, 1) * 127);
      v8[k * 16 + 13] = Math.round(clamp(ny, -1, 1) * 127);
      v8[k * 16 + 14] = Math.round(clamp(nz, -1, 1) * 127);
      v8[k * 16 + 15] = Math.round(clamp(this.a[k], -1, 1) * 127);
    }
    this.p = this.n = this.a = null;
    return { vb, ib: new Uint32Array(this.ib), nv, nr: keepAux ? nr : null };
  }
}

// ---------------------------------------------------------------- terrain mesh + culling grid
let GH = null; // heights grid
function buildHeights() {
  GH = new Float32Array(GN * GN);
  for (let j = 0; j < GN; j++) {
    const z = OZ + j * GSTEP;
    for (let i = 0; i < GN; i++) GH[i + GN * j] = terrH(OX + i * GSTEP, z);
  }
}
const gy = (x, z) => { // bilinear over the grid
  const gx = clamp((x - OX) / GSTEP, 0, GN - 1.001), gz = clamp((z - OX) / GSTEP, 0, GN - 1.001);
  const i = gx | 0, j = gz | 0, u = gx - i, v = gz - j;
  const a = GH[i + GN * j], b = GH[i + 1 + GN * j], c = GH[i + GN * (j + 1)], d = GH[i + 1 + GN * (j + 1)];
  return a + (b - a) * u + (c + (d - c) * u - (a + (b - a) * u)) * v;
};
const gN = (x, z) => { // terrain normal
  const e = 2.5;
  const nx = gy(x - e, z) - gy(x + e, z), nz = gy(x, z - e) - gy(x, z + e), ny = 2 * e;
  const l = hypot(nx, ny, nz) || 1;
  return [nx / l, ny / l, nz / l];
};

function buildTerrainMesh() {
  const nv = GN * GN;
  const vb = new ArrayBuffer(nv * 16), vf = new Float32Array(vb), v8 = new Int8Array(vb);
  for (let j = 0; j < GN; j++) for (let i = 0; i < GN; i++) {
    const k = i + GN * j, x = OX + i * GSTEP, z = OZ + j * GSTEP, y = GH[k];
    vf[k * 4] = x; vf[k * 4 + 1] = y; vf[k * 4 + 2] = z;
    let nx, ny = GSTEP * 2, nz;
    if (i === 0 || i === GN - 1 || j === 0 || j === GN - 1) { const n = gN(x, z); nx = n[0]; ny = n[1]; nz = n[2]; }
    else {
      nx = GH[k - 1] - GH[k + 1]; nz = GH[k - GN] - GH[k + GN];
      const l = hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    }
    const rock = clamp((hypot(nx, nz) * 1.4 - 0.55) * 1.6, -1, 1); // >0 = rocky slope, drives shading
    v8[k * 16 + 12] = Math.round(nx * 127); v8[k * 16 + 13] = Math.round(ny * 127);
    v8[k * 16 + 14] = Math.round(nz * 127); v8[k * 16 + 15] = Math.round(rock * 127);
  }
  // index buffer + per-chunk culling bounds (4 x 4 chunks), all indices in one buffer
  const NC = 4, CN = (GN - 1) / NC;
  const chunks = [], ibAll = [];
  for (let cz = 0; cz < NC; cz++) for (let cx = 0; cx < NC; cx++) {
    let lo = 1e9, hi = -1e9;
    const i0 = ibAll.length;
    for (let j = cz * CN; j < (cz + 1) * CN; j++) for (let i = cx * CN; i < (cx + 1) * CN; i++) {
      const k = i + GN * j;
      ibAll.push(k, k + 1, k + GN + 1, k, k + GN + 1, k + GN);
      for (const q of [k, k + 1, k + GN, k + GN + 1]) { const y = GH[q]; if (y < lo) lo = y; if (y > hi) hi = y; }
    }
    const x0 = OX + cx * CN * GSTEP, z0 = OZ + cz * CN * GSTEP;
    chunks.push({ i0, ic: ibAll.length - i0, x: x0 + CN * GSTEP / 2, z: z0 + CN * GSTEP / 2, hw: CN * GSTEP / 2, lo, hi });
  }
  return { vb, ib: new Uint32Array(ibAll), chunks };
}

// ---------------------------------------------------------------- far terrain mesh (positions displaced in WGSL)
function buildFarMesh() {
  const N = 81, S = 64, O = -2560; // 81x81 grid, 64 m steps, spans 5120 m
  const pos = [], ib = [];
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) pos.push(O + i * S, 0, O + j * S);
  const H = 700; // hole where the near mesh takes over
  for (let j = 0; j < N - 1; j++) for (let i = 0; i < N - 1; i++) {
    const x = O + i * S, z = O + j * S;
    if (Math.abs(x + S / 2) < H && Math.abs(z + S / 2) < H) continue;
    const k = i + N * j;
    ib.push(k, k + 1, k + N + 1, k, k + N + 1, k + N);
  }
  return { vb: new Float32Array(pos), ib: new Uint32Array(ib), nv: pos.length / 3 };
}
