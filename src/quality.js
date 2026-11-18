// ============================================================================
// quality level, chosen before anything is built
// ============================================================================
// LV: 0 High, 1 Medium, 2 Low. Higher levels keep more foliage instances, sharper shadows,
// more volumetric ray steps and 4x MSAA; Low drops AA and thins every field.
// localStorage.tabaristan = "level,pixels,detail". tabaristanLoad still set on the next
// visit means the last load crashed the tab, so this one runs a level lower.
const mob = matchMedia('(pointer:coarse)').matches, mem = navigator.deviceMemory || 4;
const keep = (k, v) => { try { localStorage[k] = v; } catch {} };
let SV = [], LV, bad;
try { SV = (localStorage.tabaristan || '').split(','); bad = localStorage.tabaristanLoad; } catch {}
LV = SV[0] ? +SV[0] : mob ? (mem > 7 ? 1 : 2) : mem <= 4 ? 2 : 0;
if (bad && LV < 2) { SV = [++LV]; keep('tabaristan', LV); }
const THIN = 1 << LV;                 // keep every THIN-th blade / sapling (fields are thinned at pack time)
const SHADOW = LV ? 2048 : 4096;      // shadow map size
const AA = LV > 1 ? 1 : 4;            // MSAA sample count
const RAYN = LV > 1 ? 12 : LV ? 20 : 30;   // volumetric light-shaft steps
const CLOUDHI = LV > 1;               // fewer cloud samples on Low
const LEAFT = LV > 1 ? 256 : 512;     // baked foliage-texture size
const DETT = LV > 1 ? 512 : 1024;     // baked ground-detail-texture size
const PIXMAX = 2560 * 1440, PIXMIN = mob ? 230000 : 480000;
const DETMIN = 0.4;
