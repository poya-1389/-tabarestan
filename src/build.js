// Build download/index.html: inline quality + math + world + world2 + shaders + shaders2 + main into the template.
import fs from 'fs';

const T = '/home/z/my-project/scripts/tab/';
const parts = ['quality.js', 'math.js', 'world.js', 'world2.js', 'shaders.js', 'shaders2.js', 'main.js'];
let js = '';
for (const p of parts) js += '\n// ==================== ' + p + ' ====================\n' + fs.readFileSync(T + p, 'utf8');

let tpl = fs.readFileSync(T + 'template.html', 'utf8');
for (const ph of ['/*__QUALITY__*/', '/*__MATH__*/', '/*__WORLD__*/', '/*__WORLD2__*/', '/*__SHADERS__*/', '/*__SHADERS2__*/', '/*__MAIN__*/']) {
  if (!tpl.includes(ph)) { console.error('missing placeholder ' + ph); process.exit(1); }
}
tpl = tpl.replace('/*__QUALITY__*/', '').replace('/*__MATH__*/', '').replace('/*__WORLD__*/', '')
  .replace('/*__WORLD2__*/', '').replace('/*__SHADERS__*/', '').replace('/*__SHADERS2__*/', '')
  .replace('/*__MAIN__*/', js);

fs.mkdirSync('/home/z/my-project/download', { recursive: true });
fs.writeFileSync('/home/z/my-project/download/index.html', tpl);
console.log('built download/index.html', (tpl.length / 1024).toFixed(0) + ' KB');
