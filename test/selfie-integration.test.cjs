const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');
const {context}=require('./v2-helpers.cjs');const {installFixture}=require('./selfie-fixture.cjs');
function fixture(){
 const c=context(['installSelfieAdapter','matchSelfie','handleSelfie','promptSignature','abortCaller','coordinate','executeOperation','assertOperation','writeReceipt','isUnresolved','validateStorage','preparePrompt','readChatCards','appearanceOf','personaAppearance','composePrompt','validateStyle','cutText','parseLoras','mergeLoras','mfetch','checkedFetch','ensureRunning','pixaiHeaders','ensureTaskAccess','pixaiCreateTask','truncatePrompt','pixaiWaitTask','pixaiDownload','safeMediaUrl','uploadToGallery','validateChatImage','extFromBlob'],{
 Blob,FormData,location:{origin:'https://fixture.test',href:'https://fixture.test/'},settings:{},stopped:false,isLeader:true,storageError:'',stopRevision:0,saveQueue:Promise.resolve(),operationQueue:Promise.resolve(),inflight:new Map(),operationChats:new Map(),selfiePreviews:new Map(),requestControllers:new Set(),taskAccessCheck:null,
 STYLE_PRESETS:['chibi'],STYLE_MODELS:['1983308862240288769'],PIXAI_BASE:'https://api.pixai.art',CSRF_HEADER:'x-marinara-csrf',MAX_PROMPT_CHARS:2000,MAX_IMAGE_BYTES:20971520,ASPECT_RATIOS:['1:1','2:3'],DEFAULTS:{aspectRatio:'2:3'},TASK_TIMEOUT_MS:10000,POLL_TASK_MS:0,delay:async()=>{},storageLock:async fn=>fn(),recordStage(){},renderLedger(){},showPreview(){},describeFetchError:()=>''
 });c.window=c;vm.runInContext(`(${installFixture.toString()})()`,c);
 Object.assign(c.saved,{schemaVersion:2,stopEpoch:0,operationLedger:[],modelVersionId:'1983308862240288769',loras:[],styleTags:'ink',pixaiStyle:{type:'preset',key:'chibi'},size:'1k',mode:'standard',promptHelper:'disable',aspectRatio:'2:3',selfieInterceptEnabled:true});
 c.settings=structuredClone(c.saved);c.apiKey='synthetic-pixai';const cleanup=c.installSelfieAdapter();return{c,cleanup};
}
test('real helper pipeline: preview/override to ChatImage, one create, no original POST/header leak/attachment',async()=>{
 const {c,cleanup}=fixture();const body={characterId:'char',queueImageGenerationRequests:true,debugMode:true};
 const preview=await(await c.fetch('/api/gallery/chat/selfie',{method:'POST',body:JSON.stringify({...body,previewOnly:true})})).json();
 assert.equal(c.saved.operationLedger.length,0);assert.equal(c.calls.filter(x=>x.method==='POST').length,0);
 const response=await c.fetch('/api/gallery/chat/selfie',{method:'POST',headers:{'x-admin-secret':'synthetic-inbound','x-marinara-csrf':'synthetic-csrf'},body:JSON.stringify({...body,promptOverride:preview.items[0].prompt})});
 assert.equal(response.status,200);const image=await response.json();assert.equal(image.id,'gallery');assert.equal(image.prompt,preview.items[0].prompt);assert.equal(c.saved.operationLedger[0].state,'complete');
 const creates=c.calls.filter(x=>x.url.endsWith('/v2/image/create'));assert.equal(creates.length,1);assert.equal(JSON.parse(creates[0].body).style.key,'chibi');
 assert.equal(c.calls.filter(x=>x.url.endsWith('/selfie')).length,0);assert.equal(c.calls.filter(x=>x.method==='PATCH').length,0);
 for(const call of c.calls.filter(x=>x.url.startsWith('https:'))){assert.equal(call.headers['x-admin-secret'],undefined);assert.equal(call.headers['x-marinara-csrf'],undefined);}
 assert.equal(JSON.stringify(c.saved.operationLedger).includes('red hair'),false);assert.equal(JSON.stringify(c.logs).includes('synthetic-inbound'),false);cleanup();assert.equal(c.fetch,c.original);
});
test('full wrapper abort after POST rejects caller while task receipt reaches gallery; follower errors never fall back',async()=>{
 const {c,cleanup}=fixture();let release;c.createGate=new Promise(r=>release=r);const signal=new AbortController();
 const pending=c.fetch('/api/gallery/chat/selfie',{method:'POST',body:'{"characterId":"char"}',signal:signal.signal});
 for(let n=0;n<30 && !c.calls.some(x=>x.url.endsWith('/v2/image/create'));n++)await new Promise(r=>setImmediate(r));
 assert.equal(c.calls.filter(x=>x.url.endsWith('/v2/image/create')).length,1);signal.abort();await assert.rejects(pending,e=>e.name==='AbortError');release();await c.operationQueue;
 assert.equal(c.saved.operationLedger[0].state,'complete');assert.equal(c.saved.operationLedger[0].galleryId,'gallery');
 c.isLeader=false;const response=await c.fetch('/api/gallery/chat/selfie',{method:'POST',body:'{"characterId":"char"}'});
 assert.equal(response.status,409);assert.equal(typeof(await response.json()).error,"string");
 assert.equal(c.calls.filter(x=>x.url.endsWith("/selfie")).length,0);cleanup();
});
