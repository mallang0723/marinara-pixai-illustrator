// Adapt legacy helper harnesses to the real v2 coordinator, keeping their assertions.
const vm=require('node:vm');const {helper}=require('./v2-helpers.cjs');
module.exports=function(ctx){
 Object.assign(ctx,{crypto:require('node:crypto').webcrypto,structuredClone,DOMException,storageError:'',stopRevision:0,saveQueue:Promise.resolve(),operationQueue:Promise.resolve(),inflight:new Map(),operationChats:new Map(),storageLock:async fn=>fn(),renderLedger(){},composePrompt:()=>({prompt:'fixture',negative:'',loras:[]})});
 ctx.settings={schemaVersion:2,stopEpoch:0,operationLedger:[],...(ctx.settings||{})};
 const stored=structuredClone(ctx.settings);
 ctx.marinara={storage:{get:async()=>structuredClone(stored),patch:async p=>Object.assign(stored,structuredClone(p))}};
 vm.runInContext(['coordinate','executeOperation','writeReceipt','assertOperation','isUnresolved','validateStorage'].map(helper).join('\n'),ctx);
};
