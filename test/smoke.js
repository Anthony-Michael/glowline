#!/usr/bin/env node
/* Headless-Chrome integration smoke test for the Glowline app.
   Generates a harness from app.html, injects a script that traces two runs,
   lights a scene, and opens the proposal + crew sheet, then asserts results.
   Usage: node test/smoke.js   (exit 0 = pass, 1 = fail) */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const root = path.resolve(__dirname, '..');

let html = fs.readFileSync(path.join(root, 'app.html'), 'utf8');
html = html.replace('</head>', '<script>window.__err=[];addEventListener("error",e=>window.__err.push(e.message));</script></head>');

const testScript = `<pre id="RESULT" style="display:none"></pre><script>
function runTest(){
 var R=document.getElementById('RESULT');
 try{
  var diag={scenesChildren:document.querySelector('.scenes').children.length, lineItems:document.querySelector('#lineItems').children.length, hasXmas:!!document.querySelector('.scene-chip[data-scene=\\"xmas\\"]'), err0:(window.__err||[]).slice()};
  if(!diag.hasXmas){ R.textContent='DIAG:'+JSON.stringify(diag); return; }
  var ov=document.querySelector('#overlay'); var r=ov.getBoundingClientRect(); var VB=1200,VBh=760;
  function clickAt(x,y){ov.dispatchEvent(new MouseEvent('click',{clientX:r.left+(x/VB)*r.width,clientY:r.top+(y/VBh)*r.height,bubbles:true}));}
  var out={};
  // snap defaults on; disable it so the exact-vertex trace is deterministic
  out.snapDefaultOn=document.querySelector('#toolSnap').classList.contains('is-active');
  if(out.snapDefaultOn) document.querySelector('#toolSnap').click();
  [[230,335],[530,190],[830,335]].forEach(function(p){clickAt(p[0],p[1]);});
  document.querySelector('#toolNewRun').click();
  [[752,425],[920,330],[1088,425]].forEach(function(p){clickAt(p[0],p[1]);});
  document.querySelector('.scene-chip[data-scene="xmas"]').click();
  out.rectW=Math.round(r.width);
  out.feet=document.querySelector('#feetNum').textContent;
  out.bulbs=ov.querySelectorAll('circle').length;
  out.polylines=ov.querySelectorAll('polyline').length;
  out.night=document.querySelector('#canvasFrame').classList.contains('is-night');
  out.total=document.querySelector('#tTotal').textContent;
  document.querySelector('#btnProposal').click();
  out.proposalRows=document.querySelectorAll('.doc-table tr').length;
  out.heroCircles=document.querySelectorAll('.doc-hero svg circle').length;
  out.seasonThumbs=document.querySelectorAll('.doc-thumb').length;
  document.querySelector('#btnCloseProposal').click();
  document.querySelector('#btnCrew').click();
  out.crewOpen=!document.querySelector('#crewScrim').hidden;
  out.crewRows=document.querySelectorAll('#crewBody .doc-table tr').length;
  document.querySelector('#btnCloseCrew').click();
  // New project banks the current one and resets the workspace
  document.querySelector('#btnSaved').click();
  document.querySelector('#btnNewProject').click();
  out.afterNewFeet=document.querySelector('#feetNum').textContent;
  out.afterNewRuns=document.querySelectorAll('#overlay polyline').length;
  // snap sub-test: clear, enable snap, click 15px BELOW the roof apex (530,205) → should snap up to the edge (~190)
  document.querySelector('#toolClear').click();
  if(!document.querySelector('#toolSnap').classList.contains('is-active')) document.querySelector('#toolSnap').click();
  out.snapOn=document.querySelector('#toolSnap').classList.contains('is-active');
  clickAt(530,205);
  var vh=document.querySelector('.vhandle');
  out.snapY=vh?Math.round(parseFloat(vh.getAttribute('cy'))):null;
  out.errs=window.__err;
  R.textContent=JSON.stringify(out);
 }catch(e){ R.textContent='THREW:'+(e&&e.stack||e); }
}
// run after full load; retry briefly in case first-run layout/state settles late
addEventListener('load',function(){ setTimeout(runTest, 300); });
</script></body>`;
html = html.replace('</body>', testScript);

// write the harness to the project root so relative app.js/styles.css resolve
const harness = path.join(root, '_smoke.html');
fs.writeFileSync(harness, html);
const cleanup = () => { try { fs.unlinkSync(harness); } catch (e) {} };

let dom;
try {
  dom = execFileSync(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox',
    '--window-size=1400,900', '--virtual-time-budget=6000', '--dump-dom',
    'file://' + harness], { encoding: 'utf8', maxBuffer: 1e8 });
} catch (e) { cleanup(); console.error('Chrome failed:', e.message); process.exit(1); }

cleanup();
const m = dom.match(/<pre id="RESULT"[^>]*>([\s\S]*?)<\/pre>/);
if (!m) { console.error('FAIL: no RESULT node in DOM'); process.exit(1); }
const txt = m[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
if (txt.startsWith('THREW:')) { console.error('FAIL: app threw:\n' + txt); process.exit(1); }
if (txt.startsWith('DIAG:')) { console.error('FAIL: pre-conditions not met:\n' + txt); process.exit(1); }

let r;
try { r = JSON.parse(txt); } catch (e) { console.error('FAIL: bad RESULT json:\n' + txt); process.exit(1); }

const checks = [
  ['no JS errors', Array.isArray(r.errs) && r.errs.length === 0, JSON.stringify(r.errs)],
  ['overlay laid out', r.rectW > 0, r.rectW],
  ['feet = 49', r.feet === '49', r.feet],
  ['two polylines (runs)', r.polylines === 2, r.polylines],
  ['bulbs rendered', r.bulbs > 100, r.bulbs],
  ['night on after scene', r.night === true, r.night],
  ['total = $1,697', r.total === '$1,697', r.total],
  ['proposal rows >= 2', r.proposalRows >= 2, r.proposalRows],
  ['proposal hero lit', r.heroCircles > 100, r.heroCircles],
  ['season strip = 4 thumbs', r.seasonThumbs === 4, r.seasonThumbs],
  ['crew sheet opens', r.crewOpen === true, r.crewOpen],
  ['crew BOM rows > 5', r.crewRows > 5, r.crewRows],
  ['New project clears the trace', r.afterNewFeet === '0' && r.afterNewRuns === 0, r.afterNewFeet + '/' + r.afterNewRuns],
  ['edge snap on by default', r.snapDefaultOn === true, r.snapDefaultOn],
  ['snap toggle re-enabled', r.snapOn === true, r.snapOn],
  ['click snapped to roofline (<200 from 205)', r.snapY !== null && r.snapY < 200 && r.snapY > 150, r.snapY],
];

let ok = true;
for (const [name, pass, got] of checks) {
  console.log((pass ? '  ok ' : 'FAIL ') + name + '  (' + got + ')');
  if (!pass) ok = false;
}
console.log(ok ? '\nPASS — all smoke checks green' : '\nFAILED');
process.exit(ok ? 0 : 1);
