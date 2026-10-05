const { test } = require('node:test');
const assert = require('node:assert/strict');
const { context } = require('./v2-helpers.cjs');
test('migration writes only absent v2 keys, preserves legacy values and is idempotent', async () => {
  const stored = { enabled: true, rememberKey: false, apiKey: 'synthetic-not-a-key', modelVersionId: '123', processedRunIds: ['r'], uiPosition: { x: 4 } };
  const writes = [];
  const ctx = context(['storageLock', 'migrateSettings','validateStorage'], { navigator: { locks: { request: async (n,o,fn) => fn({}) } }, V2_DEFAULTS: { schemaVersion: 2, characterProfiles: {}, selfieInterceptEnabled: false }, marinara: { storage: { get: async () => structuredClone(stored), patch: async p => { writes.push(p); Object.assign(stored,p); } } } });
  await ctx.migrateSettings(); await ctx.migrateSettings();
  assert.equal(writes.length, 1);
  assert.deepEqual(Object.keys(writes[0]).sort(), ['characterProfiles','schemaVersion','selfieInterceptEnabled']);
  assert.equal(stored.enabled, true); assert.equal(stored.rememberKey, false);
  stored.schemaVersion = 3; await assert.rejects(ctx.migrateSettings());
  stored.schemaVersion = '2'; await assert.rejects(ctx.migrateSettings());
});
test('owned writes and map RMW share lock; stale ON loses to emergency stop', async () => {
  const stored = { enabled: false, stopEpoch: 2, characterProfiles: { other: { fixedTags: 'blue' } } }; const writes = [];
  const ctx = context(['storageLock','saveSettings','saveProfile'], { navigator: { locks: { request: async (n,o,fn) => fn({}) } }, isLeader: true, stopRevision: 0, settings: { enabled: true, stopEpoch: 1 }, saveQueue: Promise.resolve(), ensureRunning() {}, MAX_REMEMBERED_RUNS: 500,
    marinara: { storage: { get: async () => structuredClone(stored), patch: async p => { writes.push(structuredClone(p)); Object.assign(stored,p); } } } });
  await ctx.saveSettings({ enabled: true }); assert.equal(stored.enabled, false);
  await ctx.saveSettings({ size: '1k' }); assert.deepEqual(Object.keys(writes.at(-1)), ['size']);
  await ctx.saveProfile('characterProfiles','new',{ fixedTags: 'red' });
  assert.deepEqual(Object.keys(stored.characterProfiles).sort(), ['new','other']);
  assert.deepEqual(Object.keys(writes.at(-1)), ['characterProfiles']);
  ctx.isLeader = false; await ctx.saveSettings({ enabled: false, selfieInterceptEnabled: false });
  await assert.rejects(ctx.saveSettings({ size: '1.5k' }));
});
test('v2 panel values validate style and reserved identity before saving',()=>{
 const fields={'.pb-style-type':'preset','.pb-style-preset':'chibi','.pb-style-custom':'','.pb-style-tags':'ink','.pb-style-position':'suffix'};
 const c=context(['readV2Controls','validateStyle','composePrompt','mergeLoras','parseLoras','cutText'],{settings:{modelVersionId:'1',loras:[],characterProfiles:{}},STYLE_PRESETS:['chibi'],STYLE_MODELS:['1'],q:s=>({value:fields[s],checked:false})});
 const patch=c.readV2Controls();assert.equal(patch.pixaiStyle.key,'chibi');assert.equal(patch.styleTagsPosition,'suffix');
 fields['.pb-style-preset']='unknown';assert.throws(()=>c.readV2Controls());fields['.pb-style-preset']='chibi';fields['.pb-style-tags']='x'.repeat(2001);assert.throws(()=>c.readV2Controls());
});
test('malformed persisted opt-ins, profiles and ledger fail closed without patch',async()=>{
 for (const invalid of [{selfieInterceptEnabled:'true'},{styleTags:4},{characterProfiles:{c:{fixedTags:4}}},{operationLedger:[{state:'invented'}]}]){
  let writes=0;const c=context(['migrateSettings','validateStorage'],{storageLock:async fn=>fn(),V2_DEFAULTS:{schemaVersion:2},marinara:{storage:{get:async()=>({schemaVersion:2,...invalid}),patch:async()=>writes++}}});
  await assert.rejects(c.migrateSettings());assert.equal(writes,0);
 }
});
test('stale queued credential save cannot retain a deleted key in memory',async()=>{
 const stored={schemaVersion:2,stopEpoch:3,apiKey:'',rememberKey:false};const c=context(['saveSettings'],{isLeader:true,stopRevision:0,apiKey:'synthetic-stale',taskAccessCheck:{},settings:{stopEpoch:2,enabled:true},saveQueue:Promise.resolve(),ensureRunning(){},storageLock:async fn=>fn(),MAX_REMEMBERED_RUNS:500,marinara:{storage:{get:async()=>({...stored}),patch:async p=>Object.assign(stored,p)}}});
 await c.saveSettings({apiKey:'synthetic-stale',rememberKey:true,enabled:true});assert.equal(stored.apiKey,'');assert.equal(c.apiKey,'');assert.equal(c.settings.enabled,false);
});
test('two independently queued map RMW writers retain both rows under the shared Web Lock',async()=>{
 const stored={schemaVersion:2,characterProfiles:{}};let lock=Promise.resolve();const names=[];
 const navigator={locks:{request:(name,_opts,fn)=>{names.push(name);const work=lock.then(fn);lock=work.catch(()=>{});return work;}}};
 const values={navigator,isLeader:true,settings:{},saveQueue:Promise.resolve(),ensureRunning(){},marinara:{storage:{get:async()=>structuredClone(stored),patch:async p=>Object.assign(stored,structuredClone(p))}}};
 const a=context(['storageLock','saveProfile'],values),b=context(['storageLock','saveProfile'],values);
 await Promise.all([a.saveProfile('characterProfiles','a',{fixedTags:'red'}),b.saveProfile('characterProfiles','b',{fixedTags:'blue'})]);
 assert.deepEqual(Object.keys(stored.characterProfiles).sort(),['a','b']);assert.deepEqual(names,['pixai-illustrator-storage','pixai-illustrator-storage']);
});
test('follower key deletion works during busy and immediately stops controllers while preserving receipts',async()=>{
 const stored={schemaVersion:2,stopEpoch:0,apiKey:'synthetic',rememberKey:true,enabled:true,operationLedger:[{operationId:'in-progress'}]};const inputs=new Map();const q=s=>{if(!inputs.has(s))inputs.set(s,{});return inputs.get(s);};let aborted=0;
 const c=context(['emergencyStop','stopLocalWork','saveSettings'],{stopped:false,busy:true,isLeader:false,stopRevision:0,armedAt:0,settings:structuredClone(stored),apiKey:'synthetic',taskAccessCheck:{},requestControllers:new Set([{abort(){aborted++;}}]),pendingDelays:new Map(),stopChannel:null,q,saveQueue:Promise.resolve(),MAX_REMEMBERED_RUNS:500,storageLock:async fn=>fn(),ensureRunning(){},recordStage(){},renderStatus(){},marinara:{storage:{get:async()=>structuredClone(stored),patch:async p=>Object.assign(stored,structuredClone(p))}}});
 const work=c.emergencyStop(true);assert.equal(c.apiKey,'');assert.equal(c.settings.enabled,false);assert.equal(aborted,1);assert.equal(c.busy,true);await work;
 assert.equal(stored.apiKey,'');assert.equal(stored.selfieInterceptEnabled,false);assert.equal(stored.stopEpoch,1);assert.equal(stored.operationLedger[0].operationId,'in-progress');
});
