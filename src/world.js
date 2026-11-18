// ============================================================================
// world layout + procedural content generation (load-time only)
// A mountain valley in ancient Tabaristan: a river falling through a gorge,
// Hyrcanian forest on the slopes, a citadel on the eastern shoulder.
// ============================================================================

// ---------------------------------------------------------------- density fields (CPU side)
const xrFn = (z) => 24 * Math.sin(z * 0.005 + 1.3) + 48 * Math.sin(z * 0.0021 + 4.2) + 8 * Math.sin(z * 0.013 + 0.5);
const moisture = (x, z) => sstep(0.34, 0.62, fbm2(x * 0.004 + 9.2, z * 0.004 + 3.1, 73, 2));
// patches of dense forest, clearings, and poppy meadows
const FORESTZ = [[-140, 60, 130, 1], [-300, 220, 140, 1], [-420, 260, 150, 0.9], [-200, -80, 120, 1], [60, -200, 130, 0.85],
  [-380, -240, 150, 0.9], [180, -140, 120, 0.8], [-80, 340, 110, 0.9], [-520, 60, 130, 0.85], [420, -60, 120, 0.75],
  [-260, 420, 120, 0.8], [-600, -300, 160, 0.8], [520, 220, 130, 0.7], [340, -320, 120, 0.7]];
const CLEARS = [[-60, -20, 34], [40, 60, 28], [-190, 160, 30], [110, -80, 26], [-330, 120, 34], [-30, -280, 30], [230, 60, 30], [-450, 300, 30]];
const forestDens = (x, z, h, ny) => {
  let d = sstep(0.36, 0.6, fbm2(x * 0.006 + 2.7, z * 0.006 + 5.5, 71, 3)) * 0.95;
  for (const p of FORESTZ) d = Math.max(d, p[3] * sstep(p[2], p[2] * 0.45, hypot(x - p[0], z - p[1])));
  for (const p of CLEARS) d *= sstep(p[2] * 0.5, p[2], hypot(x - p[0], z - p[1]));
  d *= 0.55 + 0.45 * moisture(x, z);
  if (ny !== undefined) d *= 0.8 + 0.35 * clamp(-ny * 0.8 + 0.5, 0, 1); // north-facing slopes are damper
  if (h > 296) d *= sstep(332, 296, h);                                 // treeline
  return clamp(d, 0, 1);
};
const poppyAt = (x, z) => sstep(0.63, 0.72, fbm2(x * 0.017 + 41.3, z * 0.017 + 8.8, 77, 2)) * (1 - forestDens(x, z, gy(x, z)) * 0.8);
// distance to the switchback causeway (for tint + foliage exclusion)
const rampDist = (x, z) => {
  let best = 1e9;
  for (let k = 0; k < 4; k++) {
    const A = RAMP[k], B = RAMP[k + 1];
    const bax = B[0] - A[0], baz = B[1] - A[1];
    const t = clamp(((x - A[0]) * bax + (z - A[1]) * baz) / Math.max(bax * bax + baz * baz, 1e-4), 0, 1);
    best = Math.min(best, hypot(x - (A[0] + bax * t), z - (A[1] + baz * t)));
  }
  return best;
};
const rivDist = (x, z) => Math.abs(x - xrFn(z));
// riverside footpath on the east bank + the causeway: b channel of the ground map
const pathTint = (x, z) => {
  let p = sstep(6, 2.4, rampDist(x, z));
  const d = rivDist(x, z) - 34;
  if (z > -340 && z < 282) p = Math.max(p, sstep(3.4, 1.6, Math.abs(d)) * sstep(282, 260, z) * sstep(-340, -320, z));
  if (hypot(x - FCP[0], z - FCP[1]) < 34) p = Math.max(p, sstep(34, 26, hypot(x - FCP[0], z - FCP[1]))); // paved court
  return p;
};

// ---------------------------------------------------------------- viewpoints (heights filled in makeWorld)
const POSES = [
  [60, 0, -40, 10, 170, 330],
  [XR300 - 20, 128.2, 280, XR300 + 2, 139, 312],
  [-150, 0, 120, -80, 0, 215],
  [168, 0, 448, 246, 349, 470],
  [-430, 0, 258, 246, 352, 470],
  [26, 0, -260, -20, 130, -520],
];

// ---------------------------------------------------------------- fortress (ancient Tabaristan citadel)
// tone codes in the aux byte: 0.9 pale stone, 0.55 weathered stone, 0.25 wood,
// 0.02 glazed turquoise, -0.6 dark interior, -0.85 gilded
function buildFortress() {
  const m = new Mesh();
  const S = { stone: 0.9, wea: 0.55, wood: 0.25, tile: 0.02, dark: -0.6, gold: -0.85 };
  const FY = 341.6, r0 = 44;
  const vx = (i) => FCP[0] + Math.cos(i / 10 * TAU) * r0;
  const vz = (i) => FCP[1] + Math.sin(i / 10 * TAU) * r0;
  // curtain wall: outer + inner faces, walkway top, string course, parapet merlons
  for (let i = 0; i < 10; i++) {
    const j = (i + 1) % 10;
    const ax = vx(i), az = vz(i), bx = vx(j), bz = vz(j);
    const mx = (ax + bx) / 2, mz = (az + bz) / 2;
    const yaw = Math.atan2(bz - az, bx - ax);
    const dx = Math.cos(yaw), dz = Math.sin(yaw);
    const px = -dz, pz = dx; // outward normal (pointing away from centre for CCW verts)
    const out = (px * (mx - FCP[0]) + pz * (mz - FCP[1]) > 0) ? 1 : -1;
    const ox = px * out, oz = pz * out;
    const len = hypot(bx - ax, bz - az), cy = (FY + 352.4) / 2;
    // wall faces + parapet above the walkway
    m.box(mx - ox * 2.5, cy, mz - oz * 2.5, len, 10.8, 1.5, yaw, S.stone);
    m.box(mx + ox * 2.5, cy, mz + oz * 2.5, len, 10.8, 1.5, yaw, S.wea);
    m.box(mx, FY + 9.2, mz, len, 0.5, 5.4, yaw, S.wea);                     // walkway slab
    m.box(mx + ox * 2.0, FY + 10.3, mz + oz * 2.0, len, 2.6, 0.8, yaw, S.stone); // parapet
    m.box(mx - ox * 2.0, FY + 10.3, mz - oz * 2.0, len, 2.6, 0.8, yaw, S.stone);
    m.box(mx, FY + 4.6, mz, len, 0.9, 6.2, yaw, S.wea);                     // string course
    const n = Math.round(len / 2.6);
    for (let k = 0; k <= n; k++) {                                          // merlons on the outer rim
      const t = (k + 0.5) / (n + 1) - 0.5;
      m.box(mx + dx * len * t + ox * 2.0, FY + 12.1, mz + dz * len * t + oz * 2.0, 1.3, 1.5, 1.1, yaw, S.stone);
    }
    for (let k = 0; k < 3; k++) m.box(mx + ox * 2.9, FY + 3.6 + k * 2.6, mz, 0.5, 1.3, 1.3, yaw, S.dark); // arrow slits
  }
  // towers at 8 vertices (west vertex is the gate)
  for (let i = 0; i < 10; i++) {
    if (i === 5) continue;
    const tx = vx(i), tz = vz(i);
    tower(m, tx, tz, 5.2, FY, 14.5, i % 2 ? 0 : 1, S);
  }
  // gatehouse on the west vertex: bastion, pointed arch, doors, tile band
  const gx = vx(5), gz = vz(5);
  m.box(gx + 3.5, FY + 6.4, gz, 13.5, 12.8, 6.4, 0, S.stone);                // bastion block
  m.box(gx + 3.5, FY + 13.8, gz, 14.5, 1.6, 7.6, 0, S.wea);                  // cornice
  for (let k = 0; k < 5; k++) m.box(gx + 3.5 + (k - 2) * 2.8, FY + 15.2, gz, 1.4, 1.6, 6.8, 0, S.stone); // merlons
  m.box(gx + 3.5, FY + 15.2, gz, 14.6, 0.7, 7.8, 0, S.tile);                 // tile band under the cornice
  const dr = 3.0, dh = 6.4;                                                  // gate opening half-width / height
  for (const s of [-1, 1]) {
    m.box(gx + 1.8, FY + dh / 2, gz + s * (dr + 1.1), 6.2, dh, 2.2, 0, S.stone); // jambs
    m.box(gx + 0.4, FY + dh / 2, gz + s * (dr + 1.1), 0.8, dh, 2.4, 0, S.dark);  // reveal shadow
  }
  // pointed arch: two segments + apex
  for (let s = -1; s <= 1; s += 2) {
    const pts = [];
    for (let k = 0; k <= 4; k++) {
      const a = k / 4 * Math.PI / 2;
      pts.push([gx + 1.8, FY + dh + Math.sin(a) * 1.9, gz + s * (Math.cos(a) * dr)]);
    }
    m.tube(pts, (k) => 0.55, 6, false, () => S.gold);
  }
  m.box(gx + 1.8, FY + dh + 2.6, gz, 1.6, 2.4, dr * 2 + 1.6, 0, S.stone);     // apex stone
  m.box(gx - 0.3, FY + dh / 2, gz, 1.3, dh, dr * 2, 0, S.wood);               // leaf doors
  m.box(gx + 0.9, FY + 3.4, gz, 0.5, 0.5, dr * 2 + 0.8, 0, S.gold);           // door beam
  m.box(gx - 1.9, FY + dh + 1.6, gz, 1.2, 3.6, dr * 2 + 2.6, 0, S.tile);      // arch spandrel band
  // keep: great hall with turrets, windows, drum + turquoise dome
  const kx = FCP[0] + 10, kz = FCP[1] - 2;
  m.box(kx, FY + 6.5, kz, 19, 13, 14.5, 0, S.stone);
  m.box(kx, FY + 13.6, kz, 20.5, 1.6, 16, 0, S.wea);                          // cornice
  m.box(kx, FY + 14.9, kz, 19.6, 1.9, 15.1, 0, S.stone);                      // parapet
  for (let i = 0; i < 4; i++) {                                               // corner turrets
    const sx = i & 1 ? 1 : -1, sz = i & 2 ? 1 : -1;
    const tx = kx + sx * 9.4, tz = kz + sz * 7.2;
    tower(m, tx, tz, 2.9, FY, 16.5, 2, S, true);
    m.lathe([[0.0, FY + 19.6, S.tile], [2.6, FY + 17.8, S.tile], [2.6, FY + 17.2, S.gold], [0, FY + 17.2, S.tile]], 8, false, tx, tz);
  }
  for (let w = 0; w < 5; w++) {                                               // arched windows, south + west faces
    const wx = kx - 6 + w * 3;
    m.box(wx, FY + 8.6, kz - 7.3, 1.5, 2.9, 0.8, 0, S.dark);
    m.box(wx, FY + 10.2, kz - 7.55, 2.0, 0.5, 0.4, 0, S.gold);
    m.box(wx, FY + 10.9, kz - 7.45, 1.5, 0.9, 0.55, 0, S.dark);
  }
  for (let w = 0; w < 3; w++) {
    const wz = kz - 4 + w * 4;
    m.box(kx - 9.6, FY + 8.6, wz, 0.8, 2.9, 1.5, 0, S.dark);
    m.box(kx - 9.85, FY + 10.2, wz, 0.4, 0.5, 2.0, 0, S.gold);
  }
  // audience iwan on the courtyard side: recessed arch hall
  m.box(kx + 4, FY + 4.4, kz + 7.6, 9, 8.8, 2.4, 0, S.wea);
  m.box(kx + 4, FY + 4.4, kz + 6.2, 7, 7.6, 0.6, 0, S.dark);
  m.box(kx + 4, FY + 9.2, kz + 8.4, 10, 1.2, 2.8, 0, S.tile);
  // dome chamber over the hall
  m.lathe([[5.2, FY + 15.2, S.stone], [5.2, FY + 18.2, S.stone], [5.4, FY + 18.6, S.gold], [4.9, FY + 18.8, S.tile]], 14, false, kx, kz);
  m.lathe([[4.9, FY + 18.8, S.tile], [4.75, FY + 20.2, S.tile], [3.9, FY + 22.4, S.tile], [2.2, FY + 23.8, S.tile], [0.55, FY + 24.6, S.tile], [0, FY + 24.7, S.gold]], 14, false, kx, kz);
  m.box(kx, FY + 25.6, kz, 0.5, 1.9, 0.5, 0, S.gold);                         // finial
  // courtyard well
  m.lathe([[1.6, FY + 0.4, S.wea], [1.6, FY + 1.5, S.stone], [1.9, FY + 1.6, S.stone], [1.4, FY + 1.7, S.dark]], 10, false, FCP[0] - 8, FCP[1] + 10);
  // two cypress in the court (added as tree instances in makeWorld)
  return m;
}
// round tower: battered drum, machicolation ring, parapet, merlons, slits, optional kiosk
function tower(m, cx, cz, r, fy, h, slits, S, small) {
  const prof = [[r * 1.12, 0, S.wea], [r * 1.1, h * 0.25, S.stone], [r * 1.04, h * 0.7, S.stone],
    [r * 1.18, h * 0.88, S.wea], [r * 1.18, h * 0.97, S.wea], [r * 0.86, h * 0.97, S.stone], [r * 0.86, h, S.wea]];
  m.lathe(prof.map((p) => [p[0], fy + p[1], p[2]]), 12, false, cx, cz);
  const top = fy + h;
  for (let k = 0; k < 9; k++) {
    const a = (k + 0.5) / 9 * TAU;
    m.box(cx + Math.cos(a) * r * 0.86, top + 0.85, cz + Math.sin(a) * r * 0.86, 1.1, 1.7, 1.1, a, S.stone);
  }
  for (let k = 0; k < slits; k++) {
    const a = (k / slits) * TAU + 0.4;
    m.box(cx + Math.cos(a) * r * 1.08, fy + h * 0.45 + k * 1.6, cz + Math.sin(a) * r * 1.08, 0.5, 1.5, 0.5, a, S.dark);
  }
  if (!small) { // little domed kiosk on the walkway
    m.lathe([[0.5, top + 2.6, S.tile], [1.3, top + 2.4, S.tile], [1.1, top + 3.4, S.tile], [0, top + 4.3, S.gold]], 8, false, cx, cz);
  }
}

// grotto: hollow rock shell beside the pool with a mouth facing the water
function buildGrotto() {
  const m = new Mesh();
  const C = [XRG, 121.5, 300], R = 12.5;
  let D = [XR300 - XRG, -2.5, 296 - 300]; const dl = hypot(...D); D = D.map((v) => v / dl);
  let T1 = [D[2], 0, -D[0]]; const t1l = hypot(...T1); T1 = T1.map((v) => v / t1l);
  const T2 = [D[1] * T1[2] - D[2] * T1[1], D[2] * T1[0] - D[0] * T1[2], D[0] * T1[1] - D[1] * T1[0]];
  const a0 = 62 / 180 * Math.PI, a1 = 122 / 180 * Math.PI, SEG = 22, RINGS = 9;
  const pt = (al, th, rr) => {
    const ca = Math.cos(al), sa = Math.sin(al), ct = Math.cos(th), st = Math.sin(th);
    return [C[0] + (ca * D[0] + sa * (ct * T1[0] + st * T2[0])) * rr,
      C[1] + (ca * D[1] + sa * (ct * T1[1] + st * T2[1])) * rr,
      C[2] + (ca * D[2] + sa * (ct * T1[2] + st * T2[2])) * rr];
  };
  const lumps = [];
  for (let i = 0; i < 5; i++) lumps.push([rr(-1, 1), rr(-1, 1), rr(-1, 1), rr(0.12, 0.3)]);
  const warp = (p) => {
    let w = 0;
    for (const l of lumps) { const d = p[0] * l[0] + p[1] * l[1] + p[2] * l[2]; w += (d > 0 ? -1 : 1) * l[3] * Math.max(0, 1 - Math.abs(d) * 1.8); }
    return w;
  };
  const rings = [];
  for (let k = 0; k <= RINGS; k++) {
    const al = a0 + (a1 - a0) * k / RINGS, ring = [];
    for (let s = 0; s <= SEG; s++) {
      const th = s / SEG * TAU;
      const po = pt(al, th, R), pi = pt(al, th, R - 1.35);
      const w = warp([po[0] / R, po[1] / R, po[2] / R]) * 1.7;
      ring.push([pi[0] + w * 0.6, pi[1] + w, pi[2] + w * 0.6, po[0] + w, po[1] + w, po[2] + w]);
    }
    rings.push(ring);
  }
  for (let k = 0; k < RINGS; k++) for (let s = 0; s < SEG; s++) {
    const A = rings[k][s], B = rings[k][s + 1], Cc = rings[k + 1][s + 1], D2 = rings[k + 1][s];
    const i0 = m.v(A[0], A[1], A[2], 1), i1 = m.v(B[0], B[1], B[2], 1), i2 = m.v(Cc[0], Cc[1], Cc[2], 1), i3 = m.v(D2[0], D2[1], D2[2], 1);
    const o0 = m.v(A[3], A[4], A[5], -1), o1 = m.v(B[3], B[4], B[5], -1), o2 = m.v(Cc[3], Cc[4], Cc[5], -1), o3 = m.v(D2[3], D2[4], D2[5], -1);
    m.quad(i0, i1, i2, i3); // inner (dark) shell
    m.quad(o0, o2, o1, o3); // outer shell
    m.quad(i1, o1, o2, i2); // rim between shells
  }
  return m;
}

// tree species: 0 beech-like broadleaf, 1 parrotia (warm amber), 2 cypress evergreen
// vertex pack: pos f32x3 + unorm8x4(u, v, leaf*0.5+0.5, shade) + snorm8x4 normal
function buildTree(species) {
  const m = new Mesh();
  m.lv = []; m.lf = []; m.ls = [];
  const lv = (x, y, z, u, vv, leaf, sh) => { m.p.push(x, y, z); m.lv.push(u, vv, leaf, sh); m.n.push(0, 1, 0); m.a.push(1); return m.p.length / 3 - 1; };
  const H = species === 2 ? 3.4 : 2.6, R0 = species === 2 ? 0.10 : 0.16;
  // trunk: tapered, slightly bent, with a root flare
  const bend = rr(-0.06, 0.06), lean = rr(-0.05, 0.05);
  const rings = 6, sides = species === 2 ? 7 : 6;
  for (let k = 0; k <= rings; k++) {
    const t = k / rings, y = H * t;
    const r = R0 * (1 - t * 0.72) * (1 + 1.9 * Math.pow(Math.max(0, 1 - t * 5), 2));
    const cx = bend * t * t * H + lean * t * H;
    for (let s = 0; s <= sides; s++) {
      const a = s / sides * TAU, ca = Math.cos(a), sa = Math.sin(a);
      m.v(cx + ca * r, y, sa * r, -1, ca * 127, 0, sa * 127);
      m.lv.push(0, 0, 0, 0.5); // bark: uv 0, leaf flag 0
    }
  }
  const ringI = (k, s) => k * (sides + 1) + s;
  for (let k = 0; k < rings; k++) for (let s = 0; s < sides; s++) m.quad(ringI(k, s), ringI(k, s + 1), ringI(k + 1, s + 1), ringI(k + 1, s));
  // canopy cards
  const card = (cx, cy, cz, w, h, yaw, tilt, sh) => {
    const cs = Math.cos(yaw), sn = Math.sin(yaw), ct = Math.cos(tilt), st = Math.sin(tilt);
    const ax = cs * ct, ay = st, az = sn * ct;             // card "up" axis
    const rx = -sn, rz = cs;                                // card right axis
    const q = [];
    for (let j = 0; j < 2; j++) for (let i = 0; i < 2; i++) {
      const uu = i * 2 - 1, vv = j;
      q.push(lv(cx + rx * uu * w + ax * vv * h, cy + ay * vv * h, cz + rz * uu * w + az * vv * h, i, j, 1, sh));
    }
    m.quad(q[0], q[1], q[3], q[2]);
  };
  if (species === 2) { // cypress: stacked horizontal sprig cards, narrow crown
    for (let k = 0; k < 6; k++) {
      const t = (k + 0.6) / 6, w = 0.85 * (1 - Math.pow(t, 1.6)) + 0.22;
      card(0, H * (0.22 + t * 0.78), 0, w, w * (0.55 + 0.2 * rnd()), rnd() * TAU, 1.35, rnd());
    }
  } else {
    const n = species === 0 ? 7 : 5;
    for (let k = 0; k < n; k++) {
      const a = k / n * TAU + rr(-0.4, 0.4), rr2 = species === 0 ? rr(0.55, 0.95) : rr(0.4, 0.7);
      const cx = Math.cos(a) * rr2 * 0.9, cz = Math.sin(a) * rr2 * 0.9, cy = H * rr(0.78, 1.02);
      card(cx, cy, cz, rr(0.75, 1.15), rr(0.55, 0.85), a + rr(-0.6, 0.6), rr(0.9, 1.5), rnd());
    }
    card(0, H * 1.08, 0, rr(0.9, 1.3), rr(0.6, 0.9), rnd() * TAU, 1.2, rnd());
    if (species === 0) card(rr(-0.5, 0.5), H * 0.62, rr(-0.5, 0.5), 0.8, 0.6, rnd() * TAU, 1.4, rnd());
  }
  // pack: pos + (u,v,leaf,shade) + normal
  const nv = m.p.length / 3;
  const vb = new ArrayBuffer(nv * 20), vf = new Float32Array(vb), u8 = new Uint8Array(vb), s8 = new Int8Array(vb);
  for (let k = 0; k < nv; k++) {
    vf[k * 5] = m.p[k * 3]; vf[k * 5 + 1] = m.p[k * 3 + 1]; vf[k * 5 + 2] = m.p[k * 3 + 2];
    u8[k * 20 + 12] = clamp(m.lv[k * 4], 0, 1) * 255; u8[k * 20 + 13] = clamp(m.lv[k * 4 + 1], 0, 1) * 255;
    u8[k * 20 + 14] = m.lv[k * 4 + 2] * 127 + 128; u8[k * 20 + 15] = clamp(m.lv[k * 4 + 3], 0, 1) * 255;
    s8[k * 20 + 16] = m.n[k * 3]; s8[k * 20 + 17] = m.n[k * 3 + 1]; s8[k * 20 + 18] = m.n[k * 3 + 2]; s8[k * 20 + 19] = 127;
  }
  m.p = null; m.lv = null;
  return { vb, ib: new Uint32Array(m.ib), nv };
}

// rock chunk: displaced icosphere with flattened planes (scree / boulder look)
function buildRock(seed, sub, far) {
  rseed(seed);
  // icosahedron
  const t = (1 + Math.sqrt(5)) / 2;
  let V = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]];
  let F = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
    [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
  for (let s = 0; s < sub; s++) { // subdivide with midpoint cache
    const cache = new Map(), F2 = [];
    const mid = (a, b) => { const k = a < b ? a * 65536 + b : b * 65536 + a; if (cache.has(k)) return cache.get(k); const A = V[a], B = V[b]; V.push([(A[0] + B[0]) / 2, (A[1] + B[1]) / 2, (A[2] + B[2]) / 2]); cache.set(k, V.length - 1); return V.length - 1; };
    for (const f of F) { const ab = mid(f[0], f[1]), bc = mid(f[1], f[2]), ca = mid(f[2], f[0]); F2.push([f[0], ab, ca], [f[1], bc, ab], [f[2], ca, bc], [ab, bc, ca]); }
    F = F2;
  }
  const pl = [];
  for (let i = 0; i < 4; i++) { const q = qAxis(rr(-1, 1), rr(-1, 1), rr(-1, 1), rr(0, TAU)); const l = hypot(q[0], q[1], q[2]); pl.push([q[0] / l, q[1] / l, q[2] / l, rr(0.82, 0.95)]); }
  const m = new Mesh();
  const idx = [];
  for (let k = 0; k < V.length; k++) {
    let x = V[k][0], y = V[k][1], z = V[k][2];
    const l = hypot(x, y, z) || 1; x /= l; y /= l; z /= l;
    let r = 1 + (fbm2(x * 1.7 + seed, z * 1.7 - seed, 91 + seed, 2) - 0.5) * 0.85;
    if (!far) r += (fbm2(x * 4.2, y * 4.2, 97 + seed, 2) - 0.5) * 0.24;
    let px = x * r, py = y * r * 0.82, pz = z * r;
    for (const p of pl) { const d = px * p[0] + py * p[1] + pz * p[2] - p[3]; if (d > 0) { px -= p[0] * d; py -= p[1] * d; pz -= p[2] * d; } }
    idx.push(m.v(px * 1.9, py * 1.9, pz * 1.9, 1));
  }
  for (const f of F) idx.length && m.tri(idx[f[0]], idx[f[1]], idx[f[2]]);
  return m;
}

// bird: tiny body + two flapping wing quads (aux 1 marks wing span axis)
function buildBird() {
  const m = new Mesh();
  const b = [m.v(0.32, 0, 0, 0), m.v(-0.3, 0.06, 0, 0), m.v(-0.18, 0, 0.055, 0), m.v(-0.18, 0, -0.055, 0), m.v(0.1, 0.1, 0, 0)];
  m.tri(b[1], b[2], b[0]); m.tri(b[0], b[3], b[1]); m.tri(b[0], b[4], b[1]);
  for (const s of [-1, 1]) {
    const a = m.v(0.06, 0.02, s * 0.05, s), c = m.v(-0.16, 0.01, s * 0.05, s), w1 = m.v(-0.04, 0.05, s * 0.5, s), w2 = m.v(0.2, 0.04, s * 0.22, s);
    m.tri(a, w1, c); m.tri(a, w2, w1);
  }
  return m.build();
}
