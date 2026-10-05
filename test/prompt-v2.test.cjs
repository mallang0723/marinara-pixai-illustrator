const { test } = require('node:test');
const assert = require('node:assert/strict');
const { context } = require('./v2-helpers.cjs');
test('ID profiles resolve exact participant names, legacy and ambiguous selectors safely', () => {
 const c = context(['truncatePrompt','parseAgentText','resolveCharacters'], { settings: { aspectRatio:'2:3' }, DEFAULTS:{ aspectRatio:'2:3' }, ASPECT_RATIOS:['2:3'], MAX_PROMPT_CHARS:2000 });
 const cards = [{id:'1',name:'A, B'},{id:'2',name:'Same'},{id:'3',name:'Same'}];
 const parsed = c.parseAgentText('PIXAI_PROMPT: scene\nPIXAI_CHARACTERS: ["A, B","A, B"]\nPIXAI_PERSONA: true');
 assert.deepEqual([...parsed.characters], ['A, B']); assert.equal(parsed.persona, true);
 assert.deepEqual([...c.resolveCharacters(parsed,cards,{})], ['1']);
 assert.deepEqual([...c.resolveCharacters({characters:['Same']},cards,{})], []);
 assert.deepEqual([...c.resolveCharacters({},cards,{})], []);
 assert.deepEqual([...c.resolveCharacters({},cards.slice(0,1),{})], ['1']);
 assert.deepEqual([...c.resolveCharacters({characters:['alias']},cards,{'1':{aliases:['alias']}})], ['1']);
 assert.deepEqual([...c.resolveCharacters({characters:['Alias']},cards,{'1':{aliases:['alias']}})], []);
 assert.equal(c.parseAgentText('PIXAI_PROMPT: scene\nPIXAI_CHARACTERS: nope').characters, null);
});
test('character LoRA overrides global but conflicting characters and six unique IDs block', () => {
 const c=context(['parseLoras','mergeLoras']);
 const result=c.mergeLoras([{loras:[{modelId:'9999999999999999999',weight:0}]}],[{modelId:'9999999999999999999',weight:1}]);
 assert.equal(result.loras.length,1); assert.equal(result.loras[0].weight,0); assert.equal(result.warnings.length,1);
 assert.throws(()=>c.mergeLoras([{loras:[{modelId:'1',weight:0}]},{loras:[{modelId:'1',weight:1}]}],[]));
 assert.throws(()=>c.mergeLoras([{loras:[{modelId:'6',weight:0}]}],Array.from({length:5},(_,i)=>({modelId:String(i+1),weight:1}))));
});
test('composer reserves suffix style and identity, dedupes overrides and respects UTF16/custom budget', () => {
 const c=context(['parseLoras','mergeLoras','composePrompt','validateStyle','cutText'],{STYLE_PRESETS:['chibi'], STYLE_MODELS:['1983308862240288769']});
 const opts={modelVersionId:'1983308862240288769',styleTags:'Ink, blue eyes',styleTagsPosition:'suffix',negativeDefault:'bad',pixaiStyle:{type:'preset',key:'chibi'},loras:[]};
 const x=c.composePrompt(opts,{scene:'BLUE EYES, park, '+ '😀'.repeat(2000), profiles:[{fixedTags:'blue eyes, red hair'}],selfie:true});
 assert.ok(x.prompt.endsWith('Ink, blue eyes')); assert.equal((x.prompt.match(/blue eyes/gi)||[]).length,1); assert.ok(x.prompt.length<=2000); assert.ok(x.prompt.isWellFormed()); assert.ok(x.truncated.length);
 assert.equal(x.style.key,'chibi'); assert.equal(x.negative,'bad');
 const replay=c.composePrompt(opts,{scene:x.prompt,profiles:[{fixedTags:'blue eyes, red hair'}],selfie:true}); assert.equal(replay.prompt,x.prompt);
 assert.throws(()=>c.composePrompt({...opts,styleTags:'x'.repeat(2001)},{scene:'s'}));
 assert.throws(()=>c.validateStyle({type:'preset',key:'bogus'}));
 assert.throws(()=>c.validateStyle({type:'custom',custom:''}));
 assert.throws(()=>c.validateStyle({type:'custom',custom:'x'.repeat(501)}));
 const h=c.composePrompt({...opts,modelVersionId:'other'},{scene:'s'}); assert.equal(h.style,undefined); assert.ok(h.prompt.includes('Ink'));
 const custom=c.composePrompt({...opts,pixaiStyle:{type:'custom',custom:'x'.repeat(500)}},{scene:'y'.repeat(2000)}); assert.ok(custom.prompt.length<=1498);
});
test('appearance fallback and persona require option plus explicit scene participation', async () => {
 let reads=0; const c=context(['appearanceOf','personaAppearance'],{mfetch:async()=>{reads++;return {ok:true,json:async()=>({appearance:'green hair'})}}});
 assert.equal(c.appearanceOf({data:JSON.stringify({extensions:{appearance:' '},appearance:'blue hair',description:'story'})}).text,'blue hair');
 assert.equal(c.appearanceOf({data:{description:'story'}}).source,'description');
 assert.match(c.appearanceOf({data:{}}).warning,/외모 정보 없음/);
 const chat={personaId:'p'};
 assert.equal(await c.personaAppearance({personaAppearanceEnabled:false},chat,true),''); assert.equal(reads,0);
 assert.equal(await c.personaAppearance({personaAppearanceEnabled:true},chat,false),''); assert.equal(reads,0);
 assert.equal(await c.personaAppearance({personaAppearanceEnabled:true,personaProfiles:{}},chat,true),'green hair'); assert.equal(reads,1);
});
test('supplement repeated by a reviewed override is not appended twice',()=>{
 const c=context(['composePrompt','validateStyle','mergeLoras','parseLoras','cutText'],{STYLE_PRESETS:[],STYLE_MODELS:[]});
 const opts={styleTags:'ink',loras:[]};const input={scene:'park',profiles:[{fixedTags:'red hair'}],appearances:[{source:'appearance',text:'red hair, green eyes'}],selfie:true};
 const first=c.composePrompt(opts,input);const again=c.composePrompt(opts,{...input,scene:first.prompt});assert.equal(again.prompt,first.prompt);
});
test('empty optional protocol lines cannot consume the following selector',()=>{
 const c=context(['parseAgentText','truncatePrompt'],{settings:{aspectRatio:'2:3'},DEFAULTS:{aspectRatio:'2:3'},ASPECT_RATIOS:['2:3'],MAX_PROMPT_CHARS:2000});
 const parsed=c.parseAgentText('PIXAI_PROMPT: scene\nPIXAI_NEGATIVE: \nPIXAI_RATIO: 2:3\nPIXAI_CHARACTERS: ["name"]\nPIXAI_PERSONA: false');assert.equal(parsed.negative,'');assert.equal(parsed.ratio,'2:3');
});
test('35 unique preset names equal the design fixture',()=>{
 const {source}=require('./v2-helpers.cjs');const design=require('node:fs').readFileSync(require('node:path').join(__dirname,'../docs/DESIGN-0.2.0.md'),'utf8');
 const actual=JSON.parse(source.match(/const STYLE_PRESETS = (\[[^\n]+\]);/)[1]);const expected=design.match(/고정 preset allowlist[\s\S]*?```text\n([\s\S]*?)```/)[1].trim().split('\n');
 assert.equal(actual.length,35);assert.equal(new Set(actual).size,35);assert.deepEqual(actual.slice().sort(),expected.sort());
});
