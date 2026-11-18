// ============================================================================
// WGSL sources, part 2: grass, water, falls, sky, sprites, birds, flags,
// light shafts, bloom / post, and the baked textures
// ============================================================================

const W_FS = /*wgsl*/`
@vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f { return vec4f(f32(i32(i & 1u) * 4 - 1), f32(i32(i >> 1u) * 4 - 1), 0., 1.); }
`;

// ---------------------------------------------------------------- grass / ferns / poppies (instanced blade strips)
const W_GRASS = W_NOISE + S_B + /*wgsl*/`
override ROWS: f32 = 4.;
struct GI { @location(0) a: vec4f, @location(1) b: vec4f, @location(2) c: vec2u };
struct GO { @builtin(position) cp: vec4f, @location(0) wp: vec3f, @location(1) n: vec3f, @location(2) uv: vec2f,
  @location(3) @interpolate(flat) pr: vec4f };
@vertex fn vs(@builtin(vertex_index) vi: u32, gi: GI) -> GO {
  var o: GO;
  let u = f32(vi & 1u) * 2.0 - 1.0;
  let v = sin(f32(vi >> 1u) / (ROWS - 1.0) * 1.5708);
  let t = g.cam.w;
  let base = gi.a.xyz; let len = gi.a.w;
  let yaw = gi.b.x; let wid = gi.b.y;
  let ty = f32(gi.c.x & 255u);
  let bend = f32((gi.c.x >> 8u) & 255u) / 255.0;
  let sA = gi.b.z; let sB = gi.b.w;
  let gu = gust(base, t);
  let ydir = vec3f(sin(yaw), 0., cos(yaw));
  let wdir = vec3f(cos(yaw), 0., -sin(yaw));
  let lean = (bend * 0.5 + 0.35) * gu;
  let wav = sin(v * (9.0 + sA * 6.0) + sB * 40.0 + t * (1.6 + sB)) * 0.10 * (1.0 - v);
  var widsh = (1.0 - v);
  if (ty == 2.0) { widsh = pow(1.0 - v, 0.7) * 1.15; }                    // sedge
  if (ty == 1.0) { widsh = (1.0 - v) * (1.0 + 0.3 * sin(v * 24.0 + sA * 50.0)); } // fern frond
  if (ty == 3.0) {                                                        // poppy: stem, then the red cup
    widsh = select(0.45, 0.45 + 3.2 * ss(0.72, 0.86, v) * ss(1.0, 0.9, v), v < 0.5);
    widsh = mix(widsh, widsh * 0.5, ss(0.5, 0.75, v));
    widsh = mix(widsh, 1.9 * (1.0 - ss(0.86, 1.0, v)), ss(0.74, 0.8, v));
  }
  let p = base + vec3f(0., v * len, 0.) + ydir * (lean * v * v * len * 0.55 + wav * len * 0.2)
        + wdir * (u * wid * widsh * len);
  o.cp = g.vp * vec4f(p, 1.); o.wp = p;
  o.n = normalize(vec3f(ydir.z, u * 0.35, -ydir.x));
  o.uv = vec2f(u, v);
  o.pr = vec4f(ty, sA, sB, wid);
  return o;
}
@fragment fn fs(i: GO) -> @location(0) vec4f {
  let V = normalize(g.cam.xyz - i.wp);
  let L = g.sun.xyz;
  let n = normalize(i.n);
  let ty = i.pr.x;
  var alb = mix(vec3f(0.125, 0.185, 0.055), vec3f(0.21, 0.27, 0.095), i.pr.y);
  alb = mix(alb, vec3f(0.10, 0.16, 0.06), step(1.2, ty) * step(ty, 1.9));            // fern
  alb = mix(alb, vec3f(0.17, 0.21, 0.10), step(2.2, ty) * step(ty, 2.9));            // sedge
  alb = mix(alb, vec3f(0.30, 0.26, 0.11), step(3.8, ty));                              // dry grass
  alb *= mix(0.55, 1.15, i.uv.y);
  let isPop = step(3.2, ty) * step(ty, 3.8);
  let cup = ss(0.72, 0.84, i.uv.y) * ss(1.0, 0.9, i.uv.y);
  alb = mix(alb, mix(vec3f(0.62, 0.09, 0.06), vec3f(0.30, 0.02, 0.10), ss(0.86, 1.0, i.uv.y)), cup * isPop);
  alb = mix(alb, alb * 1.25 + vec3f(0.02, 0.01, 0.0), i.pr.y * 0.3);
  let E = sunc() * shadow1(i.wp + L * 0.3);
  let ndl = dot(n, L);
  let tr = max(-ndl, 0.) * 0.8 + 0.2;
  var c = E * (alb * max(ndl, 0.) + alb * vec3f(1.3, 1.05, 0.65) * tr * 0.8);
  c += alb * (vec3f(0.44, 0.5, 0.58) * (0.4 + 0.5 * n.y) + vec3f(0.24, 0.2, 0.14) * 0.3);
  c += alb * vec3f(1.1, 0.9, 0.55) * pow(sat(dot(-V, L)), 3.0) * 0.5;
  return fin(fogLand(c, i.wp));
}
`;

// ---------------------------------------------------------------- river surface
const W_WATER = S_B + W_NOISE + /*wgsl*/`
const WV = array<vec4f, 8>(vec4f(0.94, 0.34, 1.7, 1.15), vec4f(-0.55, 0.84, 2.3, 0.9), vec4f(0.31, -0.95, 3.1, 0.7),
  vec4f(-0.87, -0.49, 4.2, 0.55), vec4f(0.63, 0.77, 5.5, 0.42), vec4f(-0.2, 0.98, 7.1, 0.34),
  vec4f(0.98, -0.16, 8.9, 0.25), vec4f(-0.42, -0.91, 11.4, 0.18));
struct WI { @location(0) p: vec3f, @location(1) us: vec2f };
struct WO { @builtin(position) cp: vec4f, @location(0) wp: vec3f, @location(1) us: vec2f };
@vertex fn vs(i: WI) -> WO {
  var o: WO;
  o.cp = g.vp * vec4f(i.p, 1.); o.wp = i.p; o.us = i.us;
  return o;
}
@fragment fn fs(i: WO) -> @location(0) vec4f {
  let t = g.cam.w;
  let wy = waterLevel(i.wp.z);
  let hb = terrH(i.wp.x, i.wp.z);
  let depth = wy - hb;
  if (depth < 0.02) { discard; }
  let damp = ss(0.06, 0.9, depth);
  // directional wave slopes
  var sx = 0.; var sz = 0.;
  for (var k = 0; k < 8; k++) {
    let w = WV[k];
    let ph = dot(w.xy, i.wp.xz) * w.z * 0.14 + t * (1.1 + w.z * 0.4) + w.z * 13.0;
    let a = w.w * 0.06 * damp;
    let c = cos(ph) * a * w.z * 0.14;
    sx += w.x * c; sz += w.y * c;
  }
  let rip = textureSampleLevel(tT, sR, i.wp.xz * 0.11 + vec2f(t * 0.03, t * 0.021), 0.).rg;
  sx += (rip.x - 0.5) * 0.16 * damp; sz += (rip.y - 0.5) * 0.16 * damp;
  let N = normalize(vec3f(-sx, 1.0, -sz));
  let V = normalize(g.cam.xyz - i.wp);
  let R = reflect(-V, N);
  // riverbed seen through the shallows
  let gm = gmAt(i.wp);
  let bedC = mix(vec3f(0.30, 0.24, 0.16), vec3f(0.13, 0.17, 0.09), gm.r);
  let absb = exp(-vec3f(0.42, 0.20, 0.13) * max(depth, 0.));
  var bed = bedC * (sunc() * 0.55 + vec3f(0.4, 0.46, 0.52) * 0.6) * absb;
  // caustic sparkle on the gravel
  let ca = textureSampleLevel(tT, sR, i.wp.xz * 0.33 + vec2f(t * 0.017, -t * 0.013), 1.).b;
  bed += sunc() * pow(ca, 3.0) * ss(0.4, 0.06, depth) * 1.6;
  // sky + clouds + sun in the reflection
  let rr = normalize(vec3f(R.x, abs(R.y) + 0.02, R.z));
  let refl = skyCol(rr) * 0.9;
  let sh = shadow1(i.wp + vec3f(0., 0.3, 0.));
  let glint = pow(max(dot(rr, g.sun.xyz), 0.), 320.0) * sunc() * 3.4 * (0.5 + 0.5 * sh);
  let ndv = sat(dot(N, V));
  let fres = 0.025 + 0.975 * pow(1.0 - ndv, 5.0);
  // foam: banks, crest noise, pool churn
  let fn1 = textureSampleLevel(tT, sR, i.wp.xz * 0.6 + vec2f(t * 0.05, t * 0.04), 0.);
  let fn2 = textureSampleLevel(tT, sR, i.wp.xz * 0.17 - vec2f(t * 0.031, t * 0.024), 0.);
  let edge = 1.0 - ss(0.05, 0.5, depth);
  let churn = ss(0.62, 0.9, fn1.g * 0.6 + fn2.r * 0.6) * ss(1.4, 3.0, depth) * 0.6;
  let foam = sat(edge * (0.55 + 0.5 * fn1.r) + churn);
  let foamT = 0.75 + 0.3 * sin(t * 2.1 + fn2.g * 9.0 + i.wp.x * 0.7);
  var col = mix(bed, refl, fres * ss(0.15, 1.6, depth)) + glint;
  col = mix(col, vec3f(0.94, 0.97, 0.99) * (0.75 + 0.35 * sunc().g), sat(foam * foamT));
  let alpha = sat(ss(0.05, 0.55, depth) * 0.92 + 0.08 + foam);
  let outc = fogLand(col * (0.85 + 0.3 * damp), i.wp);
  return vec4f(outc.rgb, sat(alpha));
}
`;

// ---------------------------------------------------------------- waterfall sheet
const W_FALL = W_NOISE + S_B + /*wgsl*/`
struct FI { @location(0) p: vec3f, @location(1) ut: vec2f };
struct FO { @builtin(position) cp: vec4f, @location(0) wp: vec3f, @location(1) uv: vec2f };
@vertex fn vs(i: FI) -> FO {
  var o: FO;
  o.cp = g.vp * vec4f(i.p, 1.); o.wp = i.p; o.uv = i.ut;
  return o;
}
@fragment fn fs(i: FO) -> @location(0) vec4f {
  let t = g.cam.w;
  let u = i.uv.x; let v = i.uv.y;
  let fall = v * v * 1.4 + v * 0.35;                       // accelerate downward
  let n1 = textureSampleLevel(tT, sR, vec2f(u * 3.0, fall * 2.6 + t * 0.62), 0.);
  let n2 = textureSampleLevel(tT, sR, vec2f(u * 7.0 + 3.7, fall * 5.2 + t * 0.95), 0.);
  let n3 = textureSampleLevel(tT, sR, vec2f(u * 16.0, fall * 9.0 + t * 1.3), 1.);
  let streak = sat(n1.r * 0.5 + n2.g * 0.35 + n3.b * 0.3 + (0.5 - abs(u - 0.5)) * 0.35 - 0.12);
  let body = ss(0.18, 0.72, streak);
  let edgeU = ss(0.0, 0.09, u) * ss(1.0, 0.91, u);
  let edgeV = ss(0.0, 0.06, v);
  let spray = ss(0.9, 1.0, v);
  let alpha = sat((body * 0.62 + 0.30) * edgeU * edgeV);
  let sh = shadow1(i.wp + vec3f(0., -0.4, 0.));
  var col = mix(vec3f(0.62, 0.72, 0.78), vec3f(1.02, 1.04, 1.06), body);
  col += sunc() * pow(sat(dot(vec3f(0., -1., 0.), g.sun.xyz)), 2.0) * 0.25 * sh;
  col *= 0.85 + 0.3 * n2.r;
  col = mix(col, vec3f(0.97, 0.98, 1.0), spray * 0.7);
  alpha = sat(alpha + spray * 0.45);
  let outc = fogLand(col, i.wp);
  return vec4f(outc.rgb, alpha * 0.88);
}
`;

// ---------------------------------------------------------------- sky dome
const W_SKY = W_NOISE + S_G + W_FS + /*wgsl*/`
@group(0) @binding(0) var<uniform> g: G;
@group(0) @binding(1) var sR: sampler;
@group(0) @binding(2) var sC: sampler;
@group(0) @binding(9) var tCl: texture_2d<f32>;
${S_H};
${S_K};
@fragment fn fs(@builtin(position) fc: vec4f) -> @location(0) vec4f {
  let nd = vec2f(fc.x * g.res.z * 2.0 - 1.0, 1.0 - fc.y * g.res.w * 2.0);
  let rd = normalize(g.fwd.xyz + g.right.xyz * (nd.x * g.right.w) + g.up.xyz * (nd.y * g.up.w));
  var c = skyBase(rd);
  let sd = max(dot(rd, g.sun.xyz), 0.);
  c += vec3f(1.25, 1.02, 0.72) * ss(0.99985, 0.99993, sd) * 5.0;
  c += cloudLayer(rd) * (1.0 - ss(0.5, 0.9, c.b * 1.5));
  if (rd.y < 0.0) { c = mix(c, vec3f(0.72, 0.72, 0.69), ss(0.0, -0.14, rd.y) * 0.7); }
  return vec4f(c, 1.);
}
`;

// ---------------------------------------------------------------- sprites: motes, leaves, mist
const W_SPR = W_NOISE + S_B + /*wgsl*/`
struct VO { @builtin(position) cp: vec4f, @location(0) uv: vec2f, @location(1) @interpolate(flat) pr: vec4f, @location(2) wp: vec3f };
fn quad(i: u32) -> vec2f { return vec2f(f32(i & 1u), f32(i >> 1u)) * 2.0 - 1.0; }
@vertex fn vsMote(@builtin(vertex_index) vi: u32, @location(0) a: vec4f) -> VO {
  var o: VO;
  let q = quad(vi);
  let t = g.cam.w;
  let B = 44.0;
  var p = a.xyz * B + vec3f(t * 0.35, sin(t * 0.24 + a.w * 40.0) * 1.4, t * 0.22);
  p.x += sin(t * 0.5 + a.w * 70.0) * 1.1;
  p = g.cam.xyz + (fract((p - g.cam.xyz) / B + .5) - .5) * B;
  let d = length(p - g.cam.xyz);
  let sz = max(0.016 + 0.03 * a.w * a.w, d * 0.0018);
  o.cp = g.vp * vec4f(p + (g.right.xyz * q.x + g.up.xyz * q.y) * sz, 1.);
  o.uv = q; o.wp = p;
  let tw = pow(0.5 + 0.5 * sin(t * (0.6 + a.w * 1.8) + a.w * 90.0), 3.0);
  o.pr = vec4f(ss(B * 0.5, B * 0.36, d) * ss(1.2, 2.6, d) * tw, a.w, sz, shadow1(p));
  return o;
}
@fragment fn fsMote(i: VO) -> @location(0) vec4f {
  let r = length(i.uv);
  let m = ss(1.0, 0.25, r);
  let c = (sunc() * i.pr.w * 0.55 + vec3f(0.5, 0.55, 0.62) * 0.5) * mix(vec3f(1.), vec3f(1.2, 0.9, 0.6), i.pr.y);
  return vec4f(max(c * m * m * i.pr.x, vec3f(0.)), 0.);
}
@vertex fn vsLeaf(@builtin(vertex_index) vi: u32, @location(0) a: vec4f, @location(1) b: vec2f) -> VO {
  var o: VO;
  let q = quad(vi);
  let t = g.cam.w;
  let B = 38.0;
  let life = fract(t * 0.036 * (0.6 + a.w * 0.8) + b.y);
  var p = a.xyz * B;
  p.y -= life * 26.0;
  p.x += sin(t * (0.9 + b.y) + a.w * 50.0 + life * 9.0) * 2.6;
  p.z += cos(t * (0.7 + a.w) + a.w * 30.0 + life * 7.0) * 2.6;
  p = g.cam.xyz + (fract((p - g.cam.xyz) / B + .5) - .5) * B;
  let d = length(p - g.cam.xyz);
  let ca = cos(t * (1.4 + a.w * 2.0) + b.y * 9.0);
  let sa = sin(t * (1.4 + a.w * 2.0) + b.y * 9.0);
  let w = p + (g.right.xyz * (q.x * ca - q.y * sa) + g.up.xyz * (q.x * sa + q.y * ca)) * b.x;
  o.cp = g.vp * vec4f(w, 1.);
  o.uv = q; o.wp = p;
  let fade = ss(B * 0.5, B * 0.35, d) * ss(1.0, 2.4, d) * sin(life * 3.1416);
  o.pr = vec4f(fade, a.w, b.x, shadow1(p));
  return o;
}
@fragment fn fsLeaf(i: VO) -> @location(0) vec4f {
  let r = abs(i.uv.x) + abs(i.uv.y);
  let m = ss(1.15, 0.5, r);
  let hue = i.pr.y;
  var c = mix(vec3f(0.34, 0.20, 0.05), vec3f(0.16, 0.22, 0.05), hue);
  c = mix(c, vec3f(0.52, 0.16, 0.04), step(0.72, hue));
  let lit = 0.4 + 0.6 * i.pr.w;
  return vec4f(max(c * m * m * i.pr.x * (sunc() * lit + vec3f(0.5, 0.55, 0.62) * 0.6), vec3f(0.)), 0.);
}
@vertex fn vsMist(@builtin(vertex_index) vi: u32, @location(0) a: vec4f, @location(1) b: vec2f) -> VO {
  var o: VO;
  let q = quad(vi);
  let t = g.cam.w;
  let life = fract(t * 0.05 * (0.55 + b.y * 0.9) + b.x * 7.0);
  var p = a.xyz;
  p.y += life * 6.0;
  p.x += sin(t * 0.4 + b.x * 30.0) * 1.5 + t * 0.25;
  p.z += cos(t * 0.33 + b.x * 20.0) * 1.2;
  let sz = a.w * (0.45 + life * 1.15);
  let d = length(p - g.cam.xyz);
  o.cp = g.vp * vec4f(p + (g.right.xyz * q.x + g.up.xyz * q.y) * sz, 1.);
  o.uv = q; o.wp = p;
  let fade = sin(life * 3.1416) * ss(170., 60., d) * ss(3., 8., d);
  o.pr = vec4f(fade, sz, life, shadow1(p + vec3f(0., 1.2, 0.)));
  return o;
}
@fragment fn fsMist(i: VO) -> @location(0) vec4f {
  let r = length(i.uv);
  let m = exp(-r * 3.6) * (1.0 - r);
  let c = (sunc() * (0.3 + 0.5 * i.pr.w) + vec3f(0.56, 0.62, 0.68) * 0.85);
  return vec4f(max(c * m * i.pr.x, vec3f(0.)), 0.);
}
`;

// ---------------------------------------------------------------- birds
const W_BIRD = W_NOISE + S_B + /*wgsl*/`
struct BI { @location(0) p: vec3f, @location(1) n: vec4f, @location(2) a: vec4f, @location(3) b: vec4f };
struct BO { @builtin(position) cp: vec4f, @location(0) wp: vec3f, @location(1) n: vec3f, @location(2) op: vec3f };
@vertex fn vs(i: BI) -> BO {
  var o: BO;
  let t = g.cam.w;
  let c = i.a.xyz; let r = i.a.w;
  let sp = i.b.x; let ph = i.b.y; let sz = i.b.z;
  let an = t * sp + ph;
  let P = c + vec3f(cos(an) * r, sin(an * 2.0 + ph) * r * 0.1, sin(an) * r);
  let T = normalize(vec3f(-sin(an), cos(an * 2.0 + ph) * 0.2, cos(an)));
  let R2 = cross(vec3f(0., 1., 0.), T);
  let U = cross(T, R2);
  let bank = -0.35 * sign(sp);
  let S2 = normalize(R2 * cos(bank) + U * sin(bank));
  let U2 = U * cos(bank) - R2 * sin(bank);
  var l = i.p * sz;
  let flap = sin(t * (7.0 - i.b.w) * 1.6 + ph * 5.0 + abs(l.z) * 2.4) * abs(l.z) * (0.75 + 0.2 * l.y);
  l.y += flap;
  let w = P + T * l.x + U2 * l.y + R2 * l.z;
  o.cp = g.vp * vec4f(w, 1.); o.wp = w;
  o.n = T * i.n.x + U2 * i.n.y + R2 * i.n.z;
  o.op = i.p;
  return o;
}
@fragment fn fs(i: BO) -> @location(0) vec4f {
  let n = normalize(i.n);
  let alb = mix(vec3f(0.10, 0.095, 0.09), vec3f(0.155, 0.14, 0.125), sat(i.op.y * 4.0));
  let E = sunc();
  var c = alb * (E * sat(dot(n, g.sun.xyz)) * 0.8 + vec3f(0.45, 0.5, 0.58) * (0.5 + 0.5 * n.y) * 0.8);
  return fin(fogLand(c, i.wp));
}
`;

// ---------------------------------------------------------------- banner flags
const W_FLAG = W_NOISE + S_B + /*wgsl*/`
struct FI2 { @location(0) a: vec4f, @location(1) b: vec4f };
struct FO2 { @builtin(position) cp: vec4f, @location(0) wp: vec3f, @location(1) uv: vec2f, @location(2) fold: f32 };
@vertex fn vs(@builtin(vertex_index) vi: u32, fi: FI2) -> FO2 {
  var o: FO2;
  let cols = 4u; let rows = 3u;
  let cell = vi / 6u;
  let cu = cell % cols; let cv = cell / cols;
  let corner = vi % 6u;
  let u01 = (f32(cu) + select(0., 1., corner == 1u || corner == 3u || corner == 4u)) / f32(cols);
  let v01 = (f32(cv) + select(0., 1., corner == 2u || corner == 4u || corner == 5u)) / f32(rows);
  let t = g.cam.w;
  let dir = vec3f(sin(fi.b.x), 0., cos(fi.b.x));
  let per = vec3f(cos(fi.b.x), 0., -sin(fi.b.x));
  let wav = sin(u01 * 7.0 - t * 3.2 + fi.b.y) * 0.14 * u01 + sin(u01 * 13.0 - t * 4.6 + fi.b.y * 2.0) * 0.05 * u01;
  let trail = u01 * u01 * 0.35;
  let top = fi.a.xyz;
  let p = top + dir * (u01 * fi.b.z + trail) + per * (wav * fi.b.z) + vec3f(0., -(v01 * fi.b.w + wav * 0.2 * v01), 0.);
  o.cp = g.vp * vec4f(p, 1.); o.wp = p;
  o.uv = vec2f(u01, v01); o.fold = wav;
  return o;
}
@fragment fn fs(i: FO2) -> @location(0) vec4f {
  var alb = mix(vec3f(0.48, 0.055, 0.075), vec3f(0.33, 0.03, 0.05), i.uv.y);
  alb *= 0.8 + 0.4 * sin(i.fold * 9.0);
  let bord = ss(0.045, 0.0, min(min(i.uv.x, 1.0 - i.uv.x), min(i.uv.y, 1.0 - i.uv.y)));
  let em = length((i.uv - vec2f(0.42, 0.5)) * vec2f(1., 1.4));
  alb = mix(alb, vec3f(0.85, 0.66, 0.22), sat(bord + ss(0.16, 0.12, em) * ss(0.10, 0.13, em)));
  let n = normalize(vec3f(0., 0.5 + i.fold * 3.0, 1.0));
  let E = sunc() * shadow1(i.wp + vec3f(0., 0.2, 0.));
  var c = alb * (E * sat(dot(n, g.sun.xyz)) * 0.9 + vec3f(0.44, 0.5, 0.58) * 0.7);
  return fin(fogLand(c, i.wp));
}
`;

// ---------------------------------------------------------------- volumetric light shafts (half res; own bindings, layout 'auto')
const W_RAYS = W_NOISE + S_G + W_FS + /*wgsl*/`
@group(0) @binding(0) var<uniform> g: G;
@group(0) @binding(1) var sR: sampler;
@group(0) @binding(2) var sS: sampler_comparison;
@group(0) @binding(3) var tSh: texture_depth_2d;
@group(0) @binding(4) var tT: texture_2d<f32>;
@group(0) @binding(5) var tDp: texture_depth${AA > 1 ? '_multisampled' : ''}_2d;
${S_H};
@fragment fn fs(@builtin(position) fc: vec4f) -> @location(0) vec4f {
  let dp = textureLoad(tDp, vec2i(fc.xy) * 2, 0);
  let uv = fc.xy * 2.0 * g.res.zw;
  let nd = vec2f(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0);
  let rv = g.fwd.xyz + g.right.xyz * (nd.x * g.right.w) + g.up.xyz * (nd.y * g.up.w);
  let rl = length(rv);
  let rd = rv / rl;
  let zl = g.fwd.w / max(dp, 1e-6);
  var tm = min(zl * rl, 320.0);
  if (rd.y > 1e-4) { tm = min(tm, (900.0 - g.cam.y) / rd.y); }
  let ro = g.cam.xyz;
  let sx = g.sun.xyz;
  let dt = tm / ${RAYN}.;
  let j = ign(fc.xy);
  var acc = vec3f(0.);
  for (var n = 0; n < ${RAYN}; n++) {
    let tt = (f32(n) + j) * dt;
    let p = ro + rd * tt;
    let s = g.sm * vec4f(p, 1.);
    let vis = textureSampleCompareLevel(tSh, sS, vec2f(s.x * .5 + .5, .5 - s.y * .5), s.z - .0006);
    let pat = ss(0.35, 0.75, textureSampleLevel(tT, sR, p.xz * 0.011 + vec2f(0., g.cam.w * 0.004), 2.0).r)
            * ss(0.2, 0.6, textureSampleLevel(tT, sR, p.yz * 0.017 + 3.1, 2.0).g);
    let mist = exp(-abs(p.y - 128.0) * 0.05);
    acc += vis * (0.006 + pat * 2.6) * (1.0 + 1.7 * mist);
  }
  let mu = max(dot(rd, sx), 0.);
  let ph = 0.22 + 1.9 * mu * mu * mu;
  return vec4f(min(acc * dt * sunc() * ph * g.sun.w * (0.9 + 0.5 * exp(-abs(g.cam.y - 128.0) * 0.02)), vec3f(16.)), zl);
}
`;
const W_RBLUR = W_FS + /*wgsl*/`
@group(0) @binding(0) var tR: texture_2d<f32>;
@fragment fn fs(@builtin(position) fc: vec4f) -> @location(0) vec4f {
  let p = vec2i(fc.xy); let mx = vec2i(textureDimensions(tR)) - 1;
  let c = textureLoad(tR, p, 0);
  var acc = vec3f(0.); var ws = 0.;
  for (var y = -1; y <= 1; y++) { for (var x = -1; x <= 1; x++) {
    let r = textureLoad(tR, clamp(p + vec2i(x, y), vec2i(0), mx), 0);
    let w = 1. / (.03 + abs(r.a - c.a) / c.a);
    acc += r.rgb * w; ws += w;
  } }
  return vec4f(acc / ws, c.a);
}
`;

// ---------------------------------------------------------------- blit / mip / bloom
const W_BLIT = W_FS + /*wgsl*/`
@group(0) @binding(0) var t: texture_2d<f32>;
@group(0) @binding(1) var s: sampler;
fn uvOf(fc: vec4f, k: f32) -> vec2f { return fc.xy * k / vec2f(textureDimensions(t)); }
@fragment fn fsMip(@builtin(position) fc: vec4f) -> @location(0) vec4f { return textureSampleLevel(t, s, uvOf(fc, 2.), 0.); }
fn kar(c: vec3f) -> vec4f { let w = 1. / (1. + max(c.r, max(c.g, c.b))); return vec4f(c * w, w); }
@fragment fn fsDown0(@builtin(position) fc: vec4f) -> @location(0) vec4f {
  let uv = uvOf(fc, 2.); let e = 1. / vec2f(textureDimensions(t));
  let a = kar(min(textureSampleLevel(t, s, uv + e * vec2f(-1., -1.), 0.).rgb, vec3f(24.)));
  let b = kar(min(textureSampleLevel(t, s, uv + e * vec2f(1., -1.), 0.).rgb, vec3f(24.)));
  let c = kar(min(textureSampleLevel(t, s, uv + e * vec2f(-1., 1.), 0.).rgb, vec3f(24.)));
  let d = kar(min(textureSampleLevel(t, s, uv + e * vec2f(1., 1.), 0.).rgb, vec3f(24.)));
  let m = a + b + c + d;
  return vec4f(m.rgb / m.a, 1.);
}
@fragment fn fsDown(@builtin(position) fc: vec4f) -> @location(0) vec4f {
  let uv = uvOf(fc, 2.); let e = 1. / vec2f(textureDimensions(t));
  return (textureSampleLevel(t, s, uv + e * vec2f(-1., -1.), 0.) + textureSampleLevel(t, s, uv + e * vec2f(1., -1.), 0.)
        + textureSampleLevel(t, s, uv + e * vec2f(-1., 1.), 0.) + textureSampleLevel(t, s, uv + e * vec2f(1., 1.), 0.)) * .25;
}
@fragment fn fsUp(@builtin(position) fc: vec4f) -> @location(0) vec4f {
  let uv = uvOf(fc, .5); let e = .75 / vec2f(textureDimensions(t));
  return (textureSampleLevel(t, s, uv + e * vec2f(-1., -1.), 0.) + textureSampleLevel(t, s, uv + e * vec2f(1., -1.), 0.)
        + textureSampleLevel(t, s, uv + e * vec2f(-1., 1.), 0.) + textureSampleLevel(t, s, uv + e * vec2f(1., 1.), 0.)) * .25;
}
`;

// ---------------------------------------------------------------- final composite (own bindings, layout 'auto')
const W_POST = W_NOISE + S_G + W_FS + /*wgsl*/`
@group(0) @binding(0) var<uniform> g: G;
@group(0) @binding(1) var sC: sampler;
${S_H};
@group(0) @binding(2) var tS: texture_2d<f32>;
@group(0) @binding(3) var tR: texture_2d<f32>;
@group(0) @binding(4) var tB: texture_2d<f32>;
@group(0) @binding(5) var tDp: texture_depth${AA > 1 ? '_multisampled' : ''}_2d;
fn tmap(x: vec3f) -> vec3f { return sat3((x * (2.51 * x + .03)) / (x * (2.43 * x + .59) + .14)); }
@fragment fn fs(@builtin(position) fc: vec4f) -> @location(0) vec4f {
  let px = vec2i(fc.xy);
  let uv = fc.xy * g.res.zw;
  let zf = g.fwd.w / max(textureLoad(tDp, px, 0), 1e-6);
  // depth-aware upsample of the half-res shafts
  let h = fc.xy * .5 - .5; let b = floor(h); let f = h - b; let bi = vec2i(b);
  let mx = vec2i(textureDimensions(tR)) - 1;
  var acc = vec3f(0.); var ws = 0.;
  for (var k = 0; k < 4; k++) {
    let o = vec2i(i32(k & 1u), i32(k >> 1u));
    let r = textureLoad(tR, clamp(bi + o, vec2i(0), mx), 0);
    let bw = mix(1. - f.x, f.x, f32(o.x)) * mix(1. - f.y, f.y, f32(o.y));
    let w = (bw + .02) / (.02 + abs(r.a - zf) / zf);
    acc += r.rgb * w; ws += w;
  }
  var c = textureLoad(tS, px, 0).rgb + acc / ws;
  let bl = textureSampleLevel(tB, sC, uv, 0.).rgb;
  c = mix(c, bl, .05) + bl * .035;
  c *= g.mis.x;
  let q = uv - .5;
  c *= 1. - dot(q, q) * .5;
  c = tmap(c);
  let l0 = dot(c, vec3f(.2126, .7152, .0722));
  let l = mix(l0, l0 * l0 * (3. - 2. * l0), .5);
  c *= l / max(l0, 1e-4);
  c = mix(vec3f(l), c, .94);
  c = pow(max(c, vec3f(0.)), vec3f(1. / 2.2));
  let n = ign(fc.xy) + ign(fc.xy + 37.) - 1.;
  return vec4f(c + n / 255., 1.);
}
`;

// ---------------------------------------------------------------- bakes
// tileable hash helpers for the baked textures
const W_TNOISE = W_NOISE + /*wgsl*/`
fn ihw(ix: i32, iz: i32, s: i32, per: i32) -> f32 {
  var mx = ix % per; mx = select(mx + per, mx, mx >= 0);
  var mz = iz % per; mz = select(mz + per, mz, mz >= 0);
  return ih(mx, mz, s);
}
fn vnw(x: f32, z: f32, s: i32, per: i32) -> f32 {
  let px = floor(x); let pz = floor(z);
  let fx = x - px; let fz = z - pz;
  let ux = fx * fx * (3. - 2. * fx);
  let uz = fz * fz * (3. - 2. * fz);
  let a = ihw(i32(px), i32(pz), s, per); let b = ihw(i32(px) + 1, i32(pz), s, per);
  let c = ihw(i32(px), i32(pz) + 1, s, per); let d = ihw(i32(px) + 1, i32(pz) + 1, s, per);
  let ab = a + (b - a) * ux;
  return ab + (c + (d - c) * ux - ab) * uz;
}
fn fbmw(x: f32, z: f32, s: i32, oct: i32, per: i32) -> f32 {
  var a = .5; var sum = 0.; var px = x; var pz = z; var pr = f32(per);
  for (var i = 0; i < oct; i++) {
    sum += a * vnw(px, pz, s + i * 101, i32(pr));
    px = px * 2.0 + 11.3; pz = pz * 2.0 + 7.9;
    pr = pr * 2.0; a *= .5;
  }
  return sum;
}
fn worw(p: vec2f, s: i32, per: i32) -> f32 {
  let i = floor(p); let f = fract(p); var d = 9.;
  for (var x = -1; x <= 1; x++) { for (var y = -1; y <= 1; y++) {
    let o = vec2f(f32(x), f32(y));
    let cx = i32(i.x) + x; let cz = i32(i.y) + y;
    var mx = cx % per; mx = select(mx + per, mx, mx >= 0);
    var mz = cz % per; mz = select(mz + per, mz, mz >= 0);
    let hh = vec2f(ih(mx, mz, s), ih(mx, mz, s + 977));
    let r = o + hh - f;
    d = min(d, dot(r, r));
  } }
  return sqrt(d);
}
`;

// ground detail texture: rg = slope, b = height pattern, a = mottle (period 3)
const W_DETAILB = W_TNOISE + W_FS + /*wgsl*/`
fn H(uv: vec2f) -> f32 {
  let wq = uv + .11 * (vec2f(fbmw(uv.x, uv.y, 5, 4, 3), fbmw(uv.y + .5, uv.x, 7, 4, 3)) - .5);
  let f = fbmw(wq.x, wq.y, 11, 8, 3);
  let r1 = 1. - abs(fbmw(wq.x + 1.7, wq.y, 13, 6, 3) * 2. - 1.);
  let cr = min(abs(fbmw(wq.x + 4.1, wq.y + 2., 17, 5, 3) * 2. - 1.) * 7., 1.);
  let cr2 = min(abs(fbmw(wq.y + 2.3, wq.x, 19, 4, 3) * 2. - 1.) * 9., 1.);
  let pq = wq * 29.;
  let pt = worw(pq, 23, 87);
  let cx = i32(floor(pq.x)) % 87; let cxx = select(cx + 87, cx, cx >= 0);
  let cz = i32(floor(pq.y)) % 87; let czz = select(cz + 87, cz, cz >= 0);
  let pit = (1. - ss(.0, .34, pt)) * step(.62, ih(cxx, czz, 23));
  return f * .50 + r1 * r1 * .24 + cr * cr2 * .26 - pit * .07;
}
@fragment fn fs(@builtin(position) fc: vec4f) -> @location(0) vec4f {
  let uv = fc.xy / ${DETT}.; let e = 1. / ${DETT}.;
  let h = H(uv);
  let gx = H(uv + vec2f(e, 0.)) - H(uv - vec2f(e, 0.));
  let gy = H(uv + vec2f(0., e)) - H(uv - vec2f(0., e));
  let s = clamp(vec2f(gx, gy) * ${DETT}. * .5 * .075, vec2f(-1.), vec2f(1.));
  return vec4f(-s * .5 + .5, h, fbmw(uv.x + 3.7, uv.y, 29, 5, 3));
}
`;

// foliage texture: broadleaf cluster (top half), conifer sprigs (bottom half)
const W_LEAFB = W_NOISE + W_FS + /*wgsl*/`
fn rot2(p: vec2f, a: f32) -> vec2f { let c = cos(a); let s = sin(a); return vec2f(c * p.x - s * p.y, s * p.x + c * p.y); }
fn leafSdf(p: vec2f, c: vec2f, a: f32, sz: f32) -> f32 {
  let q = rot2(p - c, a) / sz;
  let el = length(q * vec2f(1.55, 1.0)) - 0.5;
  let tip = length(q - vec2f(0.72, 0.)) - 0.16;
  let stem = length(vec2f(max(abs(q.y) - 0.02, 0.), max(-q.x, 0.) * 0.6)) - 0.02;
  return min(min(el, tip * 0.8), stem);
}
@fragment fn fs(@builtin(position) fc: vec4f) -> @location(0) vec4f {
  let uv = fc.xy / ${LEAFT}.;
  var col = vec3f(0.); var alpha = 0.;
  if (uv.y < 0.5) {
    let p = (uv - vec2f(0.5, 0.25)) * 2.0;
    for (var k = 0; k < 64; k++) {
      let fk = f32(k);
      let ang = fk * 2.39996;
      let rad = 0.16 * sqrt(fk / 64.) + 0.04 * fract(sin(fk * 91.7) * 43758.5);
      let c = vec2f(cos(ang), sin(ang)) * rad;
      let la = ang + 1.2 + fract(sin(fk * 17.3) * 43758.5) * 1.2;
      let sz = 0.10 + 0.06 * fract(sin(fk * 7.1) * 43758.5);
      let d = leafSdf(p, c, la, sz);
      let a = ss(0.012, 0.0, d);
      let vein = ss(0.02, 0.0, abs(rot2(p - c, la).y)) * a;
      let gr = fract(sin(fk * 3.3) * 43758.5);
      var lc = mix(vec3f(0.13, 0.21, 0.05), vec3f(0.22, 0.30, 0.08), gr);
      lc = mix(lc, vec3f(0.35, 0.24, 0.05), step(0.86, fract(gr * 5.7)) * 0.8);
      lc *= 0.75 + 0.5 * rad * 3.0;
      lc = mix(lc, lc * 0.55, vein);
      let na = max(a, alpha);
      col = mix(col, lc, sat(a - alpha * a * 0.55));
      alpha = na;
    }
    let st = length(vec2f(max(abs(p.x) - 0.5, 0.), abs(p.y) * 2.2)) ;
    alpha *= ss(0.6, 0.55, st + 0.0);
  } else {
    let p = (uv - vec2f(0.5, 0.75)) * 2.0;
    let stemd = ss(0.016, 0.0, length(vec2f(p.x, max(abs(p.y) - 0.45, 0.) * 0.5)));
    col = vec3f(0.10, 0.145, 0.05); alpha = stemd;
    for (var k = 0; k < 44; k++) {
      let fk = f32(k);
      let side = select(-1., 1., fract(fk * 0.5) < 0.5);
      let yy = -0.44 + fk / 44. * 0.9;
      let tip = vec2f(p.x - side * (0.03 + abs(yy) * 0.2), p.y - yy * 0.42);
      let dir = normalize(vec2f(side, yy * 0.4 + 0.12));
      let prj = dot(tip, dir);
      let d = length(tip - dir * clamp(prj, 0., 0.14)) - 0.011;
      let a = ss(0.008, 0.0, d) * step(0., prj) * step(prj, 0.14);
      col = mix(col, vec3f(0.085, 0.135, 0.055) * (0.8 + 0.4 * fract(sin(fk * 13.1) * 43758.5)), sat(a * (1.0 - alpha)));
      alpha = max(alpha, a);
    }
  }
  return vec4f(col, alpha);
}
`;

// cloud tile: r = base field, g = detail, b = cirrus streaks (period 8)
const W_CLOUDB = W_TNOISE + W_FS + /*wgsl*/`
@fragment fn fs(@builtin(position) fc: vec4f) -> @location(0) vec4f {
  let uv = fc.xy / 512. * 8.0;
  let b = fbmw(uv.x, uv.y, 3, 5, 8);
  let d = fbmw(uv.x * 2.0 + 7., uv.y * 2.0, 9, 3, 16);
  let ci = fbmw(uv.x * 2.0 + 3., uv.y * 2.0 + 5., 13, 4, 16);
  return vec4f(b, d, ci * 0.7 + b * 0.3, 1.);
}
`;

// effect tile: r,g = fbm pair, b = worley, a = ridge (period 8)
const W_TILEB = W_TNOISE + W_FS + /*wgsl*/`
@fragment fn fs(@builtin(position) fc: vec4f) -> @location(0) vec4f {
  let uv = fc.xy / 256. * 8.0;
  let r = fbmw(uv.x, uv.y, 21, 5, 8);
  let g = fbmw(uv.x + 4.2, uv.y + 1.3, 33, 4, 8);
  let b = worw(uv * 2.0, 45, 16);
  let a = 1. - abs(fbmw(uv.x + 9.1, uv.y + 5.5, 41, 4, 8) * 2. - 1.);
  return vec4f(r, g, b, a);
}
`;
