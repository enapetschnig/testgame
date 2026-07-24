import { chromium } from 'playwright';
import fs from 'fs';
const OUT = process.env.OUT || '/tmp';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
const errs=[]; page.on('pageerror', e=>errs.push(e.message));
await page.goto('http://localhost:4173/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('#menu-main:not([hidden])', { timeout: 120000 });
await page.click('#btn-freeroam');
await page.waitForFunction(() => !!globalThis.__frojach, null, { timeout: 180000 });
await page.waitForTimeout(3000);

// Fahren: Gas 40 s (Software-Rendering ist langsam, dt wird gedeckelt)
const b = await page.evaluate(() => ({x:__frojach.vehicle.x, z:__frojach.vehicle.z}));
await page.keyboard.down('KeyW');
await page.waitForTimeout(40000);
const mid = await page.evaluate(() => { const v=__frojach.vehicle; return {kmh:+v.speedKmh.toFixed(1), gear:v.gear, onRoad:v.onRoad, road:v.currentRoad?.name}; });
await page.keyboard.down('KeyD');
await page.waitForTimeout(15000);
await page.keyboard.up('KeyD'); await page.keyboard.up('KeyW');
const a = await page.evaluate(() => { const v=__frojach.vehicle; const g=__frojach; return {
  x:v.x,z:v.z, kmh:+v.speedKmh.toFixed(1), slip:+v.slip.toFixed(2), road:v.currentRoad?.name,
  shadows:g.renderer.shadowMap.enabled, clock:document.querySelector('#clock').textContent,
  traffic:g.traffic.cars.filter(c=>c.active).length }; });
console.log('nach Gas :', JSON.stringify(mid));
console.log('nach Kurve:', JSON.stringify(a));
console.log('gefahren :', Math.hypot(a.x-b.x,a.z-b.z).toFixed(0), 'm');
console.log('errors   :', errs.length ? errs : 'keine');

async function grab(name, code) {
  const url = await page.evaluate((c) => { const g = globalThis.__frojach;
    new Function('g', c)(g); g.renderer.render(g.scene, g.camera);
    return g.renderer.domElement.toDataURL('image/png'); }, code);
  fs.writeFileSync(`${OUT}/${name}.png`, Buffer.from(url.split(',')[1],'base64'));
  console.log('shot', name);
}
await grab('final-chase', `g.sky.state.time=9.5*60; g.sky.update(g.vehicle.x,g.vehicle.z);`);
await grab('final-side', `const v=g.vehicle;
  g.camera.position.set(v.x+7, v.y+2.0, v.z+3.5); g.camera.lookAt(v.x, v.y+0.7, v.z);
  g.camera.fov=45; g.camera.updateProjectionMatrix();`);
await grab('final-aerial', `const v=g.vehicle;
  g.camera.position.set(v.x-180, v.y+150, v.z+210); g.camera.lookAt(v.x,v.y,v.z);
  g.camera.fov=58; g.camera.updateProjectionMatrix();`);
await browser.close();
