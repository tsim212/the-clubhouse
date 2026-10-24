// Local harness: serve public/ statically like Vercel, route /api/* and /admin through api/index.js with __p rewrite
const http=require('http'),fs=require('fs'),path=require('path');const fn=require('./api/index.js');
http.createServer((req,res)=>{const u=new URL(req.url,'http://x');
 if(u.pathname.startsWith('/api/')||u.pathname==='/admin'){const q=u.search?'&'+u.search.slice(1):'';req.url='/api/index?__p='+encodeURIComponent(u.pathname.slice(1))+q;return fn(req,res)}
 let f=path.join(__dirname,'public',u.pathname==='/'?'index.html':u.pathname);if(!fs.existsSync(f)||fs.statSync(f).isDirectory())f=path.join(__dirname,'public','index.html');
 res.writeHead(200,{'content-type':{'.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.html':'text/html'}[path.extname(f)]||'application/octet-stream'});fs.createReadStream(f).pipe(res)}).listen(4100,()=>console.log('harness :4100'));
