const {test}=require('node:test');const assert=require('node:assert/strict');const {context}=require('./v2-helpers.cjs');
test('strict preflight rejects all HTTP errors except real 404 before create',async()=>{
 for(const status of [401,403,429,500,200,404]){
 let creates=0;const c=context(['ensureTaskAccess','pixaiCreateTask','parseLoras','truncatePrompt'],{settings:{modelVersionId:'1',loras:[]},ASPECT_RATIOS:['1:1'],DEFAULTS:{aspectRatio:'1:1'},MAX_PROMPT_CHARS:2000,PIXAI_BASE:'https://fixture.invalid',taskAccessCheck:null,pixaiHeaders:()=>({}),recordStage(){},checkedFetch:async(url)=>url.endsWith('/0')?new Response('',{status}):(creates++,new Response('{"id":"t"}'))});
 if([200,404].includes(status))await c.pixaiCreateTask('scene','','1:1');else await assert.rejects(c.pixaiCreateTask('scene','','1:1'));
 assert.equal(creates,[200,404].includes(status)?1:0);
 }
});
function coordinator(overrides={}) {
 const stored={schemaVersion:2,stopEpoch:0,operationLedger:[]};const events=[];
 const c=context(['coordinate','executeOperation','writeReceipt','assertOperation','isUnresolved','validateStorage'],{
  settings:{...stored,modelVersionId:'123',loras:[]},apiKey:'synthetic',isLeader:true,stopped:false,storageError:'',stopRevision:0,saveQueue:Promise.resolve(),operationQueue:Promise.resolve(),inflight:new Map(),operationChats:new Map(),
  storageLock:async fn=>fn(),marinara:{storage:{get:async()=>structuredClone(stored),patch:async p=>{events.push(p.operationLedger?.at(-1)?.state);Object.assign(stored,structuredClone(p));}}},
  ensureTaskAccess:async()=>404,prepare:async()=>({prompt:'scene',negative:'',loras:[]}),
  pixaiCreateTask:async()=>{events.push('POST');return {id:'task'};},pixaiWaitTask:async()=>({}),pixaiDownload:async()=>({}),uploadToGallery:async()=>({id:'gallery'}),attachToMessage:async()=>{},recordStage(){},renderLedger(){},...overrides
 });
 // A create stub must honor the real transport's final dispatch guard.
 const create=c.pixaiCreateTask;
 c.pixaiCreateTask=async(...args)=>{const guard=await args[5]();guard();return create(...args);};
 return {c,stored,events};
}
test('durable creating precedes one POST; failed claim sends none and uncertain create blocks replay',async()=>{
 const f=coordinator();await f.c.coordinate({operationId:'a',source:'selfie',anchor:{chatId:'chat',characterId:'char'},prepare:f.c.prepare});
 assert.ok(f.events.indexOf('creating')<f.events.indexOf('POST'));assert.equal(f.stored.operationLedger[0].state,'complete');assert.equal(f.stored.operationLedger[0].galleryId,'gallery');
 assert.equal(JSON.stringify(f.stored).includes('scene'),false);
 const bad=coordinator({pixaiCreateTask:async()=>{throw new Error('lost reply');}});
 const spec={operationId:'b',source:'selfie',anchor:{chatId:'chat',characterId:'char'},prepare:bad.c.prepare};
 await assert.rejects(bad.c.coordinate(spec));assert.equal(bad.stored.operationLedger[0].state,'ambiguous');
 await assert.rejects(bad.c.coordinate({...spec,operationId:'c'}),/미해결/);
 const fail=coordinator();let calls=0;fail.c.pixaiCreateTask=async()=>{calls++;};fail.c.marinara.storage.patch=async()=>{throw new Error('storage');};
 await assert.rejects(fail.c.coordinate({...spec,prepare:fail.c.prepare}));assert.equal(calls,0);
});
test('same target shares promise before 409; metadata is snapshotted and global stop leaves known task unresolved',async()=>{
 let release, uploads=0;const f=coordinator({pixaiWaitTask:async()=>new Promise(r=>release=r),uploadToGallery:async(_c,_b,_p,opts)=>{uploads++;assert.equal(opts.modelVersionId,'123');return{id:'g'};}});
 const spec={operationId:'s',source:'selfie',anchor:{chatId:'chat',characterId:'char'},prepare:f.c.prepare};
 const a=f.c.coordinate(spec);const b=f.c.coordinate({...spec,operationId:'s2'});assert.equal(a,b);
 await assert.rejects(f.c.coordinate({...spec,operationId:'s3',anchor:{chatId:'chat',characterId:'other'}}),e=>e.status===409);
 await new Promise(r=>setImmediate(r));f.c.settings.modelVersionId='999';release({});await a;assert.equal(uploads,1);
 const stop=coordinator({pixaiWaitTask:async()=>new Promise(r=>release=r)});
 const work=stop.c.coordinate({...spec,prepare:stop.c.prepare});await new Promise(r=>setImmediate(r));stop.c.stopRevision++;release({});await assert.rejects(work);
 assert.equal(stop.stored.operationLedger[0].taskId,'task');assert.equal(stop.stored.operationLedger[0].state,'taskKnown');
});
test('illustration and paid diagnostic use the shared coordinator',async()=>{
 const calls=[];const c=context(['processRun','runDiagnostics'],{busy:false,stopped:false,isLeader:true,apiKey:'synthetic',settings:{},confirm:()=>true,crypto:require('node:crypto').webcrypto,
 parseAgentText:()=>({prompt:'s',negative:'',ratio:'1:1'}),preparePrompt:async()=>({prompt:'s'}),composePrompt:()=>({prompt:'s'}),recordStage(){},describeFetchError:()=>'',coordinate:async spec=>calls.push(spec)});
 await c.processRun({id:'run',chatId:'chat',messageId:'msg'});await c.runDiagnostics(true);
 assert.deepEqual(calls.map(s=>s.source),['illustration','diagnostic']);assert.equal(calls[0].operationId,'run:run');
});
test('caller abort after task creation preserves gallery receipt; abort before create and repeated operation never bill',async()=>{
 let release,posts=0,uploads=0;const ctl=new AbortController();
 const f=coordinator({pixaiCreateTask:async()=>{posts++;return{id:'task'};},pixaiWaitTask:async()=>new Promise(r=>release=r),uploadToGallery:async()=>{uploads++;return{id:'gallery'};}});
 const spec={operationId:'abort',source:'selfie',anchor:{chatId:'chat',characterId:'char'},signal:ctl.signal,prepare:f.c.prepare};const work=f.c.coordinate(spec);
 await new Promise(r=>setImmediate(r));ctl.abort();release({});await work;assert.equal(uploads,1);assert.equal(f.stored.operationLedger[0].state,'complete');
 await assert.rejects(f.c.coordinate({...spec,signal:undefined}));assert.equal(posts,1);
 const early=coordinator();let calls=0;early.c.pixaiCreateTask=async()=>{calls++;};await assert.rejects(early.c.coordinate({...spec,operationId:'early',prepare:early.c.prepare}));assert.equal(calls,0);
});
test('stop during the final create preflight prevents POST at the transport boundary',async()=>{
 let posts=0;const c=context(['pixaiCreateTask','parseLoras','truncatePrompt'],{settings:{modelVersionId:'123',loras:[]},ASPECT_RATIOS:['1:1'],DEFAULTS:{aspectRatio:'1:1'},MAX_PROMPT_CHARS:2000,PIXAI_BASE:'https://fixture.invalid',ensureTaskAccess:async()=>404,pixaiHeaders:()=>({}),recordStage(){},checkedFetch:async()=>{posts++;return new Response('{"id":"task"}');}});
 await assert.rejects(c.pixaiCreateTask('scene','','1:1',c.settings,null,async()=>{throw new DOMException('stop','AbortError');}));assert.equal(posts,0);
});
test('illustration validates its message before billing and snapshots the active swipe',async()=>{
 const anchor={chatId:'chat',messageId:'msg'};let reads=0;const c=context(['prepareIllustration'],{mfetch:async()=>({ok:true,json:async()=>[{id:'msg',role:'assistant',activeSwipeIndex:2}]}),preparePrompt:async()=>{reads++;return{prompt:'scene'};}});
 await c.prepareIllustration(anchor,{prompt:'scene'},{});assert.equal(anchor.swipeIndex,2);assert.equal(reads,1);
 await assert.rejects(c.prepareIllustration({...anchor,messageId:'deleted'},{},{}));assert.equal(reads,1);
});
test('ledger never evicts unresolved receipts and blocks new claims at unresolved capacity',async()=>{
 const f=coordinator();f.stored.operationLedger=Array.from({length:500},(_,i)=>({operationId:`old:${i}`,source:'selfie',anchor:{chatId:`c${i}`,characterId:'char'},state:'ambiguous',createdAt:'2026-10-05T00:00:00.000Z',updatedAt:'2026-10-05T00:00:00.000Z'}));
 await assert.rejects(f.c.coordinate({operationId:'new',source:'selfie',anchor:{chatId:'new',characterId:'char'},prepare:f.c.prepare}),/한도/);
 assert.equal(f.stored.operationLedger.length,500);assert.equal(f.events.includes('POST'),false);
});
