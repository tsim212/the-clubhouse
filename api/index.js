// Vercel serverless entry: every /api/* and /admin request is rewritten here (see vercel.json).
const handler=require('../server.js');
module.exports=(req,res)=>{const u=new URL(req.url,'http://x');const p=u.searchParams.get('__p');
 if(p!==null){u.searchParams.delete('__p');const q=u.searchParams.toString();req.url='/'+p.replace(/^\/+/,'')+(q?'?'+q:'')}
 return handler(req,res)};
