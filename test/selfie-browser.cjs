const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {createRequire}=require('node:module');const {installFixture}=require('./selfie-fixture.cjs');
const {chromium}=createRequire(path.join(process.env.MARINARA_REPO,'package.json'))('@playwright/test');
const source=fs.readFileSync(path.join(__dirname,'../extension.js'),'utf8');
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/usr/sbin/chromium'});
 try{
 const page=await browser.newPage({viewport:{width:390,height:844}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',r=>r.request().url()==='https://fixture.test/'?r.fulfill({contentType:'text/html',body:'<!doctype html><body></body>'}):r.abort());
 await page.goto('https://fixture.test/');await page.evaluate(installFixture);await page.evaluate(()=>localStorage.setItem('marinara-active-chat-id','chat'));
 await page.addStyleTag({content:fs.readFileSync(path.join(__dirname,'../extension.css'),'utf8')});
 await page.evaluate(async code=>window.cleanup=await new Function('marinara',`return (async()=>{${code}\n})();`)(window.marinara),source);
 await page.click('.pixai-bridge-toggle');assert.equal(await page.isChecked('.pb-selfie'),false);await page.check('.pb-selfie');await page.waitForFunction(()=>window.saved.selfieInterceptEnabled===true);
 await page.locator('summary').filter({hasText:'캐릭터·페르소나'}).click();await page.click('.pb-profiles-load');await page.waitForFunction(()=>document.querySelector('.pb-preview-character').options.length===1);
 await page.click('.pb-preview-free');await page.waitForFunction(()=>document.querySelector('.pb-preview').textContent.includes('red hair'));
 const result=await page.evaluate(async()=>{
 const url='/api/gallery/chat/selfie',base={characterId:'char',queueImageGenerationRequests:true,debugMode:true};
 const preview=await (await fetch(new URL(url,location.href),{method:'POST',body:JSON.stringify({...base,previewOnly:true}),headers:{'x-admin-secret':'synthetic-inbound','x-marinara-csrf':'synthetic-csrf'}})).json();
 if(window.calls.some(c=>c.url.endsWith('/v2/image/create')))throw new Error('preview billed');
 const request=new Request(new URL(url,location.href),{method:'POST',body:JSON.stringify({...base,promptOverride:preview.items[0].prompt})});
 const image=await (await fetch(request)).json();return{preview,image,bodyUsed:request.bodyUsed,calls:window.calls,saved:window.saved,logs:window.logs};
 });
 assert.equal(result.preview.items[0].kind,'selfie');assert.equal(result.image.id,'gallery');assert.equal(result.bodyUsed,false);
 assert.equal(result.calls.filter(c=>c.url.endsWith('/v2/image/create')).length,1);assert.equal(result.calls.filter(c=>c.url.endsWith('/selfie')).length,0);
 assert.equal(result.calls.filter(c=>c.method==='PATCH').length,0);assert.equal(result.saved.operationLedger[0].state,'complete');
 for(const c of result.calls.filter(c=>c.url.startsWith('https://'))){assert.equal(c.headers['x-admin-secret'],undefined);assert.equal(c.headers['x-marinara-csrf'],undefined);}
 assert.equal(JSON.stringify(result.logs).includes('synthetic-inbound'),false);assert.equal(JSON.stringify(result.saved.operationLedger).includes('red hair'),false);
 // create has been sent, caller aborts, the actual work still completes to gallery.
 await page.evaluate(()=>{window.createGate=new Promise(r=>window.releaseCreate=r);window.abortControl=new AbortController();window.caller=fetch('/api/gallery/chat/selfie',{method:'POST',body:'{"characterId":"char"}',signal:window.abortControl.signal}).then(()=>false,e=>e.name==='AbortError');});
 await page.waitForFunction(()=>window.calls.filter(c=>c.url.endsWith('/v2/image/create')).length===2);
 await page.evaluate(()=>{window.abortControl.abort();window.releaseCreate();});assert.equal(await page.evaluate(()=>window.caller),true);
 await page.waitForFunction(()=>window.saved.operationLedger.filter(r=>r.state==='complete').length===2);
 // Review C1: a privacy checkbox OFF while a paid selfie polls must not discard it.
 await page.check('.pb-recent');await page.waitForFunction(()=>window.saved.selfieUseRecentContext===true);
 const epoch=await page.evaluate(()=>window.saved.stopEpoch);
 await page.evaluate(()=>{window.pollGate=new Promise(r=>window.releasePoll=r);window.paidSelfie=fetch('/api/gallery/chat/selfie',{method:'POST',body:'{"characterId":"char"}'}).then(r=>r.json());});
 await page.waitForFunction(()=>window.calls.filter(c=>c.url.endsWith('/v2/task/task')).length===3);
 await page.uncheck('.pb-recent');await page.waitForFunction(()=>window.saved.selfieUseRecentContext===false);
 await page.evaluate(()=>window.releasePoll());
 assert.equal((await page.evaluate(()=>window.paidSelfie)).id,'gallery');
 assert.equal(await page.evaluate(()=>window.saved.stopEpoch),epoch);
 assert.equal(await page.evaluate(()=>window.saved.operationLedger.filter(r=>r.state==='complete').length),3);
 assert.equal(await page.evaluate(()=>window.calls.filter(c=>c.url.endsWith('/upload')).length),3);
 await page.click('.pb-stop');await page.waitForFunction(()=>window.saved.selfieInterceptEnabled===false);
 assert.equal(await page.evaluate(async()=> (await (await fetch('/api/gallery/chat/selfie',{method:'POST',body:'{"characterId":"char"}'})).json()).original),true);
 await page.evaluate(()=>{window.cleanup();window.cleanup();});assert.equal(await page.evaluate(()=>window.fetch===window.original),true);assert.deepEqual(errors,[]);
 console.log('PASS offline selfie browser: profiles/free preview/Request override/gallery/C3/abort/privacy OFF during poll/stop/cleanup');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
