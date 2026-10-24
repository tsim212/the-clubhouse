// The Clubhouse v2 — Node 18+, zero dependencies.
// Env: PORT, ADMIN_PASSWORD (required for /admin), SESSION_SECRET, LEAGUE_ID (1963911), SEASON,
//      ESPN_S2 + ESPN_SWID (optional cookies, only needed for past seasons / if league goes private),
//      UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN (optional free persistent storage; else data/store.json)
const http=require('http'),fs=require('fs'),path=require('path'),crypto=require('crypto');
const PORT=process.env.PORT||3000,LEAGUE=process.env.LEAGUE_ID||'1963911',SEASON=+(process.env.SEASON||new Date(Date.now()-60*864e5).getFullYear());
const SECRET=process.env.SESSION_SECRET||process.env.ADMIN_PASSWORD||'dev-secret-change-me';
const PUB=path.join(__dirname,'public'),DATA=path.join(__dirname,'data');
// ---------- storage (Upstash REST or local file) ----------
const UP=(process.env.UPSTASH_REDIS_REST_URL||process.env.KV_REST_API_URL||'').replace(/\/$/,''),UPT=process.env.UPSTASH_REDIS_REST_TOKEN||process.env.KV_REST_API_TOKEN,FILE=path.join(DATA,'store.json');
const PROD=!!process.env.VERCEL||process.env.NODE_ENV==='production';
const noStore=()=>{throw Error('Storage not configured: set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN')};
async function sget(k){if(UP){const r=await fetch(`${UP}/get/${encodeURIComponent('ch:'+k)}`,{headers:{authorization:`Bearer ${UPT}`}}).then(r=>r.json());return r.result?JSON.parse(r.result):null}
 if(PROD)noStore();try{return JSON.parse(fs.readFileSync(FILE))[k]??null}catch{return null}}
async function sset(k,v){if(UP){if(v===null){await fetch(`${UP}/del/${encodeURIComponent('ch:'+k)}`,{method:'POST',headers:{authorization:`Bearer ${UPT}`}});return}await fetch(`${UP}/set/${encodeURIComponent('ch:'+k)}`,{method:'POST',headers:{authorization:`Bearer ${UPT}`},body:JSON.stringify(v)});return}
 if(PROD)noStore();let d={};try{d=JSON.parse(fs.readFileSync(FILE))}catch{};if(v===null)delete d[k];else d[k]=v;fs.writeFileSync(FILE,JSON.stringify(d,null,1))}
// ---------- auth ----------
const hashPin=(pin,salt)=>crypto.scryptSync(pin,salt,32).toString('hex');
const sign=s=>s+'.'+crypto.createHmac('sha256',SECRET).update(s).digest('base64url');
const unsign=v=>{if(!v)return null;const i=v.lastIndexOf('.'),s=v.slice(0,i);return sign(s)===v?s:null};
const cookies=r=>Object.fromEntries((r.headers.cookie||'').split(';').filter(Boolean).map(s=>{const i=s.indexOf('=');return[s.slice(0,i).trim(),decodeURIComponent(s.slice(i+1))]}));
async function teamsFromCookie(req){const s=unsign(cookies(req).ch_s);if(!s)return[];const[ids,ver]=s.split('|');const out=[];
 for(const t of ids.split(',')){const p=await sget('pin:'+t);if(p&&p.v===ver.split(',')[ids.split(',').indexOf(t)])out.push(t)}return out}
const isAdmin=req=>unsign(cookies(req).ch_admin)==='admin';
const fails={};// simple brute-force throttle per team+ip
// ---------- ESPN ----------
const BASE=`https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${SEASON}/segments/0/leagues/${LEAGUE}`;
const espnHeaders=extra=>({...(process.env.ESPN_S2?{cookie:`espn_s2=${process.env.ESPN_S2}; SWID=${process.env.ESPN_SWID}`}:{}),...extra});
const cache={};async function cached(key,ms,fn){let c=cache[key];if(c&&Date.now()-c.t<ms)return c.v;
 if(UP){try{const r=await fetch(`${UP}/get/${encodeURIComponent('ch:cache:'+key)}`,{headers:{authorization:`Bearer ${UPT}`}}).then(r=>r.json());const sc=r.result&&JSON.parse(r.result);if(sc){cache[key]=c=sc;if(Date.now()-sc.t<ms)return sc.v}}catch{}}
 try{const v=await fn();cache[key]={t:Date.now(),v};if(UP)await fetch(`${UP}/set/${encodeURIComponent('ch:cache:'+key)}?EX=86400`,{method:'POST',headers:{authorization:`Bearer ${UPT}`},body:JSON.stringify(cache[key])}).catch(()=>{});return v}catch(e){if(c)return c.v;throw e}}
async function espn(q,hdr){const r=await fetch(`${BASE}?${q}`,{headers:espnHeaders(hdr)});if(!r.ok)throw Error(r.status===401?'ESPN says this league is private — set ESPN_S2 and ESPN_SWID':'ESPN '+r.status);return r.json()}
const POS={1:'QB',2:'RB',3:'WR',4:'TE',5:'K',16:'D/ST'},SLOT={0:'QB',2:'RB',4:'WR',6:'TE',23:'FLEX',16:'D/ST',17:'K',20:'BE',21:'IR'};
const PRO={0:'FA',1:'ATL',2:'BUF',3:'CHI',4:'CIN',5:'CLE',6:'DAL',7:'DEN',8:'DET',9:'GB',10:'TEN',11:'IND',12:'KC',13:'LV',14:'LAR',15:'MIA',16:'MIN',17:'NE',18:'NO',19:'NYG',20:'NYJ',21:'PHI',22:'ARI',23:'PIT',24:'LAC',25:'SF',26:'SEA',27:'TB',28:'WSH',29:'CAR',30:'JAX',33:'BAL',34:'HOU'};
function shapePlayer(p,week){const st=p.stats||[];const f=(src,per,split)=>st.find(s=>s.statSourceId===src&&s.scoringPeriodId===per&&(split==null||s.statSplitTypeId===split));
 const season=f(0,0,0),proj=f(1,week,1),last=f(0,week-1,1),seasonProj=f(1,0,0);
 const gp=st.filter(s=>s.statSourceId===0&&s.statSplitTypeId===1&&s.scoringPeriodId>0&&s.scoringPeriodId<week&&s.appliedTotal!==undefined).length;
 return{id:p.id,name:p.fullName,pos:POS[p.defaultPositionId]||'?',team:PRO[p.proTeamId]||'',injury:p.injuryStatus||'ACTIVE',injured:!!p.injured,
  slots:(p.eligibleSlots||[]).map(s=>SLOT[s]).filter(Boolean),avg:+(season?.appliedAverage??(gp?(season?.appliedTotal||0)/gp:0)).toFixed(1),
  total:+(season?.appliedTotal||0).toFixed(1),proj:+(proj?.appliedTotal||0).toFixed(1),last:last?+last.appliedTotal.toFixed(1):null,
  seasonProj:+(seasonProj?.appliedTotal||0).toFixed(0),owned:+(p.ownership?.percentOwned||0).toFixed(1),started:+(p.ownership?.percentStarted||0).toFixed(1),
  change:+(p.ownership?.percentChange||0).toFixed(2),outlook:p.outlooks?.outlooksByWeek?.[week]||''}}
async function getLeague(){return cached('league',60e3,async()=>{
 const d=await espn('view=mTeam&view=mRoster&view=mMatchup&view=mSettings&view=mStandings');
 const week=d.scoringPeriodId,members=Object.fromEntries((d.members||[]).map(m=>[m.id,`${(m.firstName||'').trim()} ${(m.lastName||'').trim()}`.trim()]));
 const teams=d.teams.map(t=>({id:String(t.id),name:(t.name||`${t.location} ${t.nickname}`).replace(/\s+/g,' ').trim(),abbrev:t.abbrev,logo:t.logo,ownerId:t.primaryOwner,
  manager:members[t.primaryOwner]||'Manager',wins:t.record.overall.wins,losses:t.record.overall.losses,ties:t.record.overall.ties,pf:+t.record.overall.pointsFor.toFixed(1),
  pa:+t.record.overall.pointsAgainst.toFixed(1),streak:`${t.record.overall.streakType==='WIN'?'W':'L'}${t.record.overall.streakLength}`,seed:t.playoffSeed,moves:t.transactionCounter?.acquisitions||0,
  roster:(t.roster?.entries||[]).map(e=>({slot:SLOT[e.lineupSlotId]||'BE',...shapePlayer(e.playerPoolEntry.player,week)}))}));
 teams.sort((a,b)=>a.seed-b.seed);
 const period=d.status?.currentMatchupPeriod||week;
 const games=d.schedule.filter(m=>m.matchupPeriodId===period).map(m=>({home:String(m.home?.teamId),away:String(m.away?.teamId),hs:+(m.home?.totalPointsLive??m.home?.totalPoints??0).toFixed(1),as:+(m.away?.totalPointsLive??m.away?.totalPoints??0).toFixed(1)}));
 const weekly=d.schedule.filter(m=>m.winner!=='UNDECIDED').map(m=>({week:m.matchupPeriodId,home:String(m.home?.teamId),away:String(m.away?.teamId),hs:m.home?.totalPoints,as:m.away?.totalPoints}));
 return{connected:true,leagueId:LEAGUE,leagueName:d.settings?.name||'League',season:d.seasonId,week,period,teams,games,weekly,updatedAt:Date.now(),
  playoffTeams:d.settings?.scheduleSettings?.playoffTeamCount,slotsNeeded:d.settings?.rosterSettings?.lineupSlotCounts}})}
async function getFreeAgents(week){return cached('fa',10*60e3,async()=>{
 const filt={players:{filterStatus:{value:['FREEAGENT','WAIVERS']},filterSlotIds:{value:[0,2,4,6,16,17]},limit:150,sortPercOwned:{sortPriority:1,sortAsc:false}}};
 const d=await espn(`scoringPeriodId=${week}&view=kona_player_info`,{'x-fantasy-filter':JSON.stringify(filt)});
 return d.players.map(p=>({...shapePlayer({...p.player,ownership:p.player.ownership},week),status:p.status}))})}
let historySeed={history:[],seasons:[]};try{historySeed=JSON.parse(fs.readFileSync(path.join(DATA,'history-seed.json')))}catch{}
// ---------- rule-based coach ----------
const fmt=n=>(+n).toFixed(1);
const BAD=new Set(['OUT','INJURY_RESERVE','SUSPENSION','DOUBTFUL']);
function coach(L,team,fa){const R=team.roster,starters=R.filter(p=>!['BE','IR'].includes(p.slot)),bench=R.filter(p=>p.slot==='BE');
 const val=p=>BAD.has(p.injury)?0:(p.proj||p.avg)*(p.injury==='QUESTIONABLE'?0.85:1);
 const alerts=[],swaps=[];
 for(const s of starters){if(BAD.has(s.injury))alerts.push({level:'now',title:`${s.name} is ${s.injury.replace('_',' ').toLowerCase()}`,body:`He's in your ${s.slot} slot. Swap him out before kickoff or you'll take a zero.`});
  else if(s.injury==='QUESTIONABLE')alerts.push({level:'watch',title:`${s.name} is questionable`,body:`Check the final injury report before his game. Have a backup ready at ${s.slot}.`});
  if(s.proj===0&&!BAD.has(s.injury)&&s.pos!=='D/ST')alerts.push({level:'now',title:`${s.name} has no projection`,body:`That usually means a bye week or he's not expected to play.`})}
 const used=new Set();
 for(const s of [...starters].sort((a,b)=>val(a)-val(b))){const best=bench.filter(b=>!used.has(b.id)&&b.slots.includes(s.slot)&&val(b)>val(s)+1.5).sort((a,b)=>val(b)-val(a))[0];
  if(best){used.add(best.id);swaps.push({out:s,in:best,gain:+(val(best)-val(s)).toFixed(1),why:`${best.name} projects ${fmt(best.proj)} vs ${fmt(s.proj)} for ${s.name}${BAD.has(s.injury)?` (${s.injury.toLowerCase()})`:''}.`})}}
 const projTotal=starters.reduce((a,p)=>a+val(p),0)+swaps.reduce((a,s)=>a+s.gain,0);
 const g=L.games.find(g=>g.home===team.id||g.away===team.id);let matchup=null;
 if(g){const oppId=g.home===team.id?g.away:g.home,opp=L.teams.find(t=>t.id===oppId);if(opp){const oProj=opp.roster.filter(p=>!['BE','IR'].includes(p.slot)).reduce((a,p)=>a+val(p),0);
  matchup={opponent:opp.name,manager:opp.manager,myScore:g.home===team.id?g.hs:g.as,oppScore:g.home===team.id?g.as:g.hs,myProj:+projTotal.toFixed(1),oppProj:+oProj.toFixed(1),
   winPct:Math.round(100/(1+Math.exp(-(projTotal-oProj)/12)))}}}
 // waivers: per position compare best FA to worst rostered at that position
 const waivers=[];
 for(const pos of ['QB','RB','WR','TE','D/ST','K']){const mine=R.filter(p=>p.pos===pos&&p.slot!=='IR').sort((a,b)=>(a.avg+a.proj)-(b.avg+b.proj));const weakest=mine[0];
  const pool=fa.filter(p=>p.pos===pos&&!BAD.has(p.injury)).map(p=>({...p,score:p.proj*0.6+p.avg*0.4+Math.max(0,p.change)*0.3})).sort((a,b)=>b.score-a.score).slice(0,3);
  for(const p of pool){const base=weakest?(weakest.proj*0.6+weakest.avg*0.4):0;if(p.score>base+1||mine.length===0)waivers.push({...p,pos,drop:weakest?weakest.name:null,edge:+(p.score-base).toFixed(1),
   why:`${fmt(p.avg)} pts/game, projects ${fmt(p.proj)} this week${p.change>1?`, +${fmt(p.change)}% rostered this week`:''}${weakest?`. Your weakest ${pos} (${weakest.name}) averages ${fmt(weakest.avg)}.`:'.'}`})}}
 waivers.sort((a,b)=>b.edge-a.edge);
 // position strength vs league
 const strength=['QB','RB','WR','TE'].map(pos=>{const top=t=>t.roster.filter(p=>p.pos===pos).map(p=>p.avg).sort((a,b)=>b-a).slice(0,pos==='RB'||pos==='WR'?2:1).reduce((a,b)=>a+b,0);
  const all=L.teams.map(top).sort((a,b)=>b-a),mine=top(team);return{pos,rank:all.indexOf(mine)+1,of:all.length,pts:+mine.toFixed(1)}});
 // trade idea: my deepest position surplus vs team weakest where I am weak
 const weakPos=[...strength].sort((a,b)=>b.rank-a.rank)[0],strongPos=[...strength].sort((a,b)=>a.rank-b.rank)[0];let trade=null;
 if(weakPos.rank-strongPos.rank>=3){const partner=L.teams.filter(t=>t.id!==team.id).map(t=>({t,s:t.roster.filter(p=>p.pos===weakPos.pos).sort((a,b)=>b.avg-a.avg)}))
  .map(o=>({...o,need:o.t.roster.filter(p=>p.pos===strongPos.pos).reduce((a,p)=>a+p.avg,0)})).sort((a,b)=>a.need-b.need)[0];
  const give=R.filter(p=>p.pos===strongPos.pos&&p.slot==='BE').sort((a,b)=>b.avg-a.avg)[0]||R.filter(p=>p.pos===strongPos.pos).sort((a,b)=>a.avg-b.avg)[0];
  const get=partner?.s.find(p=>Math.abs(p.avg-(give?.avg||0))<5)||partner?.s[1];
  if(partner&&give&&get)trade={partner:partner.t.name,manager:partner.t.manager,give,get,why:`You rank #${strongPos.rank} at ${strongPos.pos} but #${weakPos.rank} at ${weakPos.pos}. ${partner.t.name} is thin at ${strongPos.pos}.`}}
 return{week:L.week,team:{id:team.id,name:team.name,manager:team.manager},matchup,alerts,swaps,waivers:waivers.slice(0,8),strength,trade,
  roster:R.map(p=>({...p,value:+val(p).toFixed(1)}))}}
// ---------- history ----------
async function getHistory(L){return cached('hist',6*3600e3,async()=>{
 const rows=JSON.parse(JSON.stringify(historySeed.history));
 for(const t of L.teams){let r=rows.find(r=>r.ownerId===t.ownerId);if(!r){r={ownerId:t.ownerId,team:t.name,manager:t.manager,wins:0,losses:0,ties:0,titles:0,playoffs:0,seasons:0,moves:0,seasonLines:[]};rows.push(r)}
  r.team=t.name;r.seasonLines=r.seasonLines.filter(l=>l.year!==L.season);r.seasonLines.push({year:L.season,wins:t.wins,losses:t.losses,ties:t.ties,pointsFor:t.pf,pointsAgainst:t.pa,finish:t.seed,moves:t.moves,current:true});
  const s=r.seasonLines;r.wins=s.reduce((a,l)=>a+l.wins,0);r.losses=s.reduce((a,l)=>a+l.losses,0);r.seasons=s.length;r.moves=s.reduce((a,l)=>a+(l.moves||0),0)}
 return rows.filter(r=>L.teams.some(t=>t.ownerId===r.ownerId)).sort((a,b)=>b.titles-a.titles||(b.wins/(b.wins+b.losses||1))-(a.wins/(a.wins+a.losses||1)))})}
// ---------- http ----------
const json=(res,c,o,h={})=>{res.writeHead(c,{'content-type':'application/json','cache-control':'no-store',...h});res.end(JSON.stringify(o))};
const body=r=>new Promise(ok=>{let b='';r.on('data',c=>{b+=c;if(b.length>1e5)r.destroy()});r.on('end',()=>{try{ok(JSON.parse(b||'{}'))}catch{ok({})}})});
const SECURE=process.env.NODE_ENV==='production'?'; Secure':'';
async function handler(req,res){try{const u=new URL(req.url,'http://x'),p=u.pathname,M=req.method;
 if(p==='/api/health')return json(res,200,{ok:true,storage:UP?'upstash':PROD?'MISSING':'file'});
 if(p==='/api/league'){const L=await getLeague();const hist=await getHistory(L);
  return json(res,200,{...L,teams:L.teams.map(({roster,...t})=>({...t,topPlayers:roster.filter(p=>p.slot!=='BE'&&p.slot!=='IR').sort((a,b)=>b.avg-a.avg).slice(0,3).map(p=>p.name)})),history:hist,seasons:[...new Set([...historySeed.seasons,L.season])]})}
 if(p==='/api/news'){const d=await cached('news',15*60e3,()=>fetch('https://site.api.espn.com/apis/site/v2/sports/football/nfl/news?limit=25').then(r=>r.json()));
  const L=await getLeague().catch(()=>null);const names=new Set((L?.teams||[]).flatMap(t=>t.roster.map(p=>p.name)));const team=u.searchParams.get('team');const mine=new Set(team&&L?L.teams.find(t=>t.id===team)?.roster.map(p=>p.name)||[]:[]);
  return json(res,200,{articles:(d.articles||[]).map(a=>{const ppl=(a.categories||[]).filter(c=>c.type==='athlete').map(c=>c.description);return{headline:a.headline,description:a.description,url:a.links?.web?.href,published:a.published,image:a.images?.[0]?.url,
   players:ppl.filter(n=>names.has(n)),mine:ppl.some(n=>mine.has(n))}})})}
 if(p==='/api/team-access'&&M==='GET'){const t=u.searchParams.get('team');const mine=await teamsFromCookie(req);return json(res,200,{claimed:!!(await sget('pin:'+t)),authorized:mine.includes(t)})}
 if(p==='/api/team-access'&&M==='POST'){const{team,pin}=await body(req);const L=await getLeague();if(!L.teams.some(t=>t.id===String(team)))return json(res,404,{error:'Unknown team.'});
  if(!/^\d{4}$/.test(pin||''))return json(res,400,{error:'Enter exactly four numbers.'});
  const key=team+'|'+(req.headers['x-forwarded-for']||req.socket.remoteAddress);const f=fails[key];if(f&&f.n>=5&&Date.now()-f.t<15*60e3)return json(res,429,{error:'Too many tries. Wait 15 minutes or ask the commissioner.'});
  let rec=await sget('pin:'+team),created=false;
  if(!rec){const salt=crypto.randomBytes(12).toString('hex');rec={salt,hash:hashPin(pin,salt),v:crypto.randomBytes(4).toString('hex'),claimedAt:Date.now()};await sset('pin:'+team,rec);created=true;
   const log=(await sget('log'))||[];log.unshift({t:Date.now(),team,event:'claimed'});await sset('log',log.slice(0,200))}
  else if(!crypto.timingSafeEqual(Buffer.from(rec.hash,'hex'),Buffer.from(hashPin(pin,rec.salt),'hex'))){fails[key]={n:(f&&Date.now()-f.t<15*60e3?f.n:0)+1,t:Date.now()};return json(res,401,{error:'That code did not work.'})}
  delete fails[key];
  // keep any other teams this phone has unlocked (commissioner may unlock several)
  const s=unsign(cookies(req).ch_s);let ids=[],vers=[];if(s){[ids,vers]=s.split('|').map(x=>x.split(','));}
  const i=ids.indexOf(String(team));if(i>=0){ids.splice(i,1);vers.splice(i,1)}ids.push(String(team));vers.push(rec.v);
  return json(res,200,{ok:true,created},{'set-cookie':`ch_s=${encodeURIComponent(sign(ids.join(',')+'|'+vers.join(',')))}; HttpOnly; Path=/; SameSite=Lax; Max-Age=31536000${SECURE}`})}
 if(p==='/api/logout'&&M==='POST')return json(res,200,{ok:true},{'set-cookie':'ch_s=; Path=/; Max-Age=0'});
 if(p==='/api/coach'||p==='/api/decisions'){const t=u.searchParams.get('team')||(M==='POST'?null:'');const mine=await teamsFromCookie(req);
  if(p==='/api/coach'){if(!mine.includes(t))return json(res,401,{error:'Enter this team’s code first.'});const L=await getLeague();const team=L.teams.find(x=>x.id===t);
   const fa=await getFreeAgents(L.week).catch(()=>[]);return json(res,200,coach(L,team,fa))}
  if(M==='GET'){if(!mine.includes(t))return json(res,401,{error:'Unlock this team first.'});return json(res,200,(await sget('notes:'+t))||[])}
  const b=await body(req);if(!mine.includes(String(b.team)))return json(res,401,{error:'Unlock this team first.'});const list=(await sget('notes:'+b.team))||[];
  if(b.delete){await sset('notes:'+b.team,list.filter(n=>n.id!==b.delete));return json(res,200,{ok:true})}
  const n={id:crypto.randomBytes(5).toString('hex'),t:Date.now(),week:b.week||null,kind:String(b.kind||'note').slice(0,20),text:String(b.text||'').slice(0,1000),outcome:String(b.outcome||'').slice(0,200)};
  if(!n.text.trim())return json(res,400,{error:'Write something first.'});list.unshift(n);await sset('notes:'+b.team,list.slice(0,300));return json(res,200,n)}
 // ---- admin ----
 if(p==='/api/admin/login'&&M==='POST'){const{password}=await body(req);const ap=process.env.ADMIN_PASSWORD;
  if(!ap)return json(res,503,{error:'ADMIN_PASSWORD is not set on the server.'});
  const a=crypto.createHash('sha256').update(String(password||'')).digest(),b=crypto.createHash('sha256').update(ap).digest();
  if(!crypto.timingSafeEqual(a,b)){await new Promise(r=>setTimeout(r,800));return json(res,401,{error:'Wrong password.'})}
  return json(res,200,{ok:true},{'set-cookie':`ch_admin=${encodeURIComponent(sign('admin'))}; HttpOnly; Path=/; SameSite=Strict; Max-Age=2592000${SECURE}`})}
 if(p.startsWith('/api/admin/')&&!isAdmin(req))return json(res,401,{error:'Admin login required.'});
 if(p==='/api/admin/teams'){const L=await getLeague();const out=[];for(const t of L.teams){const r=await sget('pin:'+t.id);out.push({id:t.id,name:t.name,manager:t.manager,claimed:!!r,claimedAt:r?.claimedAt||null,resetAt:r?.resetAt||null})}
  return json(res,200,{teams:out,log:((await sget('log'))||[]).slice(0,30),storage:UP?'Upstash Redis':'local file',espnCookie:!!process.env.ESPN_S2})}
 if(p==='/api/admin/reset-pin'&&M==='POST'){const{team}=await body(req);await sset('pin:'+team,null);const log=(await sget('log'))||[];log.unshift({t:Date.now(),team:String(team),event:'reset by admin'});await sset('log',log.slice(0,200));return json(res,200,{ok:true})}
 if(p==='/api/admin/logout'&&M==='POST')return json(res,200,{ok:true},{'set-cookie':'ch_admin=; Path=/; Max-Age=0'});
 // ---- static ----
 let f=p==='/admin'?'admin.html':p==='/'?'index.html':p.slice(1);f=path.join(PUB,path.normalize(f));
 if(!f.startsWith(PUB)||!fs.existsSync(f)||fs.statSync(f).isDirectory())f=path.join(PUB,'index.html');
 const ext={'.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.html':'text/html; charset=utf-8','.webmanifest':'application/manifest+json','.png':'image/png'}[path.extname(f)]||'application/octet-stream';
 res.writeHead(200,{'content-type':ext,'cache-control':ext.startsWith('text/html')?'no-cache':'public, max-age=3600'});fs.createReadStream(f).pipe(res)}
catch(e){console.error(e);json(res,502,{error:e.message})}}
module.exports=handler;
if(require.main===module)http.createServer(handler).listen(PORT,()=>console.log(`Clubhouse on :${PORT} season ${SEASON} league ${LEAGUE}`));
