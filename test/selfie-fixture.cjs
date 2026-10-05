// All transport responses are synthetic; browser routes also deny real network.
function installFixture() {
 window.saved={enabled:false,rememberKey:true,apiKey:'synthetic-pixai',characterProfiles:{char:{displayName:'Adult fixture',aliases:[],fixedTags:'red hair',loras:[]}}};
 window.calls=[];window.logs=[];window.confirm=()=>true;
 window.original=async function(url,init={}) {
  url=String(url);window.calls.push({url,method:init.method||'GET',headers:Object.fromEntries(new Headers(init.headers)),body:typeof init.body==='string'?init.body:undefined,model:init.body instanceof FormData?init.body.get('model'):undefined});
  if(url==='/api/chats/chat')return Response.json({id:'chat',mode:'conversation',characterIds:['char']});
  if(url==='/api/characters/char')return Response.json({id:'char',data:{name:'Adult fixture',extensions:{appearance:'red hair'},description:'adult synthetic fixture'}});
  if(url==='/api/agents')return Response.json([{id:'director',name:'PixAI Director',type:'custom-fixture',settings:{contextSources:{persona:false}}}]);
  if(url.includes('/agents/runs/'))return Response.json([]);
  if(url.endsWith('/v2/task/0'))return new Response('',{status:404});
  if(url.endsWith('/v2/image/create')){if(window.createGate)await window.createGate;return Response.json({id:'task'});}
  if(url.endsWith('/v2/task/task'))return Response.json({status:'completed',outputs:{mediaUrls:['https://d2doj8oszwtcqy.cloudfront.net/synthetic.png']}});
  if(url.includes('cloudfront.net/'))return new Response('synthetic-image',{headers:{'Content-Type':'image/png'}});
  if(url==='/api/gallery/chat/upload')return Response.json({id:'gallery',chatId:'chat',filePath:'chat/synthetic.png',prompt:init.body.get('prompt'),provider:'pixai',model:init.body.get('model'),width:null,height:null,createdAt:'2026-10-05T00:00:00Z',url:'/api/gallery/file/chat/synthetic.png'});
  if(url.includes('/selfie') || url.includes('/generate'))return Response.json({original:true});
  throw new Error('Unexpected synthetic route');
 };
 window.fetch=window.original;
 window.marinara={storage:{get:async()=>structuredClone(window.saved),patch:async p=>{if(window.failStorage)throw new Error('synthetic storage failure');Object.assign(window.saved,structuredClone(p));}},fetch:(...args)=>window.fetch(...args),log:Object.fromEntries(['info','error','warn'].map(k=>[k,(...v)=>window.logs.push(v)])),setInterval:()=>1,clearInterval(){},setTimeout:fn=>setTimeout(fn,0),clearTimeout};
}
module.exports={installFixture};
