// ============================================================================
// renderer, camera, input, audio, menu
// ============================================================================
const $ = (id) => document.getElementById(id);
const canvas = $('c'), info = $('i'), body = document.body;
const rot = matchMedia('(orientation:portrait) and (pointer:coarse)');
// loading bar glides to `to` while this thread is busy building the world
let loaded = 0, dead;
const say = (m, to, ms) => {
  if (!dead) $('s').textContent = m;
  const a = $('b').animate({ transform: [`scaleX(${loaded})`, `scaleX(${to})`] }, { duration: ms, fill: 'forwards', easing: 'cubic-bezier(.3,.5,.5,1)' });
  loaded = to;
  return new Promise((r) => { a.ready.then(() => setTimeout(r)); setTimeout(r, document.hidden ? 0 : 1e3); });
};
const fail = (m) => { $('e').textContent = m; $('e').style.display = 'block'; throw new Error(m); };
if (!navigator.gpu) fail('This world needs WebGPU. Please open it in a current Chrome, Edge or other WebGPU browser.');
const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
if (!adapter) fail('No WebGPU adapter found.');
const hasTS = adapter.features.has('timestamp-query');
const device = await adapter.requestDevice({ requiredFeatures: hasTS ? ['timestamp-query'] : [] });
let booted = false;
const showErr = (m) => { if (!booted && !dead) { $('e').textContent = m; $('e').style.display = 'block'; } };
device.addEventListener('uncapturederror', (e) => { console.error('GPU: ' + e.error.message); showErr('GPU error: ' + e.error.message.split('\n')[0]); });
addEventListener('unhandledrejection', (ev) => { const r = ev.reason; console.error(r); showErr('Error: ' + (r && r.message || r)); });
device.lost.then((l) => {
  if (l.reason === 'destroyed') return;
  if (LV < 2) { keep('tabaristan', LV + 1); location.reload(); }
  dead = true; body.className = 'l'; $('s').textContent = 'The graphics device was lost. Reload to try again.';
});
const ctx = canvas.getContext('webgpu'), FMT = navigator.gpu.getPreferredCanvasFormat();
const Q = device.queue, HDR = 'rgba16float', DEPTH = 'depth32float';
const TU = GPUTextureUsage, BU = GPUBufferUsage, SS = GPUShaderStage;
const mod = (code) => device.createShaderModule({ code });
const buf = (data, usage) => { const b = device.createBuffer({ size: (data.byteLength + 3) & ~3, usage: usage | BU.COPY_DST }); Q.writeBuffer(b, 0, data.buffer || data, data.byteOffset || 0, data.byteLength); return b; };
const tex = (w, h, format, usage, o = {}) => device.createTexture({ size: [w, h, o.d || 1], format, usage, mipLevelCount: o.mips || 1, sampleCount: o.samples || 1, dimension: o.d ? '3d' : '2d' });
const MIP = (n) => Math.round(Math.log2(n)) + 1; // full mip chain for a power-of-two size

// ---------------------------------------------------------------- static resources
const sRep = device.createSampler({ addressModeU: 'repeat', addressModeV: 'repeat', magFilter: 'linear', minFilter: 'linear', mipmapFilter: 'linear', maxAnisotropy: LV > 1 ? 1 : 8 });
const sClamp = device.createSampler({ magFilter: 'linear', minFilter: 'linear' });
const sCmp = device.createSampler({ compare: 'less-equal', magFilter: 'linear', minFilter: 'linear' });
const tShadow = tex(SHADOW, SHADOW, DEPTH, TU.RENDER_ATTACHMENT | TU.TEXTURE_BINDING);
const tDummy = tex(1, 1, DEPTH, TU.RENDER_ATTACHMENT | TU.TEXTURE_BINDING);
const tDetail = tex(DETT, DETT, 'rgba8unorm', TU.RENDER_ATTACHMENT | TU.TEXTURE_BINDING, { mips: MIP(DETT) });
const tLeaf = tex(LEAFT, LEAFT, 'rgba8unorm', TU.RENDER_ATTACHMENT | TU.TEXTURE_BINDING, { mips: MIP(LEAFT) });
const tCloud = tex(512, 512, 'rgba8unorm', TU.RENDER_ATTACHMENT | TU.TEXTURE_BINDING, { mips: MIP(512) });
const tTile = tex(256, 256, 'rgba8unorm', TU.RENDER_ATTACHMENT | TU.TEXTURE_BINDING, { mips: MIP(256) });
const tGM = tex(384, 384, 'rgba8unorm', TU.TEXTURE_BINDING | TU.COPY_DST);

const UB = new Float32Array(60), UBS = new Float32Array(60);
const ubo = device.createBuffer({ size: 240, usage: BU.UNIFORM | BU.COPY_DST }), uboS = device.createBuffer({ size: 240, usage: BU.UNIFORM | BU.COPY_DST });

const VF = SS.VERTEX | SS.FRAGMENT;
const bgl0 = device.createBindGroupLayout({ entries: [
  { binding: 0, visibility: VF, buffer: {} },
  { binding: 1, visibility: VF, sampler: {} }, { binding: 2, visibility: VF, sampler: {} }, { binding: 3, visibility: VF, sampler: { type: 'comparison' } },
  { binding: 4, visibility: VF, texture: { sampleType: 'depth' } },
  { binding: 5, visibility: VF, texture: {} }, { binding: 6, visibility: VF, texture: {} },
  { binding: 7, visibility: VF, texture: {} }, { binding: 8, visibility: VF, texture: {} }, { binding: 9, visibility: VF, texture: {} }] });
const mkBG0 = (u, sh) => device.createBindGroup({ layout: bgl0, entries: [
  { binding: 0, resource: { buffer: u } }, { binding: 1, resource: sRep }, { binding: 2, resource: sClamp }, { binding: 3, resource: sCmp },
  { binding: 4, resource: sh.createView() }, { binding: 5, resource: tDetail.createView() }, { binding: 6, resource: tLeaf.createView() },
  { binding: 7, resource: tTile.createView() }, { binding: 8, resource: tGM.createView() }, { binding: 9, resource: tCloud.createView() }] });
const bg0 = mkBG0(ubo, tShadow), bg0s = mkBG0(uboS, tDummy);
const pl0 = device.createPipelineLayout({ bindGroupLayouts: [bgl0] });

const bglBlit = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: SS.FRAGMENT, texture: {} }, { binding: 1, visibility: SS.FRAGMENT, sampler: {} }] });
const plBlit = device.createPipelineLayout({ bindGroupLayouts: [bglBlit] });
const blitPipe = (entry, format, add) => device.createRenderPipeline({ layout: plBlit, vertex: { module: mBlit, entryPoint: 'vs' },
  fragment: { module: mBlit, entryPoint: entry, targets: [{ format, blend: add ? { color: { srcFactor: 'one', dstFactor: 'one' }, alpha: { srcFactor: 'one', dstFactor: 'one' } } : undefined }] } });
const blitBG = (view) => device.createBindGroup({ layout: bglBlit, entries: [{ binding: 0, resource: view }, { binding: 1, resource: sClamp }] });
const colorAtt = (view, clear) => ({ view, loadOp: clear ? 'clear' : 'load', storeOp: 'store', clearValue: [0, 0, 0, 0] });

// vertex layouts
const A = (shaderLocation, offset, format) => ({ shaderLocation, offset, format });
const vbT = { arrayStride: 16, attributes: [A(0, 0, 'float32x3'), A(1, 12, 'snorm8x4')] };
const vbS = { arrayStride: 16, attributes: [A(0, 0, 'float32x3'), A(1, 12, 'snorm8x4')] };
const vbTr = { arrayStride: 20, attributes: [A(0, 0, 'float32x3'), A(1, 12, 'unorm8x4'), A(2, 16, 'snorm8x4')] };
const vbF = { arrayStride: 12, attributes: [A(0, 0, 'float32x3')] };
const vbW = { arrayStride: 20, attributes: [A(0, 0, 'float32x3'), A(1, 12, 'float32x2')] };
const ibI3 = { arrayStride: 48, stepMode: 'instance', attributes: [A(3, 0, 'float32x4'), A(4, 16, 'float32x4'), A(5, 32, 'float32x4')] };  // tree instances (locs 3-5)
const ibI2 = { arrayStride: 48, stepMode: 'instance', attributes: [A(2, 0, 'float32x4'), A(3, 16, 'float32x4'), A(4, 32, 'float32x4')] }; // solid instances (locs 2-4)
const ibG = { arrayStride: 40, stepMode: 'instance', attributes: [A(0, 0, 'float32x4'), A(1, 16, 'float32x4'), A(2, 32, 'uint32x2')] };
const ibFl = { arrayStride: 32, stepMode: 'instance', attributes: [A(0, 0, 'float32x4'), A(1, 16, 'float32x4')] };
const ibBd = { arrayStride: 32, stepMode: 'instance', attributes: [A(2, 0, 'float32x4'), A(3, 16, 'float32x4')] };
const ibS16 = { arrayStride: 16, stepMode: 'instance', attributes: [A(0, 0, 'float32x4')] };
const ibS24 = { arrayStride: 24, stepMode: 'instance', attributes: [A(0, 0, 'float32x4'), A(1, 16, 'float32x2')] };

const scenePipe = (m, vsE, fsE, buffers, o = {}) => device.createRenderPipeline({ layout: pl0,
  vertex: { module: m, entryPoint: vsE, buffers, constants: o.constants },
  fragment: { module: m, entryPoint: fsE, targets: [{ format: HDR, blend: o.blend }] },
  primitive: { topology: o.strip ? 'triangle-strip' : 'triangle-list', cullMode: o.cull || 'none' },
  depthStencil: { format: DEPTH, depthWriteEnabled: o.blend ? false : true, depthCompare: 'greater' },
  multisample: { count: AA, alphaToCoverage: !!o.atoc } });
const shadowPipe = (m, vsE, buffers, fsE) => device.createRenderPipeline({ layout: pl0,
  vertex: { module: m, entryPoint: vsE, buffers },
  fragment: fsE ? { module: m, entryPoint: fsE, targets: [] } : undefined,
  primitive: { topology: 'triangle-list', cullMode: 'none' },
  depthStencil: { format: DEPTH, depthWriteEnabled: true, depthCompare: 'less', depthBias: 3, depthBiasSlopeScale: 2.0 } });

await say('Compiling shaders…', 0.04, 500);
const mBlit = mod(W_BLIT), mRays = mod(W_RAYS), mPost = mod(W_POST);
const mTerr = mod(W_TERR), mFar = mod(W_FAR), mSol = mod(W_SOL), mTree = mod(W_TREE), mTreeSh = mod(W_TREESH);
const mGrass = mod(W_GRASS), mWater = mod(W_WATER), mFall = mod(W_FALL), mSky = mod(W_SKY);
const mSpr = mod(W_SPR), mBird = mod(W_BIRD), mFlag = mod(W_FLAG);
const mRB = mod(W_RBLUR);
const pSky = device.createRenderPipeline({ layout: pl0, vertex: { module: mSky, entryPoint: 'vs' },
  fragment: { module: mSky, entryPoint: 'fs', targets: [{ format: HDR, blend: { color: { srcFactor: 'one', dstFactor: 'zero' }, alpha: { srcFactor: 'one', dstFactor: 'zero' } } }] },
  primitive: { topology: 'triangle-list' }, depthStencil: { format: DEPTH, depthWriteEnabled: false, depthCompare: 'always' }, multisample: { count: AA } });
const pFar = scenePipe(mFar, 'vs', 'fs', [vbF], { cull: 'back' });
const pTerr = scenePipe(mTerr, 'vs', 'fs', [vbT], { cull: 'back' });
const pSol = scenePipe(mSol, 'vs', 'fs', [vbS, ibI2]);
const pTree = scenePipe(mTree, 'vs', 'fs', [vbTr, ibI3], { atoc: AA > 1 });
const pGrass = scenePipe(mGrass, 'vs', 'fs', [ibG], { strip: true, constants: { ROWS: 4 } });
const ADD = { color: { srcFactor: 'one', dstFactor: 'one' }, alpha: { srcFactor: 'one', dstFactor: 'one' } };
const ALPH = { color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha' }, alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' } };
const pWater = scenePipe(mWater, 'vs', 'fs', [vbW], { blend: ALPH });
const pFall = scenePipe(mFall, 'vs', 'fs', [vbW], { blend: ALPH });
const pFlag = scenePipe(mFlag, 'vs', 'fs', [ibFl]);
const pBird = scenePipe(mBird, 'vs', 'fs', [vbS, ibBd]);
const pMote = scenePipe(mSpr, 'vsMote', 'fsMote', [ibS16], { strip: true, blend: ADD });
const pLeafS = scenePipe(mSpr, 'vsLeaf', 'fsLeaf', [ibS24], { strip: true, blend: ADD });
const pMist = scenePipe(mSpr, 'vsMist', 'fsMist', [ibS24], { strip: true, blend: ADD });
const pTerrSh = shadowPipe(mTerr, 'vssh', [vbT]);
const pSolSh = shadowPipe(mSol, 'vssh', [vbS, ibI2]);
const pTreeSh = shadowPipe(mTreeSh, 'vssh', [vbTr, ibI3], 'fssh');
const pRB = device.createRenderPipeline({ layout: 'auto', vertex: { module: mRB, entryPoint: 'vs' }, fragment: { module: mRB, entryPoint: 'fs', targets: [{ format: HDR }] } });
const pRays = device.createRenderPipeline({ layout: 'auto', vertex: { module: mRays, entryPoint: 'vs' }, fragment: { module: mRays, entryPoint: 'fs', targets: [{ format: HDR }] } });
const pPost = device.createRenderPipeline({ layout: 'auto', vertex: { module: mPost, entryPoint: 'vs' }, fragment: { module: mPost, entryPoint: 'fs', targets: [{ format: FMT }] } });
const pMip8 = blitPipe('fsMip', 'rgba8unorm'), pDown0 = blitPipe('fsDown0', HDR), pDown = blitPipe('fsDown', HDR), pUp = blitPipe('fsUp', HDR, true);

// ---------------------------------------------------------------- world generation + upload
await say('Sculpting the mountains…', 0.15, 1500);
keep('tabaristanLoad', 1);
addEventListener('pagehide', () => keep('tabaristanLoad', ''));
buildHeights();
await say('Growing the Hyrcanian forest…', 0.42, 1800);
const W = makeWorld();

// solid meshes packed into one vertex + index buffer:
// 0-3 boulders, 4-7 far LOD boulders, 8 monolith, 9 grotto shell, 10 fortress
const rockNear = [buildRock(3, 2, false), buildRock(5, 2, false), buildRock(7, 2, false), buildRock(9, 2, false)];
const rockFar = [buildRock(3, 1, true), buildRock(5, 1, true), buildRock(7, 1, true), buildRock(9, 1, true)];
const monolithMesh = buildRock(11, 2, false);
const grottoMesh = buildGrotto().build();
const fortressMesh = buildFortress().build();
const SOLIDS = [...rockNear.map((m) => m.build()), ...rockFar.map((m) => m.build()), monolithMesh.build(), grottoMesh, fortressMesh];
let nV = 0, nI = 0;
const SR = [];
for (const m of SOLIDS) { SR.push({ v0: nV, i0: nI, ic: m.ib.length }); nV += m.nv; nI += m.ib.length; }
const allV = new Uint8Array(nV * 16), allI = new Uint32Array(nI);
for (let i = 0; i < SOLIDS.length; i++) { allV.set(new Uint8Array(SOLIDS[i].vb), SR[i].v0 * 16); allI.set(SOLIDS[i].ib, SR[i].i0); }
const vbMesh = buf(allV, BU.VERTEX), ibMesh = buf(allI, BU.INDEX);

const treeMeshes = [buildTree(0), buildTree(1), buildTree(2)];
const treeBufs = treeMeshes.map((m) => ({ vb: buf(m.vb, BU.VERTEX), ib: buf(m.ib, BU.INDEX), ic: m.ib.length }));
const treePacks = W.trees.map((p) => buf(p.data, BU.VERTEX));
const grassPack = buf(W.grass.data, BU.VERTEX);
const rockPacks = W.rocks.map((p) => buf(p.data, BU.VERTEX));
const ibBird = buf(W.birds, BU.VERTEX), ibFlag = buf(W.flags, BU.VERTEX);
const ibMote = buf(W.motes, BU.VERTEX), ibLeafS = buf(W.leaves, BU.VERTEX), ibMist = buf(W.mist, BU.VERTEX);
const waterVbuf = buf(W.waterV, BU.VERTEX), waterIbuf = buf(W.waterI, BU.INDEX);
const fallVbuf = buf(W.fallV, BU.VERTEX), fallIbuf = buf(W.fallI, BU.INDEX);
const nBird = W.birds.length / 8, nMote = W.motes.length / 4, nLeafS = W.leaves.length / 6, nMist = W.mist.length / 6;
const birdMesh = buildBird();
const vbBird = buf(birdMesh.vb, BU.VERTEX), ibBirdI = buf(birdMesh.ib, BU.INDEX);
Q.writeTexture({ texture: tGM }, W.gm, { bytesPerRow: 384 * 4 }, [384, 384]);

// terrain mesh (heights grid already built; chunks share one index buffer)
const terrain = buildTerrainMesh();
const vbTbuf = buf(terrain.vb, BU.VERTEX), ibTbuf = buf(terrain.ib, BU.INDEX);
const far = buildFarMesh();
const vbFar = buf(far.vb, BU.VERTEX), ibFar = buf(far.ib, BU.INDEX);

// always-drawn solid instances: fortress, grotto, monoliths
const alwaysI = new Float32Array(12 * (2 + W.monoliths.length / 12));
alwaysI.set([0, 0, 0, 1, 0, 0, 0, 1, 0.31, 0, 0, 0], 0);            // fortress (seed tones the stone)
alwaysI.set([0, 0, 0, 1, 0, 0, 0, 1, 0.62, 0, 0, 0], 12);           // grotto
alwaysI.set(W.monoliths, 24);
const ibAlways = buf(alwaysI, BU.VERTEX);
await say('Baking textures…', 0.6, 1500);

// ---------------------------------------------------------------- one-time bakes (detail, leaf, cloud, tile)
{
  const bakePipe = (m) => device.createRenderPipeline({ layout: 'auto', vertex: { module: m, entryPoint: 'vs' }, fragment: { module: m, entryPoint: 'fs', targets: [{ format: 'rgba8unorm' }] } });
  const e = device.createCommandEncoder();
  const bake = (m, t, mips) => {
    const p = bakePipe(m);
    let r = e.beginRenderPass({ colorAttachments: [colorAtt(t.createView({ baseMipLevel: 0, mipLevelCount: 1 }), true)] });
    r.setPipeline(p); r.draw(3); r.end();
    for (let i = 1; i < mips; i++) {
      r = e.beginRenderPass({ colorAttachments: [colorAtt(t.createView({ baseMipLevel: i, mipLevelCount: 1 }), true)] });
      r.setPipeline(pMip8); r.setBindGroup(0, blitBG(t.createView({ baseMipLevel: i - 1, mipLevelCount: 1 }))); r.draw(3); r.end();
    }
  };
  bake(mod(W_DETAILB), tDetail, MIP(DETT));
  bake(mod(W_LEAFB), tLeaf, MIP(LEAFT));
  bake(mod(W_CLOUDB), tCloud, MIP(512));
  bake(mod(W_TILEB), tTile, MIP(256));
  Q.submit([e.finish()]);
}

// ---------------------------------------------------------------- sun + shadow matrix (recomputed per frame)
const TANH = 0.62, NEAR = 0.1, EXPO = 1.05;
let SUN = [0, 0, 0], RAYSTR = 0.5;
function sunFor(t) { // slow golden-hour drift: elevation and azimuth breathe over minutes
  const el = 0.205 + 0.045 * Math.sin(t * 0.008), az = -2.05 + 0.10 * Math.sin(t * 0.0053 + 1.7);
  const ce = Math.cos(el);
  SUN = [ce * Math.sin(az), Math.sin(el), ce * Math.cos(az)];
  RAYSTR = 0.52 + 0.22 * Math.max(0, Math.sin(t * 0.008 + 0.6));
}
function shadowMatrix(m) { // orthographic along the sun, snapped to texels to avoid shimmer
  const L = SUN, lr = [L[1], -L[0], 0], ll = Math.hypot(lr[0], lr[1]) || 1; lr[0] /= ll; lr[1] /= ll;
  const lu = [L[1] * lr[2] - L[2] * lr[1], L[2] * lr[0] - L[0] * lr[2], L[0] * lr[1] - L[1] * lr[0]];
  const R = 190, d0 = -300, d1 = 170, S = SHADOW, cell = 2 * R / S;
  const cx = Math.round(F[0] / cell) * cell, cz = Math.round(F[2] / cell) * cell, cy = Math.round(F[1] / cell) * cell;
  m[0] = lr[0] / R; m[4] = lr[1] / R; m[8] = lr[2] / R; m[12] = -(lr[0] * cx + lr[1] * cy + lr[2] * cz) / R;
  m[1] = lu[0] / R; m[5] = lu[1] / R; m[9] = lu[2] / R; m[13] = -(lu[0] * cx + lu[1] * cy + lu[2] * cz) / R;
  m[2] = -L[0] / (d1 - d0); m[6] = -L[1] / (d1 - d0); m[10] = -L[2] / (d1 - d0); m[14] = d1 / (d1 - d0) + (L[0] * cx + L[1] * cy + L[2] * cz) / (d1 - d0);
  m[3] = 0; m[7] = 0; m[11] = 0; m[15] = 1;
}

// ---------------------------------------------------------------- render targets (rebuilt on resize)
let W2 = 0, H2 = 0, DW = 0, DH = 0, pix = +SV[1] || (LV > 1 ? 410000 : mob ? 1280 * 720 : PIXMAX), det = +SV[2] || 1;
let dynN = 0, dynT = 0, dynBad = 0, dynOk = 0, dynWait = 3;
let passScene, passRays, passBlur, passPost, bgRays, bgPost, bgBlur, bloomPass = [], bloomBG = [], targets = [];
const NB = 6;
function resize() {
  DW = Math.max(2, Math.round(canvas.clientWidth * devicePixelRatio)); DH = Math.max(2, Math.round(canvas.clientHeight * devicePixelRatio));
  const s = Math.min(1, Math.sqrt(pix / (DW * DH)));
  const w = Math.max(2, Math.round(DW * s) & ~1), h = Math.max(2, Math.round(DH * s) & ~1);
  if (w === W2 && h === H2) return;
  dynN = dynT = 0; dynT = -400;
  W2 = w; H2 = h; canvas.width = W2; canvas.height = H2;
  ctx.configure({ device, format: FMT, alphaMode: 'opaque' });
  for (const t of targets) t.destroy();
  const tMS = tex(AA > 1 ? W2 : 1, H2, HDR, TU.RENDER_ATTACHMENT, { samples: AA }), tDp = tex(W2, H2, DEPTH, TU.RENDER_ATTACHMENT | TU.TEXTURE_BINDING, { samples: AA });
  const tRes = tex(W2, H2, HDR, TU.RENDER_ATTACHMENT | TU.TEXTURE_BINDING), tRay = tex(W2 >> 1, H2 >> 1, HDR, TU.RENDER_ATTACHMENT | TU.TEXTURE_BINDING), tRay2 = tex(W2 >> 1, H2 >> 1, HDR, TU.RENDER_ATTACHMENT | TU.TEXTURE_BINDING);
  targets = [tMS, tDp, tRes, tRay, tRay2];
  const bl = [];
  for (let i = 0; i < NB; i++) { const t = tex(Math.max(1, W2 >> (i + 1)), Math.max(1, H2 >> (i + 1)), HDR, TU.RENDER_ATTACHMENT | TU.TEXTURE_BINDING); bl.push(t); targets.push(t); }
  const vMS = tMS.createView(), vDp = tDp.createView(), vRes = tRes.createView(), vRay = tRay.createView(), vRay2 = tRay2.createView(), vBl = bl.map((t) => t.createView());
  passScene = { colorAttachments: [{ view: AA > 1 ? vMS : vRes, resolveTarget: AA > 1 ? vRes : undefined, loadOp: 'clear', storeOp: AA > 1 ? 'discard' : 'store', clearValue: [0, 0, 0, 1] }],
    depthStencilAttachment: { view: vDp, depthClearValue: 0, depthLoadOp: 'clear', depthStoreOp: 'store' } };
  passRays = { colorAttachments: [colorAtt(vRay, true)] };
  passBlur = { colorAttachments: [colorAtt(vRay2, true)] };
  bgBlur = device.createBindGroup({ layout: pRB.getBindGroupLayout(0), entries: [{ binding: 0, resource: vRay }] });
  bgRays = device.createBindGroup({ layout: pRays.getBindGroupLayout(0), entries: [
    { binding: 0, resource: { buffer: ubo } }, { binding: 1, resource: sRep }, { binding: 2, resource: sCmp },
    { binding: 3, resource: tShadow.createView() }, { binding: 4, resource: tTile.createView() }, { binding: 5, resource: vDp }] });
  passPost = { colorAttachments: [{ view: null, loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 1] }] };
  bgPost = device.createBindGroup({ layout: pPost.getBindGroupLayout(0), entries: [
    { binding: 0, resource: { buffer: ubo } }, { binding: 1, resource: sClamp }, { binding: 2, resource: vRes },
    { binding: 3, resource: vRay2 }, { binding: 4, resource: vBl[0] }, { binding: 5, resource: vDp }] });
  bloomPass = []; bloomBG = [];
  for (let i = 0; i < NB; i++) { bloomPass.push({ colorAttachments: [colorAtt(vBl[i], true)] }); bloomBG.push(blitBG(i ? vBl[i - 1] : vRes)); }
  for (let i = NB - 1; i > 0; i--) { bloomPass.push({ colorAttachments: [colorAtt(vBl[i - 1], false)] }); bloomBG.push(blitBG(vBl[i])); }
  UB[52] = W2; UB[53] = H2; UB[54] = 1 / W2; UB[55] = 1 / H2;
}
resize();
addEventListener('resize', resize);

// ---------------------------------------------------------------- GPU timing (for adaptive resolution)
let qs, qResolve, qRead = [], tsBegin, tsEnd;
if (hasTS) {
  qs = device.createQuerySet({ type: 'timestamp', count: 2 });
  qResolve = device.createBuffer({ size: 16, usage: BU.QUERY_RESOLVE | BU.COPY_SRC });
  for (let i = 0; i < 6; i++) {
    const b = device.createBuffer({ size: 16, usage: BU.MAP_READ | BU.COPY_DST });
    const o = { b, busy: false, done: null };
    o.done = () => { const a = new BigInt64Array(b.getMappedRange()); F[19] = Number(a[1] - a[0]) / 1e6; b.unmap(); o.busy = false; if (dynT > 0 && F[19] > 0 && F[19] < 1e3) { dynG += F[19]; dynGN++; } };
    qRead.push(o);
  }
  tsBegin = { querySet: qs, beginningOfPassWriteIndex: 0 }; tsEnd = { querySet: qs, endOfPassWriteIndex: 1 };
}

// ---------------------------------------------------------------- frame state
const F = new Float64Array(32); // 0 cx, 1 cy, 2 cz, 3 yaw, 4 pitch, 5..7 fwd, 8/9 rx rz, 10..12 up, 13..15 vel, 16 time, 17 autoT, 18 last, 19 gpu
let dynG = 0, dynGN = 0;
const CX = 0, CY = 1, CZ = 2, YAW = 3, PIT = 4, TIME = 16;
const aim = (x, y, z, tx, ty, tz) => {
  const dx = tx - x, dy = ty - y, dz = tz - z;
  F[CX] = x; F[CY] = y; F[CZ] = z;
  F[YAW] = Math.atan2(dx, -dz); F[PIT] = Math.atan2(dy, Math.hypot(dx, dz));
};
// fortress + grotto collision: simple cylinders and a wall ring
const COLL = [];
for (let i = 0; i < 10; i++) { if (i === 5) continue; const a = i / 10 * TAU; COLL.push([FCP[0] + Math.cos(a) * 44, FCP[1] + Math.sin(a) * 44, 6.0, 358]); }
COLL.push([256, 468, 11.5, 356], [205, 470, 7.5, 356], [FCP[0] + 10, FCP[1] - 2, 10.5, 356]);
function collide() {
  for (const [x, z, r, top] of COLL) {
    const dx = F[CX] - x, dz = F[CZ] - z, d = Math.hypot(dx, dz);
    if (d < r && F[CY] < top) { F[CX] = x + dx / d * r; F[CZ] = z + dz / d * r; }
  }
  const wd = Math.hypot(F[CX] - FCP[0], F[CZ] - FCP[1]);
  if (Math.abs(wd - 44.6) < 2.6 && F[CY] > 341 && F[CY] < 353.5) {
    const push = wd > 44.6 ? 47.3 : 41.9, k = push / (wd || 1);
    F[CX] = FCP[0] + (F[CX] - FCP[0]) * k; F[CZ] = FCP[1] + (F[CZ] - FCP[1]) * k;
  }
  // the grotto shell: outside the rock, inside the cavity, or in the mouth corridor
  {
    const gx = F[CX] - XRG, gy = F[CY] - 121.5, gz = F[CZ] - 300;
    const gd = Math.hypot(gx, gy, gz);
    if (gd < 13.6 && gd > 11.0) {
      const D = [XR300 - XRG, -3.2, 296 - 300]; const dl = Math.hypot(D[0], D[1], D[2]);
      const mouth = (gx * D[0] + gy * D[1] + gz * D[2]) / dl;
      if (mouth < 2.0) { // away from the opening: keep off the shell
        const outside = mouth < -0.5;
        const k = (outside ? 13.6 : 11.0) / gd;
        F[CX] = XRG + gx * k; F[CY] = 121.5 + gy * k; F[CZ] = 300 + gz * k;
      }
    }
  }
}
let queueBusy = false; // never queue a new frame while the GPU is still chewing the last one (floods the queue on slow GPUs)
function frame(now) {
  requestAnimationFrame(frame);
  const dtr = now - F[18]; F[18] = now;
  let dt = dtr / 1000; if (dt > 0.1) dt = 0.1;
  // adaptive resolution for 60 fps: scale pixels first, then draw distance
  if (dtr < 1e3 && (dynT += dtr) > 0 && (dynN++, dynT > (menu ? 500 : 1000))) {
    const a = dynT / dynN, g = dynGN ? dynG / dynGN : 0; let k = 1;
    if (g) { if (g > 13.6 || g < 9.8) k = 11.7 / g; }
    else if (a > 17.6) { dynOk = 0; if (++dynBad > 1) { k = 15 / a; dynBad = 0; dynWait = Math.min(dynWait * 2, 60); } }
    else { dynBad = 0; if (a < 12.5) k = 15 / a; else if (++dynOk > dynWait) { k = 1.17; dynOk = 0; } }
    k = k < 0.5 ? 0.5 : k > 1.7 ? 1.7 : k;
    const top = Math.min(PIXMAX, DW * DH), mid = Math.max(top / 2, PIXMIN), was = pix + det;
    if (k < 1 ? pix > mid || det <= DETMIN : pix < mid || det >= 1) {
      const end = k < 1 ? (det > DETMIN ? mid : PIXMIN) : det < 1 ? mid : top;
      pix *= k; if (k < 1 ? pix < end : pix > end) pix = end;
    } else { det *= Math.sqrt(k); det = det < DETMIN ? DETMIN : det > 1 ? 1 : det; }
    if (was !== pix + det) keep('tabaristan', [LV, pix < top ? pix | 0 : '', det]);
    dynN = dynT = dynG = dynGN = 0; resize();
  }
  F[TIME] += dt;
  {
    // touch look + move
    if (tId >= 0) {
      const tr = 4 / Math.min(innerWidth, innerHeight);
      let jx = clamp((tx - tx0) * tr, -1, 1), jy = clamp((ty - ty0) * tr, -1, 1);
      lkx += jx * 1.6 * dt; lky += jy * dt;
    }
    if (tId2 >= 0) { mvf = clamp((ty2 - ty20) / -90, -1, 1); mvs = clamp((tx2 - tx20) / 90, -1, 1); }
    const kq = 1 - Math.exp(-dt * 30);
    lkx += mdx * 0.0022; lky += mdy * 0.0022; mdx = 0; mdy = 0;
    const ax = lkx * kq, ay = lky * kq; lkx -= ax; lky -= ay; l2x += ax; l2y += ay;
    const dyw = l2x * kq, dpt = l2y * kq; l2x -= dyw; l2y -= dpt;
    const yaw = F[YAW] + dyw; let pitch = F[PIT] - dpt; pitch = clamp(pitch, -1.55, 1.55);
    const sp = ks ? 26 : 9, k = 1 - Math.exp(-dt * 4.5);
    const mf = (kf - kb) + mvf * 0.9, mr = (kr - kl) + mvs * 0.9;
    const cp = Math.cos(pitch), sy = Math.sin(yaw), cw = Math.cos(yaw);
    const vx = F[13] + ((sy * cp * mf + cw * mr) * sp - F[13]) * k;
    const vy = F[14] + ((Math.sin(pitch) * mf + (ku - kd)) * sp - F[14]) * k;
    const vz = F[15] + ((-cw * cp * mf + sy * mr) * sp - F[15]) * k;
    let x = F[CX] + vx * dt, y = F[CY] + vy * dt, z = F[CZ] + vz * dt;
    const rad = Math.hypot(x, z); if (rad > 660) { x *= 660 / rad; z *= 660 / rad; }
    // ground / water follow: walking sticks to the terrain, flying has a soft floor
    const floor = Math.max(gy(x, z) + 1.7, (waterAt(x, z) ?? -1e9) + 0.55);
    if (y < floor) y = floor;
    y = Math.min(y, 860);
    F[YAW] = yaw; F[PIT] = pitch; F[13] = vx; F[14] = vy; F[15] = vz;
    F[CX] = x; F[CY] = y; F[CZ] = z;
    collide();
    if (menu && !userMoved) F[YAW] += dt * 0.016; // gentle drift behind the menu
  }
  if (!queueBusy) { queueBusy = true; render(); Q.onSubmittedWorkDone().then(() => { queueBusy = false; }); }
  if (hud) {
    hN++; if (F[20] === undefined) F[20] = 0;
    F[20] += dtr / 1000;
    if (F[20] > 0.5) { info.textContent = `${(hN / F[20]).toFixed(0)} fps · worst ${hMax.toFixed(1)} ms · GPU ${F[19] ? F[19].toFixed(2) : '—'} ms · ${W2}x${H2} (${W2 * 100 / DW | 0}%)`; F[20] = 0; hN = 0; hMax = 0; }
  }
  if (dtr > hMax) hMax = dtr;
}

// ---------------------------------------------------------------- culling + render
const CELLS2 = CELLS * CELLS;
const rowOrd = new Uint8Array(CELLS);
function drawCells(r, pk, cb, minD, maxD, det2) {
  const cx = F[CX], cy = F[CY], cz = F[CZ], fx = F[5], fy = F[6], fz = F[7], rx = F[8], rz = F[9], ux = F[10], uy = F[11], uz = F[12];
  const ds = det2 * det2;
  const tx = TANH * W2 / H2, hw = CELLW * 0.5, ex = hw + 4;
  const min2 = minD * minD * ds, max2 = maxD * maxD * ds;
  for (let k = 0; k < CELLS; k++) {
    const rw = rowOrd[k], row = rw * CELLS, pz = OX + (rw + 0.5) * CELLW - cz, hz = Math.max(Math.abs(pz) - hw, 0);
    let run = -1;
    for (let x = 0; x <= CELLS; x++) {
      const c = row + x; let v = false;
      if (x < CELLS) {
        const l = pk.lo[c], h = pk.hi[c];
        if (l <= h) {
          const px = OX + (x + 0.5) * CELLW - cx, py = (l + h) * 0.5 - cy, ey = (h - l) * 0.5 + 4, hx = Math.max(Math.abs(px) - hw, 0), h2 = hx * hx + hz * hz;
          if (h2 < max2 && h2 >= min2) {
            const lim = px * fx + py * fy + pz * fz + ex * Math.abs(fx) + ey * Math.abs(fy) + ex * Math.abs(fz);
            if (lim >= 0 && Math.abs(px * rx + pz * rz) - ex * (Math.abs(rx) + Math.abs(rz)) <= lim * tx) v = Math.abs(px * ux + py * uy + pz * uz) - ex * (Math.abs(ux) + Math.abs(uz)) - ey * Math.abs(uy) <= lim * TANH;
          }
        }
      }
      if (v) { if (run < 0) run = c; } else if (run >= 0) {
        const a = pk.start[run], n = pk.start[c] - a;
        if (n > 0) cb(a, n);
        run = -1;
      }
    }
  }
}
function chunkVis(x, z, hw, lo, hi, maxD) {
  const cx = F[CX], cy = F[CY], cz = F[CZ], fx = F[5], fy = F[6], fz = F[7], rx = F[8], rz = F[9], ux = F[10], uy = F[11], uz = F[12];
  const tx = TANH * W2 / H2;
  const px = x - cx, pz = z - cz, py = (lo + hi) * 0.5 - cy, ey = (hi - lo) * 0.5 + hw;
  const ex = hw + 2;
  const lim = px * fx + py * fy + pz * fz + ex * Math.abs(fx) + ey * Math.abs(fy) + ex * Math.abs(fz);
  if (lim < 0) return false;
  if (px * px + pz * pz > maxD * maxD) return false;
  if (Math.abs(px * rx + pz * rz) - ex * (Math.abs(rx) + Math.abs(rz)) > lim * tx) return false;
  return Math.abs(px * ux + py * uy + pz * uz) - ex * (Math.abs(ux) + Math.abs(uz)) - ey * Math.abs(uy) <= lim * TANH;
}
let hud = false, hN = 0, hMax = 0;
const submitList = [null];
let slot = null;
function render() {
  // camera basis (yaw uses the atan2(dx, -dz) convention)
  const cx = F[CX], cy = F[CY], cz = F[CZ], pitch = F[PIT], yaw = F[YAW];
  const cp = Math.cos(pitch), fy = Math.sin(pitch), rx = Math.cos(yaw), rz = Math.sin(yaw), fx = cp * rz, fz = -cp * rx;
  const ux = -rz * fy, uy = rz * fx - rx * fz, uz = rx * fy;
  F[5] = fx; F[6] = fy; F[7] = fz; F[8] = rx; F[9] = rz; F[10] = ux; F[11] = uy; F[12] = uz;
  const asp = W2 / H2, sx = 1 / (TANH * asp), sy = 1 / TANH, m = UB;
  m[0] = rx * sx; m[4] = 0; m[8] = rz * sx; m[12] = -(rx * cx + rz * cz) * sx;
  m[1] = ux * sy; m[5] = uy * sy; m[9] = uz * sy; m[13] = -(ux * cx + uy * cy + uz * cz) * sy;
  m[2] = 0; m[6] = 0; m[10] = 0; m[14] = NEAR;
  m[3] = fx; m[7] = fy; m[11] = fz; m[15] = -(fx * cx + fy * cy + fz * cz);
  m[32] = cx; m[33] = cy; m[34] = cz; m[35] = F[TIME];
  m[36] = rx; m[37] = 0; m[38] = rz; m[39] = TANH * asp;
  m[40] = ux; m[41] = uy; m[42] = uz; m[43] = TANH;
  m[44] = fx; m[45] = fy; m[46] = fz; m[47] = NEAR;
  m[48] = SUN[0]; m[49] = SUN[1]; m[50] = SUN[2]; m[51] = RAYSTR;
  m[56] = EXPO; m[57] = det; m[58] = 1.0; m[59] = 1.0;
  sunFor(F[TIME]);
  shadowMatrix(UBS);
  Q.writeBuffer(ubo, 0, UB); Q.writeBuffer(uboS, 0, UBS);
  { const cr = clamp(((cz - OX) / CELLW) | 0, 0, CELLS - 1); let n = 0; rowOrd[n++] = cr;
    for (let d = 1; d < CELLS; d++) { if (cr - d >= 0) rowOrd[n++] = cr - d; if (cr + d < CELLS) rowOrd[n++] = cr + d; } }
  const e = device.createCommandEncoder();
  slot = null;
  if (hasTS) { for (let i = 0; i < qRead.length; i++) if (!qRead[i].busy) { slot = qRead[i]; break; } }
  passScene.timestampWrites = slot ? tsBegin : undefined;
  passPost.timestampWrites = slot ? tsEnd : undefined;
  // ---- shadow pass
  {
    const r = e.beginRenderPass({ colorAttachments: [], depthStencilAttachment: { view: tShadow.createView(), depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'store' } });
    r.setBindGroup(0, bg0s);
    r.setPipeline(pTerrSh); r.setVertexBuffer(0, vbTbuf); r.setIndexBuffer(ibTbuf, 'uint32');
    for (const c of terrain.chunks) if (chunkVis(c.x, c.z, c.hw, c.lo, c.hi, 260)) r.drawIndexed(c.ic, 1, c.i0);
    r.setPipeline(pSolSh); r.setVertexBuffer(0, vbMesh); r.setVertexBuffer(1, ibAlways); r.setIndexBuffer(ibMesh, 'uint32');
    r.drawIndexed(SR[9].ic, 1, SR[9].i0, SR[9].v0, 1);   // grotto
    r.drawIndexed(SR[10].ic, 1, SR[10].i0, SR[10].v0, 0); // fortress
    r.drawIndexed(SR[8].ic, W.monoliths.length / 12, SR[8].i0, SR[8].v0, 2); // monoliths
    for (let v = 0; v < 4; v++) { r.setVertexBuffer(1, rockPacks[v]);
      drawCells(r, W.rocks[v], (a, n) => r.drawIndexed(SR[v].ic, n, SR[v].i0, SR[v].v0, a), 0, 150, 1); }
    r.setPipeline(pTreeSh);
    for (let s = 0; s < 3; s++) {
      r.setVertexBuffer(0, treeBufs[s].vb); r.setVertexBuffer(1, treePacks[s]); r.setIndexBuffer(treeBufs[s].ib, 'uint32');
      drawCells(r, W.trees[s], (a, n) => r.drawIndexed(treeBufs[s].ic, n, 0, 0, a), 0, 140, 1);
    }
    r.end();
  }
  // ---- main scene pass
  let r = e.beginRenderPass(passScene);
  r.setBindGroup(0, bg0);
  r.setPipeline(pSky); r.draw(3);
  r.setPipeline(pFar); r.setVertexBuffer(0, vbFar); r.setIndexBuffer(ibFar, 'uint32'); r.drawIndexed(far.ib.length, 1);
  r.setPipeline(pTerr); r.setVertexBuffer(0, vbTbuf); r.setIndexBuffer(ibTbuf, 'uint32');
  for (const c of terrain.chunks) if (chunkVis(c.x, c.z, c.hw, c.lo, c.hi, 780)) r.drawIndexed(c.ic, 1, c.i0);
  r.setPipeline(pSol); r.setVertexBuffer(0, vbMesh); r.setVertexBuffer(1, ibAlways); r.setIndexBuffer(ibMesh, 'uint32');
  r.drawIndexed(SR[10].ic, 1, SR[10].i0, SR[10].v0, 0);
  r.drawIndexed(SR[9].ic, 1, SR[9].i0, SR[9].v0, 1);
  r.drawIndexed(SR[8].ic, W.monoliths.length / 12, SR[8].i0, SR[8].v0, 2);
  for (let v = 0; v < 4; v++) { r.setVertexBuffer(1, rockPacks[v]);
    drawCells(r, W.rocks[v], (a, n) => r.drawIndexed(SR[v].ic, n, SR[v].i0, SR[v].v0, a), 0, 250, det); }
  for (let v = 0; v < 4; v++) drawCells(r, W.rocks[v], (a, n) => r.drawIndexed(SR[4 + v].ic, n, SR[4 + v].i0, SR[4 + v].v0, a), 250, 520, det);
  for (let s = 0; s < 3; s++) {
    r.setPipeline(pTree); r.setVertexBuffer(0, treeBufs[s].vb); r.setVertexBuffer(1, treePacks[s]); r.setIndexBuffer(treeBufs[s].ib, 'uint32');
    drawCells(r, W.trees[s], (a, n) => r.drawIndexed(treeBufs[s].ic, n, 0, 0, a), 0, 520, det);
  }
  r.setPipeline(pGrass); r.setVertexBuffer(0, grassPack);
  drawCells(r, W.grass, (a, n) => r.draw(8, n, 0, a), 0, 135, det);
  r.setPipeline(pFlag); r.setVertexBuffer(0, ibFlag); r.draw(72, W.flags.length / 8);
  r.setPipeline(pBird); r.setVertexBuffer(0, vbBird); r.setVertexBuffer(1, ibBird); r.setIndexBuffer(ibBirdI, 'uint32'); r.drawIndexed(birdMesh.ib.length, nBird);
  if (Math.abs(cx - xrFn(cz)) < 340) {
    const fallIbufN = W.fallI.length;
  r.setPipeline(pFall); r.setVertexBuffer(0, fallVbuf); r.setIndexBuffer(fallIbuf, 'uint32'); r.drawIndexed(fallIbufN, 1);
    r.setPipeline(pWater); r.setVertexBuffer(0, waterVbuf); r.setIndexBuffer(waterIbuf, 'uint32');
    for (const rg of W.waterRanges) r.drawIndexed(rg.ic, 1, rg.i0);
  }
  r.setPipeline(pMote); r.setVertexBuffer(0, ibMote); r.draw(4, nMote);
  r.setPipeline(pLeafS); r.setVertexBuffer(0, ibLeafS); r.draw(4, nLeafS);
  r.setPipeline(pMist); r.setVertexBuffer(0, ibMist); r.draw(4, nMist);
  r.end();
  // ---- light shafts + blur + bloom + composite
  r = e.beginRenderPass(passRays); r.setPipeline(pRays); r.setBindGroup(0, bgRays); r.draw(3); r.end();
  r = e.beginRenderPass(passBlur); r.setPipeline(pRB); r.setBindGroup(0, bgBlur); r.draw(3); r.end();
  for (let i = 0; i < bloomPass.length; i++) {
    r = e.beginRenderPass(bloomPass[i]); r.setPipeline(i === 0 ? pDown0 : i < NB ? pDown : pUp); r.setBindGroup(0, bloomBG[i]); r.draw(3); r.end();
  }
  passPost.colorAttachments[0].view = ctx.getCurrentTexture().createView();
  r = e.beginRenderPass(passPost); r.setPipeline(pPost); r.setBindGroup(0, bgPost); r.draw(3); r.end();
  if (slot) { e.resolveQuerySet(qs, 0, 2, qResolve, 0); e.copyBufferToBuffer(qResolve, 0, slot.b, 0, 16); }
  submitList[0] = e.finish();
  Q.submit(submitList);
  if (slot) { slot.busy = true; slot.b.mapAsync(GPUMapMode.READ).then(slot.done, () => { slot.busy = false; }); }
}

// ---------------------------------------------------------------- input
let kf = 0, kb = 0, kl = 0, kr = 0, ku = 0, kd = 0, ks = 0, mdx = 0, mdy = 0, lkx = 0, lky = 0, l2x = 0, l2y = 0;
let tId = -1, tId2 = -1, tx0 = 0, ty0 = 0, tx = 0, ty = 0, tx20 = 0, ty20 = 0, tx2 = 0, ty2 = 0, tN = 0;
let mvf = 0, mvs = 0, menu = true, userMoved = false;
const release = () => { kf = kb = kl = kr = ku = kd = ks = 0; tId = tId2 = -1; tN = 0; mvf = mvs = 0; };
const capture = () => { sound(); const p = canvas.requestPointerLock({ unadjustedMovement: true }); if (p && p.catch) p.catch(() => canvas.requestPointerLock()).catch(() => 0); };
canvas.addEventListener('click', () => { userMoved = true; if (!menu) capture(); });
addEventListener('mousemove', (e) => { if (document.pointerLockElement === canvas) { mdx += e.movementX; mdy += e.movementY; userMoved = true; } });
addEventListener('blur', release);
const key = (e, v) => {
  switch (e.code) {
    case 'KeyW': kf = v; break; case 'KeyS': kb = v; break; case 'KeyA': kl = v; break; case 'KeyD': kr = v; break;
    case 'KeyE': ku = v; break; case 'KeyQ': kd = v; break; case 'ShiftLeft': case 'ShiftRight': ks = v; break;
    default: if (v && !e.repeat) {
      if (e.code === 'KeyH') { hud = !hud; info.textContent = hud ? ' ' : ''; }
      else if (e.code === 'KeyM') mute();
      else if (e.code === 'Escape') ui(true);
      else if (e.code >= 'Digit1' && e.code <= 'Digit6') { const p = POSES[+e.code.slice(5) - 1]; aim(p[0], p[1], p[2], p[3], p[4], p[5]); userMoved = true; }
    }
  }
  if (v && kf | kb | kl | kr | ku | kd) userMoved = true;
};
addEventListener('keydown', (e) => { if (menu && e.code !== 'KeyH' && e.code !== 'KeyM') return; sound(); key(e, 1); });
addEventListener('keyup', (e) => key(e, 0));
const touch = (e) => {
  e.preventDefault(); sound(); userMoved = true; tN = e.touches.length;
  let f = null, f2 = null;
  for (let i = 0; i < tN; i++) {
    if (e.touches[i].identifier === tId) f = e.touches[i];
    else if (e.touches[i].identifier === tId2) f2 = e.touches[i];
  }
  if (!f && tN) { f = e.touches[0]; tId = f.identifier; tx0 = tx = rot.matches ? f.clientY : f.clientX; ty0 = ty = rot.matches ? -f.clientX : f.clientY; }
  if (!f2 && tN > 1) { for (const t of e.touches) if (t.identifier !== tId) { f2 = t; tId2 = t.identifier; tx20 = tx2 = rot.matches ? t.clientY : t.clientX; ty20 = ty2 = rot.matches ? -t.clientX : t.clientY; break; } }
  if (tN < 2) { tId2 = -1; mvf = mvs = 0; }
  const s = 1100 / Math.min(innerWidth, innerHeight);
  if (f) {
    const x = rot.matches ? f.clientY : f.clientX, y = rot.matches ? -f.clientX : f.clientY;
    if (Math.abs(x - tx) + Math.abs(y - ty) > 0) { mdx += (x - tx) * s; mdy += (y - ty) * s; }
    tx = x; ty = y;
  }
  if (f2) { tx2 = rot.matches ? f2.clientY : f2.clientX; ty2 = rot.matches ? -f2.clientX : f2.clientY; }
};
for (const n of ['touchstart', 'touchmove', 'touchend', 'touchcancel']) canvas.addEventListener(n, touch, { passive: false });

// ---------------------------------------------------------------- audio: wind, water, birdsong (all synthesized)
let AC, OUT, muted = false, wfRiver, wfWindG, wfLeaf;
const VOL = 0.62;
function mkSound(ac) {
  const sr = ac.sampleRate;
  const N = (C, o, ...to) => { const n = new C(ac, o); for (const d of to) n.connect(d); if (n.start) n.start(); return n; };
  const G = (gain, ...to) => N(GainNode, { gain }, ...to);
  const BQ = (type, frequency, Q, ...to) => N(BiquadFilterNode, { type, frequency, Q }, ...to);
  const lfo = (frequency, depth, to) => N(OscillatorNode, { frequency }, G(depth, to));
  const noise = (secs, f) => { const n = sr * secs | 0, b = new AudioBuffer({ length: n, numberOfChannels: 2, sampleRate: sr }); f(b.getChannelData(0), n); f(b.getChannelData(1), n); return b; };
  const nb = noise(9, (d, n) => { for (let i = 0, b = 0; i < n + 4096; i++) { b = (b + 0.02 * (rnd() * 2 - 1)) / 1.02; if (i < n) d[i] = b * 3.5; else { const k = (i - n) / 4096; d[i - n] = d[i - n] * k + b * 3.5 * (1 - k); } } });
  const ir = noise(3.4, (d, n) => { for (let i = 0, b = 0; i < n; i++) { const t = i / sr; b += (rnd() * 2 - 1 - b) * (0.05 + 0.4 * Math.exp(-t * 2.4)); d[i] = b * (1 - Math.exp(-t * 40)) * Math.exp(-t * 1.9) * (1 - i / n); } });
  const lim = N(DynamicsCompressorNode, { threshold: -8, knee: 8, ratio: 12, attack: 0.004, release: 0.3 }, ac.destination);
  const out = OUT = G(0, lim), wet = N(ConvolverNode, { buffer: ir }, out);
  const src = (rate, ...to) => N(AudioBufferSourceNode, { buffer: nb, loop: true, playbackRate: rate }, ...to);
  // wind through the valley: low rush + whistle band, gusting
  const wind = G(0.16, out); wfWindG = wind.gain;
  src(1, BQ('lowpass', 380, 0.6, wind));
  const whistle = G(0.0, out); src(1.13, BQ('bandpass', 900, 3.2, whistle));
  lfo(0.061, 0.06, wind.gain); lfo(0.093, 0.045, wind.gain);
  // leaves rustling: bright noise, gated by gusts and forest proximity
  const rustle = G(0.0, out); wfLeaf = rustle.gain;
  src(1.35, BQ('highpass', 2400, 0.7, rustle));
  // river: bandpassed rush, louder near water; waterfall adds a lower roar
  const river = G(0.0, out); wfRiver = river.gain;
  src(0.86, BQ('bandpass', 620, 0.5, river));
  const fallR = G(0.0, out); src(0.5, BQ('lowpass', 300, 0.5, fallR));
  wfRiver.fallR = fallR.gain;
  // pooled voices: songbirds, a crow, a distant eagle
  const pool = (n, send) => Array.from({ length: n }, () => { const p = N(StereoPannerNode, {}, out, G(send, wet)); const g = G(0, p); return { p, g, o: N(OscillatorNode, { type: 'sine' }, g) }; });
  const chirp = pool(4, 0.5), crow = pool(1, 0.4), eagle = pool(1, 0.9);
  const play = (vs, t, f0, f1, dur, vol, att) => {
    const v = vs.shift(), f = v.o.frequency, g = v.g.gain; vs.push(v);
    v.p.pan.setValueAtTime(rr(-0.8, 0.8), t);
    f.setValueAtTime(f0, t); f.exponentialRampToValueAtTime(Math.max(f1, 1), t + dur);
    g.setValueAtTime(0, t); g.linearRampToValueAtTime(vol, t + att); g.setTargetAtTime(0, t + att, (dur - att) / 4);
  };
  let lt = ac.currentTime, tB = lt + 2, tC = lt + 7, tE = lt + 40;
  out.gain.setTargetAtTime(VOL, lt, 1.2);
  const nearForest = () => forestDens(F[CX], F[CZ], gy(F[CX], F[CZ])) || 0;
  return () => {
    const now = ac.currentTime, t = now + 0.05;
    if (t <= lt) return;
    lt = now;
    const wy = waterAt(F[CX], F[CZ]);
    const dw = wy !== null ? 0 : Math.max(0, Math.abs(F[CX] - xrFn(F[CZ])) - 16);
    const near = Math.max(0, 1 - dw / 130);
    const pool = Math.max(0, 1 - Math.hypot(F[CX] - XR300, F[CZ] - 296) / 90);
    wfRiver.setTargetAtTime(0.5 * near * near, t, 0.4);
    wfRiver.fallR.setTargetAtTime(0.5 * pool * pool, t, 0.4);
    const gust = 0.45 + 0.55 * clamp(0.55 + 0.8 * Math.sin(now * 0.29 + F[CX] * 0.008) * Math.sin(now * 0.17 + F[CZ] * 0.011), 0, 1);
    wfWindG.setTargetAtTime(0.10 + 0.14 * gust, t, 0.5);
    wfLeaf.setTargetAtTime(0.05 * gust * nearForest(), t, 0.4);
    if (t > tB) { // a phrase of 3-7 songbird notes
      let tt = t; const base = rr(2100, 3800), notes = 3 + rnd() * 4 | 0;
      for (let n = 0; n < notes; n++) { const f = base * rr(0.85, 1.25); play(chirp, tt, f, f * rr(0.7, 1.6), rr(0.04, 0.14), rr(0.02, 0.05), 0.008); tt += rr(0.07, 0.2); }
      tB = tt + rr(1.5, 7);
    }
    if (t > tC) { play(crow, t, 520, 380, 0.4, 0.05, 0.03); tC = t + rr(25, 90); }
    if (t > tE) { play(eagle, t, 1400, 620, 1.6, 0.06, 0.25); tE = t + rr(60, 160); }
  };
}
function sound() {
  if (!AC) { AC = new AudioContext({ latencyHint: 'playback' }); setInterval(mkSound(AC), 100); }
  if (AC.state === 'suspended' && !document.hidden) AC.resume();
}
const mute = () => { muted = !muted; if (AC) OUT.gain.setTargetAtTime(muted ? 0 : VOL, AC.currentTime, 0.08); };
document.addEventListener('visibilitychange', () => { if (AC) document.hidden ? AC.suspend() : AC.resume(); });

// ---------------------------------------------------------------- menu
const bGo = $('d');
const ui = (m2) => {
  if (dead) return;
  menu = m2; body.className = m2 ? 'm' : document.pointerLockElement ? 'g p' : 'g';
  if (m2) { release(); setTimeout(() => menu && bGo.focus(), 100); } else if (document.activeElement) document.activeElement.blur();
};
const go = () => {
  sound(); ui(false); bGo.textContent = 'R E S U M E'; userMoved = true;
  if (mob) document.documentElement.requestFullscreen?.()?.then(() => screen.orientation.lock('landscape')).catch(() => 0);
  else capture();
};
bGo.onclick = go; $('o').onclick = () => ui(true);
$('q').querySelectorAll('button').forEach((b, i) => { if (i === 2 - LV) b.className = 'on'; else b.onclick = () => { keep('tabaristan', 2 - i); location.reload(); }; });
document.addEventListener('pointerlockchange', () => ui(!document.pointerLockElement));

// ---------------------------------------------------------------- boot
aim(POSES[0][0], POSES[0][1], POSES[0][2], POSES[0][3], POSES[0][4], POSES[0][5]);
sunFor(120);
await say('Raising the citadel…', 0.82, 900);
resize();
await say('Letting in the light…', 1, 600);
render();
await Q.onSubmittedWorkDone();
setTimeout(() => keep('tabaristanLoad', ''), 15e3);
booted = true;
$('w').classList.add('off');
ui(true);
requestAnimationFrame((t) => { F[18] = t; requestAnimationFrame(frame); });
