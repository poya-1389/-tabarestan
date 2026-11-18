// ============================================================================
// makeWorld: placement of everything, packed into culling cells (load-time)
// ============================================================================

function makeWorld() {
  const nCells = CELLS * CELLS;
  const cellOf = (x, z) => clamp(((x - OX) / CELLW) | 0, 0, CELLS - 1) + CELLS * clamp(((z - OX) / CELLW) | 0, 0, CELLS - 1);
  const nearPose = (x, z, r = 7) => { for (const p of POSES) if (hypot(x - p[0], z - p[2]) < r) return true; return false; };
  const inWater = (x, z) => waterAt(x, z) !== null;
  const lists = (n) => Array.from({ length: nCells }, () => []);
  const treeL = [lists(nCells), lists(nCells), lists(nCells)];
  const grassL = lists(nCells), rockL = [lists(nCells), lists(nCells), lists(nCells), lists(nCells)];
  const monoliths = [], flags = [], motes = [], leaves = [], mist = [], birds = [];

  // --- viewpoints: ground the camera poses
  for (const p of POSES) { p[1] = gy(p[0], p[2]) + 1.7; }
  POSES[1][1] = 128.4;

  // --- trees: jittered grid sweep with density gating
  rseed(2);
  const TS = 4.2;
  for (let gz = -680; gz < 680; gz += TS) for (let gx = -680; gx < 680; gx += TS) {
    const x = gx + rr(-1.8, 1.8), z = gz + rr(-1.8, 1.8);
    if (x * x + z * z > 690 * 690 || nearPose(x, z)) continue;
    const h = gy(x, z), n = gN(x, z);
    if (n[1] < 0.52 || h > 332 || h < 122) continue;
    const dens = forestDens(x, z, h, n[2] * -0.6 + n[1] * 0.5);
    if (rnd() > dens * 0.78) continue;
    if (inWater(x, z)) continue;
    if (rivDist(x, z) < 13) continue;
    if (rampDist(x, z) < 7) continue;
    if (hypot(x - FCP[0], z - FCP[1]) < 58) continue;
    if (hypot(x - XRG, z - 300) < 15) continue;
    const sp = rnd(), pn = fbm2(x * 0.01 + 3.3, z * 0.01 + 7.7, 83, 2);
    const species = h < 214 ? (pn < 0.5 ? 0 : 1) : h < 268 ? (pn < 0.34 ? 0 : pn < 0.72 ? 1 : 2) : (pn < 0.5 ? 2 : 1);
    const sc = (0.85 + rnd() * 0.55) * (1 + dens * 0.35) * (rnd() < 0.03 ? rr(1.5, 2.0) : 1);
    treeL[species][cellOf(x, z)].push(x, h - 0.25, z, sc, rnd() * TAU, rr(-0.09, 0.09), rnd(), rnd(), 0.35 + moisture(x, z) * 0.65, rnd() * TAU, species === 2 ? 1 : 0, species === 1 ? 1 : 0);
  }
  // cypress in the fortress court + two landmark beeches by the pool meadow
  for (const [x, z, sp, sc] of [[FCP[0] + 3, FCP[1] + 14, 2, 1.2], [FCP[0] - 7, FCP[1] + 16, 2, 1.0], [XR300 - 26, 258, 0, 1.8], [XR300 + 30, 250, 1, 1.5]]) {
    treeL[sp][cellOf(x, z)].push(x, gy(x, z) - 0.2, z, sc, rnd() * TAU, rr(-0.06, 0.06), rnd(), rnd(), 0.6, rnd() * TAU, sp === 2 ? 1 : 0, sp === 1 ? 1 : 0);
  }
  // bushes: young parrotia scattered in clearings and on banks
  rseed(3);
  for (let i = 0; i < 4200; i++) {
    const a = rnd() * TAU, r = Math.sqrt(rnd()) * 660, x = Math.cos(a) * r, z = Math.sin(a) * r;
    const h = gy(x, z), n = gN(x, z);
    if (h < 124 || h > 320 || n[1] < 0.55 || nearPose(x, z) || inWater(x, z)) continue;
    const dens = forestDens(x, z, h);
    if (rnd() > 0.16 + dens * 0.3) continue;
    if (rivDist(x, z) < 11 || rampDist(x, z) < 5 || hypot(x - FCP[0], z - FCP[1]) < 52) continue;
    const sp = rnd() < 0.5 ? 1 : 2;
    treeL[sp][cellOf(x, z)].push(x, h - 0.2, z, rr(0.28, 0.55), rnd() * TAU, rr(-0.1, 0.1), rnd(), rnd(), 0.45 + moisture(x, z) * 0.5, rnd() * TAU, sp === 2 ? 1 : 0, sp === 1 ? 1 : 0);
  }

  // --- grass, ferns, poppies (blade instances: pos, len / yaw, width, seeds / packed type)
  rseed(4);
  const GS = 2.1;
  for (let gz = -660; gz < 660; gz += GS) for (let gx = -660; gx < 660; gx += GS) {
    const x = gx + rr(-1, 1), z = gz + rr(-1, 1);
    if (x * x + z * z > 670 * 670 || nearPose(x, z, 4)) continue;
    const h = gy(x, z), n = gN(x, z);
    if (n[1] < 0.78 || h < 121 || h > 336) continue;
    const rd = rivDist(x, z), wy = waterAt(x, z);
    if (wy !== null && h < wy + 0.3) continue;
    if (rampDist(x, z) < 4.5 || hypot(x - FCP[0], z - FCP[1]) < 30) continue;
    if (hypot(x - XRG, z - 300) < 14) continue;
    const mo = moisture(x, z), dens = forestDens(x, z, h);
    const bank = wy !== null && rd < 40 ? sstep(34, 10, rd) : 0;
    const gd = sstep(0.30, 0.5, fbm2(x * 0.013 + 8.8, z * 0.013 + 2.2, 81, 2)) * (0.35 + mo * 0.5) + bank * 0.9;
    const pt = pathTint(x, z);
    if (rnd() > clamp(gd - pt * 0.7, 0, 1) * 0.85) continue;
    const c = cellOf(x, z), y = h - 0.05;
    const nb = 1 + (rnd() < 0.55 ? 1 : 0) + (rnd() < 0.22 ? 1 : 0);
    for (let b = 0; b < nb; b++) {
      const dry = fbm2(x * 0.05, z * 0.05, 87, 1) > 0.62 ? 4 : 0;
      const type = bank > 0.4 && rnd() < 0.5 ? 2 : dry;
      const bend = (0.25 + rnd() * 0.45) * 255 | 0;
      grassL[c].push(x + rr(-0.4, 0.4), y, z + rr(-0.4, 0.4), rr(0.26, 0.6) * (1 + mo * 0.45) * (type === 2 ? 1.3 : 1),
        rnd() * TAU, type === 2 ? rr(0.05, 0.085) : rr(0.028, 0.05), rnd(), rnd(), type | (bend << 8), 0);
    }
    if (dens > 0.45 && mo > 0.42 && rnd() < 0.3) { // fern rosette
      const fr = 6 + (rnd() * 2 | 0);
      for (let b = 0; b < fr; b++) grassL[c].push(x, y, z, rr(0.42, 0.95), b / fr * TAU + rr(-0.3, 0.3), rr(0.05, 0.075), rnd(), rnd(), 1 | (102 << 8), 0);
    }
    if (poppyAt(x, z) > 0.45 && rnd() < 0.55) { // poppies: stem + red head
      for (let b = 0; b < 2 + (rnd() * 2 | 0); b++) grassL[c].push(x + rr(-0.5, 0.5), y, z + rr(-0.5, 0.5), rr(0.34, 0.52), rnd() * TAU, 0.016, rnd(), rnd(), 3 | (128 << 8), 0);
    }
  }

  // --- rocks: cliffs, scree, river boulders + monoliths at the gorge
  rseed(5);
  const RS = 3.6;
  for (let gz = -660; gz < 660; gz += RS) for (let gx = -660; gx < 660; gx += RS) {
    const x = gx + rr(-1.5, 1.5), z = gz + rr(-1.5, 1.5);
    if (x * x + z * z > 672 * 672 || nearPose(x, z, 3.5)) continue;
    const h = gy(x, z), n = gN(x, z);
    if (h < 118) continue;
    const slope = 1 - n[1];
    let p = 0, sc = rr(0.3, 1.2);
    if (slope > 0.35 && h > 200) { p = 0.24 + slope * 0.2; if (rnd() < 0.07) sc = rr(1.8, 3.4); }
    const wy = waterAt(x, z);
    if (wy !== null ? h < wy + 1.5 : rivDist(x, z) < 24) { p = Math.max(p, 0.13); sc = rr(0.3, 1.3); }
    if (h > 336) p = Math.max(p, 0.3), sc = rr(0.3, 1.5);
    if (rampDist(x, z) < 5 || hypot(x - FCP[0], z - FCP[1]) < 56 || hypot(x - XRG, z - 300) < 15) continue;
    if (rnd() > p) continue;
    const q = qAxis(0, 1, 0, rnd() * TAU);
    rockL[(rnd() * 4) | 0][cellOf(x, z)].push(x, h - sc * 0.35, z, sc, q[0], q[1], q[2], q[3], rnd() < 0.5 ? 0.55 : 0.9, rnd(), 0, 0);
  }
  for (const [x, z, sc] of [[XR300 - 13, 296, 3.2], [XR300 + 14, 288, 2.6], [XR300 - 9, 316, 2.8], [XR300 + 12, 318, 3.6], [XR300 - 20, 306, 2.2], [XR300 + 22, 310, 2.4], [XR300 + 26, 282, 2.0], [XR300 - 26, 284, 2.2]]) {
    const q = qAxis(0, 1, 0, rnd() * TAU);
    monoliths.push(x, gy(x, z) - sc * 0.4, z, sc, q[0], q[1], q[2], q[3], 0.72, rnd(), 0, 0);
  }

  // --- waterfall mist around the plunge pool
  rseed(6);
  for (let i = 0; i < 230; i++) {
    const a = rnd() * TAU, r = 1 + Math.pow(rnd(), 0.7) * 12;
    mist.push(XR300 + Math.cos(a) * r, 120.8 + rr(0.2, 6.5), 301 + Math.sin(a) * r * 0.8 - 1.5, rr(1.4, 4.2), rnd(), rnd());
  }
  for (let i = 0; i < 60; i++) mist.push(XR300 + rr(-10, 10), rr(122, 142), 305.5 + rr(-1.5, 1.5), rr(1.2, 3), rnd(), rnd());

  // --- drifting motes + falling leaves
  for (let i = 0; i < 2200; i++) motes.push(rr(-22, 22), rr(-14, 26), rr(-22, 22), rnd());
  for (let i = 0; i < 700; i++) leaves.push(rr(-18, 18), rr(-10, 16), rr(-18, 18), rnd(), rr(0.05, 0.11), rnd() * TAU);

  // --- birds: four wheeling flocks, two lone eagles
  rseed(7);
  for (const [cx, cz, r, n, sp] of [[-150, 50, 90, 9, 1], [280, 380, 115, 10, 1], [0, -250, 70, 8, 1], [-350, -100, 100, 8, 1]]) {
    const cy = Math.max(gy(cx, cz) + rr(50, 80), 230);
    for (let i = 0; i < n; i++) birds.push(cx, cy + rr(-6, 6), cz, r * rr(0.8, 1.15), (rnd() < 0.5 ? 1 : -1) * rr(0.035, 0.055) * sp, rnd() * TAU, rr(0.8, 1.3), 0);
  }
  for (const [cx, cz] of [[100, 200], [-200, -350]]) {
    const cy = gy(cx, cz) + rr(90, 120);
    birds.push(cx, cy, cz, rr(120, 160), 0.028 * (rnd() < 0.5 ? 1 : -1), rnd() * TAU, 2.1, 1);
  }

  // --- flags on the towers and gatehouse
  rseed(8);
  const FV = 341.6, r0 = 44;
  for (const i of [1, 3, 7, 9]) {
    const a = i / 10 * TAU, tx = FCP[0] + Math.cos(a) * r0, tz = FCP[1] + Math.sin(a) * r0;
    flags.push(tx, FV + 16.2 + 4.4, tz, 4.4, a, rnd() * TAU, 2.0, 1.25);
  }
  flags.push(FCP[0] - 40.5, FV + 19.8, FCP[1], 4.2, Math.PI / 2, rnd() * TAU, 2.2, 1.4);
  flags.push(FCP[0] - 40.5, FV + 19.8, FCP[1] + 0.1, 4.2, -Math.PI / 2, rnd() * TAU, 2.2, 1.4);

  // --- water ribbon (vertex: pos f32x3 + u,seed f32x2 = 20 B; the falls sheet is separate)
  const wv = [], wi = [];
  const rowW = (z) => 15 + 13 * sstep(34, 20, hypot(0, z - 296)) * sstep(312, 300, z) + 4 * sstep(374, 356, z);
  const waterRanges = [];
  const addPiece = (z0, z1, step, level) => {
    const v0 = wv.length / 5, i0 = wi.length;
    let rows = 0;
    for (let z = z0; (step > 0 ? z <= z1 : z >= z1); z += step) {
      rows++;
      const hw = rowW(z), cx = xrFn(z);
      for (let c = 0; c <= 8; c++) {
        const u = c / 8 * 2 - 1;
        wv.push(cx + u * hw, level(z), z, u, fract(z * 0.37));
      }
    }
    for (let r = 0; r < rows - 1; r++) for (let c = 0; c < 8; c++) {
      const k = v0 + r * 9 + c;
      wi.push(k, k + 1, k + 9, k, k + 9, k + 9 + 1);
    }
    waterRanges.push({ v0, i0, ic: wi.length - i0 });
  };
  addPiece(302.4, -778, -5.5, (z) => 120.5 + (z - 296) * 0.012);
  addPiece(309.4, 372, 5.5, (z) => 144 + (z - 312) * 0.022);
  // falls sheet: slight tilt from lip to pool (vertex: pos f32x3 + u,t f32x2)
  const fv = [], fi = [];
  const FCOLS = 4, FROWS = 3;
  for (let r = 0; r <= FROWS; r++) {
    const t = r / FROWS, y = mix(143.8, 121.2, t), z = mix(308.8, 303.4, t) + Math.sin(t * 2.6) * 0.5;
    for (let c = 0; c <= FCOLS; c++) {
      const u = c / FCOLS;
      fv.push(XR300 + (u * 2 - 1) * 11, y + Math.sin(u * 5.1) * 0.25, z, u, t);
    }
  }
  for (let r = 0; r < FROWS; r++) for (let c = 0; c < FCOLS; c++) {
    const k = r * (FCOLS + 1) + c;
    fi.push(k, k + 1, k + FCOLS + 1, k, k + FCOLS + 1, k + FCOLS + 2);
  }

  // --- ground map: forest tint, moisture, paths, bank sand
  const GMN = 384, gm = new Uint8Array(GMN * GMN * 4);
  for (let j = 0; j < GMN; j++) for (let i = 0; i < GMN; i++) {
    const x = OX + (i + 0.5) / GMN * EXT, z = OX + (j + 0.5) / GMN * EXT, o = (i + GMN * j) * 4;
    const h = gy(x, z), wy = waterAt(x, z);
    const bank = wy !== null ? sstep(wy - 2.2, wy + 0.7, h) : 0;
    gm[o] = forestDens(x, z, h) * 255;
    gm[o + 1] = moisture(x, z) * 255;
    gm[o + 2] = pathTint(x, z) * 255;
    gm[o + 3] = clamp(bank + sstep(0.5, 0.72, fbm2(x * 0.02 + 3, z * 0.02 + 9, 89, 1)) * 0.25, 0, 1) * 255;
  }

  // --- pack instance lists into cell-sorted buffers with Y ranges
  const pack = (L, stride, floats) => {
    let n = 0;
    const start = new Uint32Array(nCells + 1);
    for (let c = 0; c < nCells; c++) { start[c] = n; n += Math.ceil(L[c].length / floats); }
    start[nCells] = n;
    const data = new Float32Array(n * stride), lo = new Float32Array(nCells).fill(1e9), hi = new Float32Array(nCells).fill(-1e9);
    let k = 0;
    for (let c = 0; c < nCells; c++) {
      const a = L[c];
      for (let i = 0; i < a.length; i += floats, k++) {
        for (let j = 0; j < stride; j++) data[k * stride + j] = a[i + j] !== undefined ? a[i + j] : 0;
        const y = a[1], m = a[3] || 1;
        if (y - m * 1.5 < lo[c]) lo[c] = y - m * 1.5;
        if (y + m * (stride === 10 ? 1.6 : 14) > hi[c]) hi[c] = y + m * (stride === 10 ? 1.6 : 14);
      }
    }
    return { data, start, lo, hi, n };
  };
  // grass: 8 f32 + 2 u32 per instance, packed through a shared buffer
  const packG = (L) => {
    let n = 0;
    const start = new Uint32Array(nCells + 1);
    for (let c = 0; c < nCells; c++) { start[c] = n; n += Math.ceil(L[c].length / 10); }
    start[nCells] = n;
    const data = new ArrayBuffer(n * 40), df = new Float32Array(data), du = new Uint32Array(data);
    const lo = new Float32Array(nCells).fill(1e9), hi = new Float32Array(nCells).fill(-1e9);
    let k = 0;
    for (let c = 0; c < nCells; c++) {
      const a = L[c];
      for (let i = 0; i < a.length; i += 10, k++) {
        for (let j = 0; j < 8; j++) df[k * 10 + j] = a[i + j] !== undefined ? a[i + j] : 0;
        du[k * 10 + 8] = a[i + 8] | 0; du[k * 10 + 9] = a[i + 9] | 0;
        const y = a[1], ln = a[3];
        if (y - 0.2 < lo[c]) lo[c] = y - 0.2;
        if (y + ln * 1.8 > hi[c]) hi[c] = y + ln * 1.8;
      }
    }
    return { data, start, lo, hi, n };
  };

  return {
    trees: treeL.map(packL32), grass: packG(grassL), rocks: rockL.map(packL32),
    monoliths: new Float32Array(monoliths), flags: new Float32Array(flags),
    motes: new Float32Array(motes), leaves: new Float32Array(leaves), mist: new Float32Array(mist), birds: new Float32Array(birds),
    waterV: new Float32Array(wv), waterI: new Uint32Array(wi), waterRanges,
    fallV: new Float32Array(fv), fallI: new Uint32Array(fi), gm, GMN, POSES,
  };
}
// 48-byte instance packer (a: pos+scale, b: quat-or-yaw pair, c: 4 material floats)
function packL32(L) {
  const nCells = CELLS * CELLS;
  let n = 0;
  const start = new Uint32Array(nCells + 1);
  for (let c = 0; c < nCells; c++) { start[c] = n; n += Math.ceil(L[c].length / 12); }
  start[nCells] = n;
  const data = new Float32Array(n * 12), lo = new Float32Array(nCells).fill(1e9), hi = new Float32Array(nCells).fill(-1e9);
  let k = 0;
  for (let c = 0; c < nCells; c++) {
    const a = L[c];
    for (let i = 0; i < a.length; i += 12, k++) {
      for (let j = 0; j < 12; j++) data[k * 12 + j] = a[i + j] !== undefined ? a[i + j] : 0;
      const y = a[1], m = a[3];
      if (y - m * 2 < lo[c]) lo[c] = y - m * 2;
      if (y + m * 15 > hi[c]) hi[c] = y + m * 15;
    }
  }
  return { data, start, lo, hi, n };
}
