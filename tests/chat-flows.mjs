import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
import { chromium } from 'playwright';
const ROOT = path.resolve('app/assets/www');
const MIME={'.html':'text/html','.js':'application/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png'};
const server=http.createServer((q,s)=>{const u=q.url.split('?')[0];const f=path.join(ROOT,u==='/'?'index.html':u);if(!fs.existsSync(f)){s.writeHead(404);s.end();return;}s.writeHead(200,{'Content-Type':MIME[path.extname(f)]||'text/plain'});fs.createReadStream(f).pipe(s);});
await new Promise(r=>server.listen(8798,'127.0.0.1',r));
const ok=d=>({status:200,contentType:'application/json',body:JSON.stringify({code:0,data:d})});
const PNG='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
let mode='stream-ok';
const b=await chromium.launch({args:['--no-sandbox','--disable-web-security','--disable-dev-shm-usage']});
const c=await b.newContext({viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true,locale:'zh-CN'});
await c.addInitScript(()=>{localStorage.setItem('phuket_token',JSON.stringify('t'));localStorage.setItem('phuket_user',JSON.stringify({id:1,email:'a@b.c',balance:9}));});
const p=await c.newPage();
const errs=[]; p.on('pageerror',e=>errs.push(e.message));
await p.route('**/*', async route=>{
  const u=new URL(route.request().url());
  if(u.hostname==='127.0.0.1') return route.continue();
  const q=u.pathname;
  if(q==='/api/v1/keys') return route.fulfill(ok({items:[{id:1,name:'k',key:'sk-1',status:'active'}]}));
  if(q==='/api/v1/auth/me') return route.fulfill(ok({id:1,email:'a@b.c',balance:9}));
  if(q==='/v1/models') return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({data:[{id:'claude-sonnet-4-5'},{id:'gpt-image-2'}]})});
  if(q==='/v1/chat/completions') {
    let body={}; try{ body=JSON.parse(route.request().postData()||'{}'); }catch(e){}
    if(body.stream===false) {
      if(mode==='fallback') return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({choices:[{message:{content:'非流式兜底成功'}}]})});
      return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({choices:[{message:{content:'ok'}}]})});
    }
    if(mode==='stream-error') return route.fulfill({status:400,contentType:'application/json',body:JSON.stringify({error:{message:'group is not allowed to use this model'}})});
    if(mode==='stream-500') return route.fulfill({status:502,contentType:'text/html',body:'<html>bad gateway</html>'});
    const sse=['data: {"choices":[{"delta":{"content":"流式返回正常。"}}]}','data: [DONE]',''].join('\n\n');
    return route.fulfill({status:200,headers:{'content-type':'text/event-stream','access-control-allow-origin':'*'},body:sse});
  }
  if(q==='/v1/images/generations') {
    return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({created:1,data:[{b64_json:PNG,revised_prompt:'一只橘猫宇航员'}]})});
  }
  return route.continue();
});
async function fresh(){ await p.goto('http://127.0.0.1:8798/index.html#/chat',{waitUntil:'load'}); await p.waitForTimeout(2200); }
async function send(text){ await p.fill('.composer textarea', text); await p.click('.send-btn'); await p.waitForTimeout(1500); }

await fresh();
await send('你好');
console.log('stream ok ->', await p.locator('.bubble-row').count(), '| err', await p.locator('.err-box').count());

mode='stream-error';
await fresh();
await send('测试错误');
console.log('400 error ->', (await p.locator('.err-box').innerText()).slice(0,60), '| detail', await p.locator('.err-detail').count(), '| retry btn', await p.locator('.msg-actions button').count());
await p.screenshot({path:'shots4/01-error.png'});

mode='stream-500';
await fresh();
await send('测试兜底');
await p.waitForTimeout(1500);
console.log('fallback ->', (await p.locator('.bubble-row').last().innerText()).slice(0,40));

mode='stream-ok';
await fresh();
await p.click('.chip >> nth=0'); await p.waitForTimeout(400);
await p.fill('.sheet input', 'gpt-image');
await p.waitForTimeout(300);
await p.locator('.sheet .list-item').first().click(); await p.waitForTimeout(500);
await send('一只橘猫宇航员，纯色背景');
await p.waitForTimeout(2000);
console.log('image ->', await p.locator('.bubble img.gen').count(), '| pending', await p.locator('.img-loading').count());
await p.screenshot({path:'shots4/02-image.png'});
console.log('ERRORS', errs.length?errs.slice(0,3).join(' ; '):'none');
await b.close(); server.close();
