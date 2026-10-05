const {test}=require('node:test');const assert=require('node:assert/strict');const {context}=require('./v2-helpers.cjs');
test('selfie matcher accepts string URL Request/init overrides without consuming bodies; rejects unsupported contracts',async()=>{
 const c=context(['matchSelfie'],{location:{href:'https://fixture.test/chat',origin:'https://fixture.test'}});
 const url='https://fixture.test/api/gallery/chat/selfie';const body=JSON.stringify({characterId:'char',queueImageGenerationRequests:true,debugMode:false});
 for(const input of [url,new URL(url),new Request(url,{method:'POST',body})]){
 const result=await c.matchSelfie(input,input instanceof Request?undefined:{method:'POST',body});assert.equal(result.chatId,'chat');assert.equal(result.body.characterId,'char');if(input instanceof Request)assert.equal(input.bodyUsed,false);
 }
 const req=new Request(url,{method:'POST',body:'{}'});assert.equal((await c.matchSelfie(req,{method:'POST',body})).body.characterId,'char');
 for(const [u,init] of [[url+'?x=1',{method:'POST',body}],['https://other.test/api/gallery/chat/selfie',{method:'POST',body}],[url,{method:'GET'}],[url,{method:'POST',body:'{"characterId":"char","unknown":1}'}],[url,{method:'POST',body:'null'}],[url+'/extra',{method:'POST',body}]])assert.equal(await c.matchSelfie(u,init),null);
});
test('adapter owns supported errors, preview costs nothing, cleanup respects later wrappers and abort rejects only caller',async()=>{
 let originals=0,paid=0,release;const win={fetch:async()=>{originals++;return new Response('original');}};
 const c=context(['installSelfieAdapter','abortCaller'],{window:win,stopRevision:0,settings:{selfieInterceptEnabled:true},stopped:false,matchSelfie:async()=>({chatId:'chat',body:{characterId:'char'}}),handleSelfie:async()=>{paid++;return new Response('{"id":"g"}');},recordStage(){}});
 const original=win.fetch,cleanup=c.installSelfieAdapter();assert.equal((await win.fetch('/any')).status,200);assert.equal(originals,0);
 c.handleSelfie=async()=>{throw Object.assign(new Error('synthetic secret'),{status:409});};const fail=await win.fetch('/any');assert.equal(fail.status,409);assert.equal(typeof(await fail.json()).error,'string');assert.equal(originals,0);
 c.settings.selfieInterceptEnabled=false;await win.fetch('/any');assert.equal(originals,1);c.settings.selfieInterceptEnabled=true;
 const wrapper=win.fetch;win.fetch=(...args)=>wrapper(...args);const later=win.fetch;cleanup();assert.equal(win.fetch,later);await win.fetch('/any');assert.equal(originals,2);
 const ctl=new AbortController();const work=new Promise(r=>release=r);const caller=c.abortCaller(work,ctl.signal);ctl.abort();await assert.rejects(caller,e=>e.name==='AbortError');release('gallery');assert.equal(await work,'gallery');
});
test('free prompt review envelope and unchanged override reuse composer; changed settings require review',async()=>{
 let creates=0;const composed={prompt:'ink, red hair, solo',negative:'bad',loras:[],warnings:[],portions:{},truncated:[]};
 const c=context(['handleSelfie','promptSignature'],{settings:{modelVersionId:'123'},stopped:false,storageError:'',selfiePreviews:new Map(),inflight:new Map(),preparePrompt:async()=>structuredClone(composed),showPreview(){},confirm:()=>true,coordinate:async spec=>{creates++;await spec.prepare(spec.options||c.settings);return{id:'g'};}});
 const req={chatId:'chat',body:{characterId:'char',previewOnly:true}};const res=await c.handleSelfie(req);const body=await res.json();assert.equal(body.items[0].kind,'selfie');assert.equal(body.items[0].id,'conversation-selfie');assert.equal(body.items[0].width,undefined);assert.equal(creates,0);
 await c.handleSelfie({...req,body:{characterId:'char',promptOverride:composed.prompt}});assert.equal(creates,1);
 c.settings.modelVersionId='999';await assert.rejects(c.handleSelfie({...req,body:{characterId:'char',promptOverride:composed.prompt}}),e=>e.status===409);assert.equal(creates,1);
});
test('ChatImage validates real server fields and rejects contract mismatch',()=>{
 const c=context(['validateChatImage']);const good={id:'g',chatId:'chat',filePath:'chat/a.png',prompt:'s',provider:'pixai',model:'123',createdAt:'2026-10-05T00:00:00Z',url:'/api/gallery/file/chat/a.png',width:null,height:null};
 assert.equal(c.validateChatImage(good,'chat'),good);
 for(const key of Object.keys(good)){const bad={...good};delete bad[key];assert.throws(()=>c.validateChatImage(bad,'chat'),e=>e.contract===true,key);}
 assert.throws(()=>c.validateChatImage({...good,url:'https://evil.test/a'},'chat'));
});
