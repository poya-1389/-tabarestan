// ============================================================================
// WGSL sources, part 1: noise twin, shared lighting, terrain, far mountains,
// fortress / rocks / grotto, trees
// ============================================================================

// f32-exact twin of the noise + terrain block in math.js. Every op mirrors the
// CPU code op-for-op so near mesh, far mesh and water depth agree.
const W_NOISE = /*wgsl*/`
fn ih(ix: i32, iz: i32, s: i32) -> f32 {
  var q = (u32(ix) * 73856093u) ^ (u32(iz) * 19349663u) ^ (u32(s) * 83492791u);
  q = (q ^ (q >> 13u)) * 1274126177u;
  q = q ^ (q >> 16u);
  return f32(q & 16777215u) * 5.9604645e-8;
}
fn vn2(x: f32, z: f32, s: i32) -> f32 {
  let px = floor(x); let pz = floor(z);
  let fx = x - px; let fz = z - pz;
  let ux = fx * fx * (3.0 - 2.0 * fx);
  let uz = fz * fz * (3.0 - 2.0 * fz);
  let a = ih(i32(px), i32(pz), s); let b = ih(i32(px) + 1, i32(pz), s);
  let c = ih(i32(px), i32(pz) + 1, s); let d = ih(i32(px) + 1, i32(pz) + 1, s);
  let ab = a + (b - a) * ux;
  return ab + (c + (d - c) * ux - ab) * uz;
}
fn fbm2(x: f32, z: f32, s: i32, oct: i32) -> f32 {
  var a = 0.5; var sum = 0.0; var px = x; var pz = z;
  for (var i = 0; i < oct; i++) {
    sum = sum + a * vn2(px, pz, s + i * 101);
    px = px * 2.02 + 13.7; pz = pz * 2.02 + 7.3;
    a = a * 0.5;
  }
  return sum;
}
fn rid2(x: f32, z: f32, s: i32, oct: i32) -> f32 {
  var a = 0.5; var sum = 0.0; var px = x; var pz = z;
  for (var i = 0; i < oct; i++) {
    let n = vn2(px, pz, s + i * 101);
    let r = abs(n * 2.0 - 1.0);
    sum = sum + a * (r * r);
    px = px * 2.13 + 7.7; pz = pz * 2.13 + 3.1;
    a = a * 0.5;
  }
  return sum;
}
fn ss(a: f32, b: f32, x: f32) -> f32 { let t = clamp((x - a) / (b - a), 0., 1.); return t * t * (3. - 2. * t); }
fn lerp32(a: f32, b: f32, w: f32) -> f32 { return a + (b - a) * w; }
fn flen2(x: f32, y: f32) -> f32 { return sqrt(x * x + y * y); }
fn ss(a: f32, b: f32, x: f32) -> f32 { let t = clamp((x - a) / (b - a), 0., 1.); return t * t * (3. - 2. * t); }
const FZ = ${FZ}.0000;
const FZ2 = ${FZ2}.0000;
const XRP = ${XR300.toFixed(4)};
const XRG = ${XRG.toFixed(4)};
const FCX = ${FCP[0]}.0;
const FCZ = ${FCP[1]}.0;
const FCH = ${FCH}.0;
fn terrH(x0: f32, z0: f32) -> f32 {
  let wx = fbm2(x0 * 0.0013 + 13.1, z0 * 0.0013 + 7.7, 11, 3) - 0.5;
  let wz = fbm2(x0 * 0.0013 + 3.7, z0 * 0.0013 + 29.3, 17, 3) - 0.5;
  let qx = x0 + wx * 150.0;
  let qz = z0 + wz * 150.0;
  let big = fbm2(qx * 0.0016, qz * 0.0016, 31, 4);
  let r1 = rid2(qx * 0.0032, qz * 0.0032, 41, 4);
  let hills = fbm2(qx * 0.0085, qz * 0.0085, 51, 3);
  let south = ss(140., 540., z0); let east = ss(40., 500., x0);
  var msf = south * 0.55 + east * 0.45;
  msf = msf * msf * (3.0 - 2.0 * msf);
  var h = 112.0 + (big - 0.5) * 110.0 + hills * 22.0;
  h = h + msf * ((70.0 + 360.0 * r1) + 90.0 * hills);
  // western hills: the forested ridge that faces the valley
  let rw = rid2(qx * 0.0038 + 4.7, qz * 0.0038 + 8.1, 43, 4);
  let westM = ss(-160., -500., x0) * (0.4 + 0.6 * ss(-200., 100., z0));
  h = h + westM * ((60.0 + 150.0 * rw) + 40.0 * hills);
  // rock shelves on high ridges
  h = h + ss(0.62, 0.85, r1) * (ss(240., 420., h) * 18.0);
  // river valley
  let xr = (24.0 * sin(z0 * 0.005 + 1.3) + 48.0 * sin(z0 * 0.0021 + 4.2)) + 8.0 * sin(z0 * 0.013 + 0.5);
  let d = abs(x0 - xr);
  let vly = ss(150., 42., d) * 0.9;
  let vf = 148.0 + (big - 0.5) * 10.0;
  h = lerp32(h, vf, vly);
  // channel + pool masks
  var bedD = 1.0 - ss(15., 30., d);
  let pd = flen2(x0 - XRP, z0 - FZ2);
  let poolD = 1.0 - ss(20., 34., pd);
  let northOfLip = ss(FZ, FZ2, z0);
  bedD = max(bedD, poolD * northOfLip);
  bedD = bedD * ss(374., 352., z0);
  let wyU = 144.0 + (z0 - FZ) * 0.022;
  let wyD = 120.5 + (z0 - 296.0) * 0.012;
  var bed = lerp32(wyD - 2.4, wyU - 2.0, ss(FZ2, FZ, z0));
  bed = lerp32(bed, 116.6, poolD * northOfLip);
  h = lerp32(h, bed, bedD);
  // grotto alcove beside the pool
  let gd = flen2(x0 - XRG, z0 - 300.0);
  let gb = 1.0 - ss(9.5, 14., gd);
  h = lerp32(h, 121.5, gb);
  // fortress plateau + causeway ramp (embankment: raise-only)
  let pfd = flen2(x0 - FCX, z0 - FCZ);
  let pf = 1.0 - ss(46., 82., pfd);
  h = lerp32(h, FCH + (hills - 0.5) * 3.2, pf);
  // ramp segments (unrolled)
  {
    let A = vec3f(12., 436., 150.); let B = vec3f(70., 442., 196.);
    let bax = B.x - A.x; let baz = B.z - A.z;
    let pax = x0 - A.x; let paz = z0 - A.z;
    let bb = max(bax * bax + baz * baz, 1e-4);
    let t = clamp((pax * bax + paz * baz) / bb, 0., 1.);
    let dd = flen2(pax - bax * t, paz - baz * t);
    let m = 1.0 - ss(7., 15., dd);
    let y = A.z + (B.z - A.z) * t;
    h = max(h, lerp32(h, y, m));
  }
  {
    let A = vec3f(70., 442., 196.); let B = vec3f(118., 414., 252.);
    let bax = B.x - A.x; let baz = B.z - A.z;
    let pax = x0 - A.x; let paz = z0 - A.z;
    let bb = max(bax * bax + baz * baz, 1e-4);
    let t = clamp((pax * bax + paz * baz) / bb, 0., 1.);
    let dd = flen2(pax - bax * t, paz - baz * t);
    let m = 1.0 - ss(7., 15., dd);
    let y = A.z + (B.z - A.z) * t;
    h = max(h, lerp32(h, y, m));
  }
  {
    let A = vec3f(118., 414., 252.); let B = vec3f(158., 448., 300.);
    let bax = B.x - A.x; let baz = B.z - A.z;
    let pax = x0 - A.x; let paz = z0 - A.z;
    let bb = max(bax * bax + baz * baz, 1e-4);
    let t = clamp((pax * bax + paz * baz) / bb, 0., 1.);
    let dd = flen2(pax - bax * t, paz - baz * t);
    let m = 1.0 - ss(7., 15., dd);
    let y = A.z + (B.z - A.z) * t;
    h = max(h, lerp32(h, y, m));
  }
  {
    let A = vec3f(158., 448., 300.); let B = vec3f(192., 466., 344.);
    let bax = B.x - A.x; let baz = B.z - A.z;
    let pax = x0 - A.x; let paz = z0 - A.z;
    let bb = max(bax * bax + baz * baz, 1e-4);
    let t = clamp((pax * bax + paz * baz) / bb, 0., 1.);
    let dd = flen2(pax - bax * t, paz - baz * t);
    let m = 1.0 - ss(7., 15., dd);
    let y = A.z + (B.z - A.z) * t;
    h = max(h, lerp32(h, y, m));
  }
  // fine detail
  h = h + (fbm2(x0 * 0.045, z0 * 0.045, 61, 2) - 0.5) * 2.4;
  h = h + (fbm2(x0 * 0.13, z0 * 0.13, 67, 2) - 0.5) * 0.5;
  return h;
}
// water surface level (JS waterAt twin, visual only)
fn waterLevel(z: f32) -> f32 { return lerp32(120.5 + (z - 296.0) * 0.012, 144.0 + (z - FZ) * 0.022, ss(307.5, 309.5, z)); }
fn waterMask(x: f32, z: f32) -> f32 {
  let xr = (24.0 * sin(z * 0.005 + 1.3) + 48.0 * sin(z * 0.0021 + 4.2)) + 8.0 * sin(z * 0.013 + 0.5);
  let d = abs(x - xr);
  let pd = flen2(x - XRP, z - FZ2);
  var m = 1.0 - ss(15., 30., d);
  m = max(m, (1.0 - ss(20., 34., pd)) * ss(FZ, FZ2, z));
  return m * ss(374., 352., z);
}
`;

// ---------------------------------------------------------------- shared scene code
const S_G = /*wgsl*/`
struct G { vp: mat4x4f, sm: mat4x4f, cam: vec4f, right: vec4f, up: vec4f, fwd: vec4f, sun: vec4f, res: vec4f, mis: vec4f };
const TAU = 6.2831853;
const WIND = vec2f(0.796, 0.605);
fn sat(x: f32) -> f32 { return clamp(x, 0., 1.); }
fn sat3(x: vec3f) -> vec3f { return clamp(x, vec3f(0.), vec3f(1.)); }
fn hs(x: f32) -> f32 { return fract(sin(x * 127.1) * 43758.5453); }
fn h21(p: vec2f) -> f32 { return fract(sin(dot(p, vec2f(127.1, 311.7))) * 43758.5453); }
fn ign(p: vec2f) -> f32 { return fract(52.9829189 * fract(dot(p, vec2f(.06711056, .00583715)))); }
fn fin(c: vec3f) -> vec4f { return vec4f(clamp(c, vec3f(0.), vec3f(40.)), 1.); }
fn qrot(q: vec4f, v: vec3f) -> vec3f { return v + 2.0 * cross(q.xyz, cross(q.xyz, v) + q.w * v); }
`;
// g-dependent lighting helpers, injected after the bind group declarations
const S_H = /*wgsl*/`
fn sunc() -> vec3f { return mix(vec3f(1.32, 0.96, 0.62), vec3f(1.30, 1.24, 1.10), ss(0.10, 0.28, g.sun.y)); }
// wind field: strength wobbles with gusts across the valley
fn gust(p: vec3f, t: f32) -> f32 {
  let s = sin(t * 0.29 + p.x * 0.008 + p.z * 0.005) * sin(t * 0.17 + p.z * 0.011 - p.x * 0.006);
  return 0.45 + 0.55 * sat(0.55 + 0.8 * s);
}
// golden-hour sky dome colour (no clouds; clouds live in skyCol)
fn skyBase(rd: vec3f) -> vec3f {
  let sun = g.sun.xyz;
  let zen = vec3f(0.16, 0.34, 0.62);
  let mid = vec3f(0.55, 0.65, 0.78);
  let hor = vec3f(0.83, 0.78, 0.68);
  var c = mix(mix(hor, mid, ss(0.02, 0.22, rd.y)), zen, ss(0.18, 0.72, rd.y));
  let sd = max(dot(rd, sun), 0.);
  let mu = max(dot(normalize(vec3f(rd.x, 0., rd.z)), normalize(vec3f(sun.x, 0., sun.z))), 0.);
  c += vec3f(1.05, 0.62, 0.26) * (0.30 * pow(mu, 2.0) * ss(0.34, 0.01, rd.y) * ss(-0.08, 0.05, rd.y));
  c += vec3f(1.15, 0.80, 0.44) * 0.55 * pow(sd, 7.0);
  c += vec3f(1.2, 0.95, 0.7) * 0.9 * pow(sd, 60.0);
  return c;
}
`;
// sky + fog helpers (need the tCl texture + sR sampler as well)
const S_K = /*wgsl*/`
// clouds on a far plane, with a high cirrus veil
fn cloudLayer(rd: vec3f) -> vec3f {
  if (rd.y < 0.018) { return vec3f(0.); }
  let t = g.cam.w;
  let H1 = 1450.0;
  let p = g.cam.xz + rd.xz / rd.y * H1;
  let b1 = textureSampleLevel(tCl, sR, p * 0.00042 + vec2f(t * 0.0021, t * 0.0009), 0.).r;
  let d1 = textureSampleLevel(tCl, sR, p * 0.0011 + vec2f(-t * 0.0033, t * 0.0006) + b1 * 0.34, 0.).g;
  let dn = sat(b1 * 0.72 + d1 * 0.5);
  let cov = ss(0.58, 0.78, dn) * ss(0.02, 0.12, rd.y) * ss(0.75, 0.3, length(p - g.cam.xz) / 9000.);
  let sd = max(dot(rd, g.sun.xyz), 0.);
  let lit = 0.42 + 0.58 * sat(0.2 + 1.35 * pow(sd, 2.2)) * (0.35 + 0.75 * ss(0.35, 0.9, dn));
  let cc = mix(vec3f(0.58, 0.60, 0.66), vec3f(1.28, 1.10, 0.86), lit);
  let H2 = 3900.0;
  let q = g.cam.xz + rd.xz / rd.y * H2;
  let ci = textureSampleLevel(tCl, sR, q * 0.00028 + vec2f(t * 0.0015, 0.), 0.).b;
  let cir = ss(0.66, 0.86, ci) * ss(0.05, 0.3, rd.y) * 0.32;
  let c2 = vec3f(1.05, 0.98, 0.92);
  return cc * cov + c2 * cir;
}
fn skyCol(rd: vec3f) -> vec3f {
  var c = skyBase(rd);
  c += cloudLayer(rd) * (1.0 - ss(0.55, 0.95, c.b * 1.4));
  return c;
}
// land haze: distance + valley mist, warm toward the sun
fn fogLand(col: vec3f, wp: vec3f) -> vec3f {
  let v = wp - g.cam.xyz;
  let d = max(length(v), 1e-4);
  let rd = v / d;
  let low = exp(-max(wp.y - 112., 0.) * 0.0052);
  let mist = exp(-abs(wp.y - 132.) * 0.05) * 0.42;
  let k = (0.00115 + 0.0033 * low + 0.0048 * mist) * g.mis.w;
  let f = 1.0 - exp(-d * k);
  let sd = max(dot(rd, g.sun.xyz), 0.);
  let mu = max(dot(normalize(vec3f(rd.x, 0., rd.z)), normalize(vec3f(g.sun.x, 0., g.sun.z))), 0.);
  let fc = mix(vec3f(0.80, 0.79, 0.74), vec3f(1.08, 0.84, 0.58), 0.25 * pow(mu, 2.0) + 0.55 * pow(sd, 6.0));
  return mix(col, fc * (0.9 + 1.1 * pow(sd, 5.0)), sat(f));
}
`;
// ---------------------------------------------------------------- bind group + shadow helpers
const S_B = S_G + /*wgsl*/`
@group(0) @binding(0) var<uniform> g: G;
@group(0) @binding(1) var sR: sampler;
@group(0) @binding(2) var sC: sampler;
@group(0) @binding(3) var sS: sampler_comparison;
@group(0) @binding(4) var tSh: texture_depth_2d;
@group(0) @binding(5) var tD: texture_2d<f32>;
@group(0) @binding(6) var tL: texture_2d<f32>;
@group(0) @binding(7) var tT: texture_2d<f32>;
@group(0) @binding(8) var tM: texture_2d<f32>;
@group(0) @binding(9) var tCl: texture_2d<f32>;
fn shUV(p: vec3f) -> vec3f { let s = g.sm * vec4f(p, 1.); return vec3f(s.x * .5 + .5, .5 - s.y * .5, s.z - .0006); }
fn shadow1(p: vec3f) -> f32 { let s = shUV(p); return textureSampleCompareLevel(tSh, sS, s.xy, s.z); }
fn shadow4(p: vec3f) -> f32 {
  let s = shUV(p); let e = 1.9 / ${SHADOW}.;
  return (textureSampleCompareLevel(tSh, sS, s.xy + vec2f(-e, -e), s.z) + textureSampleCompareLevel(tSh, sS, s.xy + vec2f(e, -e), s.z)
        + textureSampleCompareLevel(tSh, sS, s.xy + vec2f(-e, e), s.z) + textureSampleCompareLevel(tSh, sS, s.xy + vec2f(e, e), s.z)) * .25;
}
fn shadow9(p: vec3f) -> f32 {
  if (${LV > 1}) { return shadow1(p); }
  let s = shUV(p); let e = 2.3 / ${SHADOW}.; var a = 0.;
  for (var x = -1; x <= 1; x++) { for (var y = -1; y <= 1; y++) { a += textureSampleCompareLevel(tSh, sS, s.xy + vec2f(f32(x), f32(y)) * e, s.z); } }
  return a / 9.;
}
fn gmAt(wp: vec3f) -> vec4f { return textureSampleLevel(tM, sC, wp.xz / ${EXT}. + .5, 0.); }
${S_H};
${S_K};
// triplanar detail: x,y = bump slope, z = height pattern, w = mottle
struct TP { h: f32, c: f32, n: vec3f };
fn tri(p: vec3f, n: vec3f, s: f32) -> TP {
  var w = pow(abs(n), vec3f(4.)); w = w / (w.x + w.y + w.z);
  let x = textureSampleLevel(tD, sR, p.zy * s, 0.); let y = textureSampleLevel(tD, sR, p.xz * s, 0.); let z = textureSampleLevel(tD, sR, p.xy * s, 0.);
  var o: TP;
  o.h = x.b * w.x + y.b * w.y + z.b * w.z;
  o.c = x.a * w.x + y.a * w.y + z.a * w.z;
  let a = x.rg * 2. - 1.; let b = y.rg * 2. - 1.; let c = z.rg * 2. - 1.;
  o.n = vec3f(0., a.y, a.x) * w.x + vec3f(b.x, 0., b.y) * w.y + vec3f(c.x, c.y, 0.) * w.z;
  return o;
}
`;

// ---------------------------------------------------------------- near terrain
const W_TERR = W_NOISE + S_B + /*wgsl*/`
struct VI { @location(0) p: vec3f, @location(1) n: vec4f };
struct VO { @builtin(position) cp: vec4f, @location(0) wp: vec3f, @location(1) n: vec3f, @location(2) rock: f32 };
@vertex fn vs(i: VI) -> VO {
  var o: VO;
  o.cp = g.vp * vec4f(i.p, 1.); o.wp = i.p; o.n = i.n.xyz; o.rock = f32(i.n.w);
  return o;
}
@vertex fn vssh(i: VI) -> @builtin(position) vec4f { return g.sm * vec4f(i.p, 1.); }
@fragment fn fs(i: VO) -> @location(0) vec4f {
  let n0 = normalize(i.n);
  let dist = length(i.wp - g.cam.xyz);
  let gm = gmAt(i.wp);
  let det = g.mis.y;
  let s1 = tri(i.wp, n0, 0.055); let s2 = tri(i.wp, n0, 0.26); let s3 = tri(i.wp, n0, 1.05);
  let fk = ss(90., 8., dist);
  let hgt = s1.h * 0.5 + s2.h * 0.34 + s3.h * 0.16;
  let mot = s1.c * 0.6 + s2.c * 0.4;
  let slope = 1.0 - n0.y;
  let rockv = sat(i.rock * 0.5 + 0.5 + slope * 1.6 - 0.55);
  // meadow / forest floor
  var alb = mix(vec3f(0.155, 0.215, 0.075), vec3f(0.235, 0.30, 0.105), mot);
  alb = mix(alb, vec3f(0.115, 0.16, 0.06), gm.r * 0.85);                                  // moss under canopy
  alb *= 0.85 + 0.4 * hgt;
  alb = mix(alb, alb * vec3f(1.14, 0.98, 0.62) + vec3f(0.02, 0.01, 0.0), ss(0.55, 0.8, s3.c) * (1.0 - gm.r)); // dry litter
  // rocky slopes and high scree
  let bed = sin(i.wp.y * 0.33 + hgt * 3.0);
  var rc = mix(vec3f(0.30, 0.28, 0.25), vec3f(0.47, 0.43, 0.375), hgt);
  rc = mix(rc, vec3f(0.40, 0.36, 0.30), sat(bed * 0.5 + 0.5) * 0.35);
  rc = mix(rc, vec3f(0.52, 0.50, 0.47), ss(320., 480., i.wp.y) * 0.6);                    // pale scree high up
  rc *= 0.8 + 0.45 * (s2.h * 0.6 + s3.h * 0.4);
  alb = mix(alb, rc, sat(rockv));
  // dirt path + courtyard pavement
  alb = mix(alb, mix(vec3f(0.285, 0.225, 0.155), vec3f(0.36, 0.30, 0.24), mot) * (0.8 + 0.35 * hgt), sat(gm.b) * 0.85 * (1.0 - rockv * 0.6));
  // riverbank sand, wet and dark at the waterline
  let wy = waterLevel(i.wp.z);
  let sand = gm.a;
  alb = mix(alb, vec3f(0.44, 0.38, 0.27) * (0.8 + 0.4 * hgt), sat(sand) * (1.0 - rockv * 0.5));
  let wet = ss(wy + 0.55, wy - 0.1, i.wp.y) * sand;
  alb = mix(alb, alb * vec3f(0.42, 0.44, 0.42), sat(wet));
  // subtle variation
  alb *= 0.88 + 0.24 * textureSampleLevel(tD, sR, i.wp.xz * 0.0043, 0.).a;
  // bump normal
  let bput = (s1.n * 0.9 + s2.n * 0.5 * ss(60., 14., dist) + s3.n * 0.35 * fk) * (1.4 - rockv * 0.5);
  let N = normalize(n0 + vec3f(bput.x, 0., bput.y) * 0.8 + vec3f(0., 0.15, 0.));
  // lighting
  let L = g.sun.xyz; let V = normalize(g.cam.xyz - i.wp);
  let sh = shadow9(i.wp + N * 0.3);
  let E = sunc() * sh;
  let ndl = sat(dot(N, L));
  let sky = mix(vec3f(0.42, 0.48, 0.56), vec3f(0.60, 0.66, 0.74), 0.5 + 0.5 * N.y);
  let bounce = vec3f(0.24, 0.20, 0.14) * (0.35 + 0.4 * (1.0 - N.y));
  let ao = 1.0 - gm.r * 0.22 - rockv * 0.08;
  var c = alb * (E * ndl * (1.0 + 0.3 * hgt) + (sky + bounce) * ao);
  // grass translucency against the low sun
  c += alb * vec3f(1.05, 0.85, 0.5) * pow(sat(dot(-V, L)), 3.0) * 0.35 * (1.0 - rockv);
  let Hv = normalize(V + L);
  c += E * pow(sat(dot(N, Hv)), 14.0) * 0.12 * rockv;
  return fin(fogLand(c, i.wp));
}
`;

// ---------------------------------------------------------------- far mountains (positions from terrH in the vertex shader)
const W_FAR = S_B + W_NOISE + /*wgsl*/`
struct VO { @builtin(position) cp: vec4f, @location(0) wp: vec3f, @location(1) n: vec3f };
@vertex fn vs(@location(0) p: vec3f) -> VO {
  var o: VO;
  let e = 26.0;
  let h = terrH(p.x, p.z) - 1.6;
  let nx = terrH(p.x - e, p.z) - terrH(p.x + e, p.z);
  let nz = terrH(p.x, p.z - e) - terrH(p.x, p.z + e);
  let l = max(length(vec3f(nx, 2.0 * e, nz)), 1e-4);
  o.wp = vec3f(p.x, h, p.z);
  o.n = vec3f(nx / l, 2.0 * e / l, nz / l);
  o.cp = g.vp * vec4f(o.wp, 1.);
  return o;
}
@fragment fn fs(i: VO) -> @location(0) vec4f {
  let n = normalize(i.n);
  let gm = gmAt(i.wp);
  let slope = 1.0 - n.y;
  let big = textureSampleLevel(tD, sR, i.wp.xz * 0.0009, 1.).a;
  var alb = mix(vec3f(0.16, 0.22, 0.08), vec3f(0.235, 0.29, 0.11), big);
  alb = mix(alb, vec3f(0.11, 0.155, 0.062), gm.r * 0.8);
  var rc = mix(vec3f(0.30, 0.28, 0.25), vec3f(0.50, 0.47, 0.43), big);
  rc = mix(rc, vec3f(0.62, 0.60, 0.57), ss(340., 560., i.wp.y));
  alb = mix(alb, rc, sat(slope * 2.1 - 0.5));
  let L = g.sun.xyz;
  let E = sunc();
  let ndl = sat(dot(n, L));
  let sky = mix(vec3f(0.42, 0.48, 0.56), vec3f(0.62, 0.68, 0.76), 0.5 + 0.5 * n.y);
  var c = alb * (E * ndl + sky * 0.9);
  return fin(fogLand(c, i.wp));
}
`;

// ---------------------------------------------------------------- solids: rocks, grotto shell, fortress (tone aux drives material)
const W_SOL = W_NOISE + S_B + /*wgsl*/`
struct VI { @location(0) p: vec3f, @location(1) n: vec4f, @location(2) a: vec4f, @location(3) b: vec4f, @location(4) c: vec4f };
struct VO { @builtin(position) cp: vec4f, @location(0) wp: vec3f, @location(1) n: vec3f, @location(2) op: vec3f, @location(3) @interpolate(flat) tn: f32, @location(4) sd: f32 };
@vertex fn vs(i: VI) -> VO {
  var o: VO;
  let q = i.b;
  let sc = i.a.w;
  let w = i.a.xyz + qrot(q, i.p * sc);
  o.cp = g.vp * vec4f(w, 1.); o.wp = w; o.n = qrot(q, i.n.xyz); o.op = i.p; o.tn = i.n.w; o.sd = i.c.y;
  return o;
}
@vertex fn vssh(i: VI) -> @builtin(position) vec4f { return g.sm * vec4f(i.a.xyz + qrot(i.b, i.p * i.a.w), 1.); }
@fragment fn fs(i: VO) -> @location(0) vec4f {
  let tn = i.tn;
  let n0 = normalize(i.n);
  let dist = length(i.wp - g.cam.xyz);
  let s1 = tri(i.wp, n0, 0.06); let s2 = tri(i.wp, n0, 0.3);
  let hgt = s1.h * 0.6 + s2.h * 0.4;
  var alb = vec3f(0.); var gloss = 0.1; var bump = 1.0;
  if (abs(tn) > 0.75) {
    // natural rock: outer sunlit / inner grotto dark
    let bed = sin(i.wp.y * 0.5 + s1.h * 4.0 + i.sd * 20.0);
    var rc = mix(vec3f(0.27, 0.25, 0.22), vec3f(0.46, 0.42, 0.36), hgt);
    rc = mix(rc, vec3f(0.38, 0.34, 0.27), sat(bed * 0.5 + 0.5) * 0.4);
    rc *= 0.75 + 0.5 * s2.h;
    rc = mix(rc * 0.45, rc, sat(tn * 0.5 + 0.5));                       // inner shell darker
    let moss = ss(0.45, 0.8, gmAt(i.wp).g) * ss(1.2, 0.35, abs(i.wp.y - 121.0)) * ss(0.0, 0.5, tn);
    rc = mix(rc, vec3f(0.13, 0.18, 0.07), moss * 0.7);
    alb = rc; bump = 1.5;
  } else if (tn > 0.4) {
    // dressed sandstone: coursed masonry
    let row = floor(i.wp.y * 1.38);
    let off = fract(row * 0.618) * 2.0;
    let colv = floor((i.op.x + i.op.z) * 0.55 + off);
    let bp = fract(vec2f((i.op.x + i.op.z) * 0.55 + off, i.wp.y * 1.38));
    let mort = ss(0.045, 0.012, min(min(bp.x, 1.0 - bp.x), min(bp.y, 1.0 - bp.y)));
    let tone = 0.82 + 0.36 * h21(vec2f(row, colv));
    var st = mix(vec3f(0.62, 0.55, 0.44), vec3f(0.75, 0.68, 0.55), hgt) * tone;
    st = mix(st, st * vec3f(0.86, 0.80, 0.72), sat(h21(vec2f(colv, row)) * 0.4 - 0.15) * 0.5);   // weathering patches
    st = mix(st, vec3f(0.72, 0.72, 0.74), ss(0.55, 0.9, gmAt(i.wp).b) * 0.35);                   // pale court pavement dust
    let mossy = ss(0.5, 0.85, gmAt(i.wp).g) * ss(3.0, 0.4, i.wp.y - ${FCH}.);
    st = mix(st, vec3f(0.14, 0.19, 0.08), mossy * 0.55);
    alb = mix(st * 0.42, st, mort);
    bump = 0.9 + mort * 1.6;
    gloss = 0.08;
  } else if (tn > -0.35) {
    // timber: vertical planks
    let pl = fract(i.op.z * 1.7);
    let seam = ss(0.06, 0.015, min(pl, 1.0 - pl));
    let grain = textureSampleLevel(tD, sR, vec2f(i.op.z * 1.7, i.op.y * 0.35), 0.).a;
    alb = mix(vec3f(0.16, 0.105, 0.06), vec3f(0.24, 0.16, 0.09), grain) * (0.75 + 0.5 * hgt);
    alb = mix(alb * 0.4, alb, seam);
    bump = 0.7 + seam; gloss = 0.16;
  } else if (tn > -0.7) {
    // glazed turquoise tile band
    let band = fract(i.wp.y * 2.6);
    let star = step(0.5, fract((i.op.x + i.op.z) * 0.8));
    var tc = mix(vec3f(0.03, 0.30, 0.33), vec3f(0.06, 0.44, 0.44), star);
    tc = mix(tc, vec3f(0.80, 0.76, 0.62), ss(0.42, 0.5, band) * ss(0.58, 0.5, band) * 0.85);
    alb = tc; gloss = 0.85; bump = 0.25;
  } else if (tn > -0.78) {
    alb = vec3f(0.012, 0.010, 0.009); gloss = 0.05; bump = 0.2;                          // dark interiors
  } else {
    // gilded trim
    alb = vec3f(0.92, 0.70, 0.28) * (0.7 + 0.5 * hgt); gloss = 1.0; bump = 0.3;
  }
  let N = normalize(n0 + (s1.n * 0.7 + s2.n * 0.45) * bump);
  let L = g.sun.xyz; let V = normalize(g.cam.xyz - i.wp);
  let sh = shadow9(i.wp + N * 0.25);
  let E = sunc() * sh;
  let ndl = sat(dot(N, L));
  let sky = mix(vec3f(0.40, 0.46, 0.54), vec3f(0.60, 0.66, 0.75), 0.5 + 0.5 * N.y);
  let bounce = vec3f(0.26, 0.22, 0.16) * (0.3 + 0.45 * (1.0 - N.y));
  var c = alb * (E * ndl + (sky + bounce) * (0.9 - gloss * 0.3));
  let Hv = normalize(V + L);
  c += E * pow(sat(dot(N, Hv)), mix(12., 90., gloss)) * gloss * 1.6 * ndl;
  c += sky * pow(1.0 - sat(dot(N, V)), 3.0) * gloss * 0.35;
  // interior of the grotto keeps a faint cool skylight
  if (tn < -0.75) { c += vec3f(0.05, 0.09, 0.10) * (0.25 + 0.3 * N.y); }
  return fin(fogLand(c, i.wp));
}
`;

// ---------------------------------------------------------------- trees (trunk + canopy cards, wind sway)
const W_TREE = W_NOISE + S_B + /*wgsl*/`
struct VI { @location(0) p: vec3f, @location(1) uv: vec4f, @location(2) n: vec4f,
  @location(3) a: vec4f, @location(4) b: vec4f, @location(5) c: vec4f };
struct VO { @builtin(position) cp: vec4f, @location(0) wp: vec3f, @location(1) n: vec3f, @location(2) uv: vec2f,
  @location(3) @interpolate(flat) lf: f32, @location(4) @interpolate(flat) col: vec3f, @location(5) sh: f32, @location(6) @interpolate(flat) ev: f32, @location(7) @interpolate(flat) am: f32 };
fn swayOf(base: vec3f, t: f32, hgt: f32) -> vec2f {
  let gu = gust(base, t);
  let ph = dot(base.xz, vec2f(0.021, 0.013));
  let a = 0.012 * hgt * hgt * gu;
  return a * (vec2f(sin(t * 0.55 + ph), cos(t * 0.42 + ph * 1.4)) + 0.4 * vec2f(sin(t * 1.5 + ph * 2.3), cos(t * 1.1 + ph * 1.9)));
}
@vertex fn vs(i: VI) -> VO {
  var o: VO;
  let t = g.cam.w;
  let sc = i.a.w;
  let yaw = i.b.x; let tilt = i.b.y;
  let cy = cos(yaw); let sy = sin(yaw);
  let ct = cos(tilt); let st = sin(tilt);
  let R = mat3x3f(vec3f(cy, 0., -sy), vec3f(st * sy, ct, st * cy), vec3f(ct * sy, -st, ct * cy));
  let lp = i.p * sc;
  let leaf = f32(i.uv.z) * 2.0 - 1.0;
  let hgt = sat(lp.y / (2.7 * sc));
  let sw = swayOf(i.a.xyz, t, hgt + 0.25);
  var w = i.a.xyz + R * lp;
  w = w + vec3f(sw.x, 0., sw.y) * select(1.0, 1.5, leaf > 0.);
  let flut = select(0.0, (sin(t * (4.5 + i.b.w * 3.0) + i.b.z * 40.0 + lp.y * 5.0) * 0.05 + sin(t * 6.3 + i.c.w * 50.0) * 0.02) * sc, leaf > 0.0);
  w = w + R * vec3f(flut, 0., flut * 0.7);
  o.cp = g.vp * vec4f(w, 1.); o.wp = w;
  o.n = R * normalize(i.n.xyz);
  o.uv = vec2f(f32(i.uv.x), f32(i.uv.y));
  o.lf = leaf; o.sh = f32(i.uv.w); o.ev = i.c.z; o.am = i.c.w;
  // species tint from c.x (moisture-driven) + per-instance variation
  var tint = vec3f(0.10, 0.16, 0.055);
  tint = mix(tint, vec3f(0.16, 0.145, 0.05), sat(i.c.x * 0.7 - 0.25));                       // parrotia warms up
  tint = mix(tint, vec3f(0.06, 0.115, 0.06), step(0.9, i.c.z));                              // evergreen darks
  tint = mix(vec3f(0.16, 0.115, 0.07), tint, step(0.5, o.lf));
  o.col = tint * (0.8 + 0.4 * fract(i.c.y * 0.159155));
  return o;
}
@vertex fn vssh(i: VI) -> @builtin(position) vec4f {
  let t = g.cam.w;
  let sc = i.a.w;
  let yaw = i.b.x; let tilt = i.b.y;
  let cy = cos(yaw); let sy = sin(yaw);
  let ct = cos(tilt); let st = sin(tilt);
  let R = mat3x3f(vec3f(cy, 0., -sy), vec3f(st * sy, ct, st * cy), vec3f(ct * sy, -st, ct * cy));
  let lp = i.p * sc;
  let leaf = f32(i.uv.z) * 2.0 - 1.0;
  let hgt = sat(lp.y / (2.7 * sc));
  let sw = swayOf(i.a.xyz, t, hgt + 0.25);
  var w = i.a.xyz + R * lp + vec3f(sw.x, 0., sw.y) * select(1.0, 1.5, leaf > 0.);
  let flut = select(0.0, (sin(t * (4.5 + i.b.w * 3.0) + i.b.z * 40.0 + lp.y * 5.0) * 0.05 + sin(t * 6.3 + i.c.w * 50.0) * 0.02) * sc, leaf > 0.0);
  w = w + R * vec3f(flut, 0., flut * 0.7);
  return g.sm * vec4f(w, 1.);
}
@fragment fn fs(i: VO, @builtin(front_facing) ff: bool) -> @location(0) vec4f {
  let V = normalize(g.cam.xyz - i.wp);
  let L = g.sun.xyz;
  if (i.lf <= 0.0) {
    // bark
    let fib = textureSampleLevel(tD, sR, vec2f(i.wp.x * 0.8 + i.wp.z * 0.6, i.wp.y * 2.6 + i.wp.x * 0.3), 0.);
    let n0 = normalize(i.n * select(-1., 1., ff));
    let N = normalize(n0 + vec3f(fib.r - 0.5, 0., fib.g - 0.5) * 0.7);
    let E = sunc() * shadow1(i.wp + N * 0.15);
    var alb = mix(vec3f(0.19, 0.14, 0.10), vec3f(0.30, 0.24, 0.18), fib.b) * (0.8 + 0.4 * i.sh);
    var c = alb * (E * sat(dot(N, L)) + vec3f(0.42, 0.48, 0.56) * (0.3 + 0.5 * N.y) * 0.8);
    c += E * pow(sat(dot(N, normalize(V + L))), 10.0) * 0.08;
    return fin(fogLand(c, i.wp));
  }
  // foliage card
  var nl = normalize(i.n * select(-1., 1., ff));
  let uvw = textureSampleLevel(tL, sR, vec2f(i.uv.x, mix(0.06, 0.94, i.uv.y) * 0.5 + select(0.5, 0.0, i.ev > 0.5)), 0.);
  let alpha = uvw.a * ss(0.02, 0.25, i.uv.y) * ss(1.0, 0.75, i.uv.y * 0.2 + 0.8);
  ${AA > 1 ? `if (alpha < 0.14) { discard; }` : `if (alpha < 0.5) { discard; }`}
  let back = select(1.0, 0.55, ff);
  let ndl = dot(nl, L);
  let E = sunc() * shadow1(i.wp + L * 0.25);
  let tr = (max(-ndl, 0.) * 0.75 + 0.25) * 0.55;
  let vv = sat(dot(nl, V));
  let ir = 0.5 + 0.5 * cos(TAU * (vec3f(0., 0.33, 0.67) + vv * 0.7 + i.sh * 0.3));
  var alb = i.col * (0.62 + 0.5 * uvw.g) * mix(0.65, 1.15, i.sh) * back;
  alb = mix(alb, alb * vec3f(1.5, 1.15, 0.6) + vec3f(0.1, 0.05, 0.), i.am * 0.45 * ss(0.5, 1.0, i.sh)); // amber crowns on the ironwood
  let sky = mix(vec3f(0.42, 0.48, 0.56), vec3f(0.62, 0.68, 0.76), 0.4 + 0.6 * nl.y);
  var c = E * (alb * max(ndl, 0.) + alb * vec3f(1.25, 1.05, 0.7) * tr);
  c += alb * (sky * (0.55 + 0.45 * back) + vec3f(0.24, 0.2, 0.14) * 0.4);
  c += E * alb * pow(sat(dot(-V, L)), 4.0) * 0.9;
  c += ir * vec3f(0.10, 0.14, 0.06) * pow(1.0 - vv, 3.0) * 0.6;
  let outa = ${AA > 1 ? `alpha` : `1.0`};
  var col = fin(fogLand(c, i.wp));
  return vec4f(col.rgb, outa);
}
`;

// shadow-only foliage module: reuse the tree vertex, discard by texture alpha
const W_TREESH = W_TREE + /*wgsl*/`
@fragment fn fssh(@location(0) wp: vec3f, @location(1) n: vec3f, @location(2) uv: vec2f,
  @location(3) @interpolate(flat) lf: f32, @location(4) @interpolate(flat) col: vec3f, @location(5) sh: f32, @location(6) @interpolate(flat) ev: f32) {
  if (lf <= 0.0) { return; }
  let a = textureSampleLevel(tL, sR, vec2f(uv.x, mix(0.06, 0.94, uv.y) * 0.5 + select(0.5, 0.0, ev > 0.5)), 0.).a;
  if (a < 0.5) { discard; }
}
`;
