// Draft Review, Draft Prep, Trade Analyzer, Power Rankings/Luck, Waiver Report Card. Public ESPN data only (no PINs/admin data).
module.exports=function(C){const{espnHeaders,cached,getLeague,LEAGUE,SEASON,POS,PRO,historySeed}=C;
const base=s=>`https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${s}/segments/0/leagues/${LEAGUE}`;
async function E(s,q,h){const r=await fetch(`${base(s)}?${q}`,{headers:espnHeaders(h)});if(!r.ok){const e=Error(r.status===401?`ESPN keeps the ${s} season private. The commissioner can unlock past seasons by adding ESPN_S2 and ESPN_SWID login cookies on the server.`:'ESPN '+r.status);e.code=r.status;throw e}return r.json()}
const r1=n=>+(+n||0).toFixed(1);
const shape=(p,s)=>{const st=p.stats||[],f=(src,per,sp)=>st.find(x=>x.statSourceId===src&&x.scoringPeriodId===per&&x.statSplitTypeId===sp&&(!x.seasonId||x.seasonId===s));
 const t=f(0,0,0),pj=f(1,0,0);return{id:p.id,name:p.fullName,pos:POS[p.defaultPositionId]||'?',team:PRO[p.proTeamId]||'',pts:r1(t?.appliedTotal),avg:r1(t?.appliedAverage),proj:r1(pj?.appliedTotal),injury:p.injuryStatus||'ACTIVE',adp:+(p.ownership?.averageDraftPosition||0).toFixed(1),ranks:Object.fromEntries(Object.entries(p.draftRanksByRankType||{}).map(([k,v])=>[k,v.rank]))}};
async function players(s,ids){return cached('pl2-'+s,s<SEASON?7*864e5:30*60e3,async()=>{const sid='00'+s,tf={value:2,additionalValue:[sid,'10'+s]};
 const top=await E(s,'scoringPeriodId=0&view=kona_player_info',{'x-fantasy-filter':JSON.stringify({players:{filterSlotIds:{value:[0,2,4,6,16,17]},limit:700,sortAppliedStatTotal:{sortAsc:false,sortPriority:1,value:sid},filterStatsForTopScoringPeriodIds:tf}})});
 const m={};for(const e of top.players)m[e.id]=shape(e.player,s);const miss=ids.filter(i=>!m[i]);
 if(miss.length){const d=await E(s,'scoringPeriodId=0&view=kona_player_info',{'x-fantasy-filter':JSON.stringify({players:{filterIds:{value:miss},limit:miss.length,sortAppliedStatTotal:{sortAsc:false,sortPriority:1,value:sid},filterStatsForTopScoringPeriodIds:tf}})}).catch(()=>({players:[]}));for(const e of d.players)m[e.id]=shape(e.player,s)}
 // positional rank among everyone
 const by={};for(const p of Object.values(m))(by[p.pos]=by[p.pos]||[]).push(p);for(const k in by)by[k].sort((a,b)=>b.pts-a.pts).forEach((p,i)=>p.posRank=i+1);return m})}
// Decision = pick vs pre-draft consensus (ESPN ADP; PPR/STANDARD preseason rank as fallback). Outcome = points vs slot, kept separate.
async function draft(s){return cached('draft3-'+s,s<SEASON?7*864e5:30*60e3,async()=>{
 const d=await E(s,'view=mDraftDetail&view=mTeam&view=mSettings');if(!d.draftDetail?.drafted)throw Error(`The ${s} draft hasn't happened yet.`);
 const ppr=(d.settings?.scoringSettings?.scoringItems||[]).some(x=>x.statId===53&&x.points>0),rankType=ppr?'PPR':'STANDARD',need=d.settings?.rosterSettings?.lineupSlotCounts||{};
 const members=Object.fromEntries((d.members||[]).map(m=>[m.id,`${(m.firstName||'').trim()} ${(m.lastName||'').trim()}`.trim()]));
 const teams=Object.fromEntries(d.teams.map(t=>[String(t.id),{id:String(t.id),ownerId:t.primaryOwner,name:(t.name||`${t.location} ${t.nickname}`).replace(/\s+/g,' ').trim(),manager:members[t.primaryOwner]||''}]));
 const raw=d.draftDetail.picks.filter(p=>p.playerId>0);const P=await players(s,raw.map(p=>p.playerId)),n=Object.keys(teams).length;
 const picks=raw.map(p=>{const pl=P[p.playerId]||{id:p.playerId,name:'Player '+p.playerId,pos:'?',pts:0,posRank:999};const rk=pl.ranks?.[rankType];
  const adp=pl.adp>0?pl.adp:null,cons=adp||rk||null;return{...pl,pro:pl.team,overall:p.overallPickNumber,round:p.roundId,pick:p.roundPickNumber,team:String(p.teamId),keeper:p.keeper,adp,rank:rk||null,cons,src:adp?'ADP':rk?rankType+' rank':null}}).sort((a,b)=>a.overall-b.overall);
 // ESPN's raw ADP runs late vs a 12-team draft (all leagues, all sizes), so convert it to a consensus slot within this draft: the Nth-lowest ADP among drafted players = pick N.
 [...picks].filter(p=>p.cons).sort((a,b)=>a.cons-b.cons).forEach((p,i)=>{p.rawCons=p.cons;p.cons=i+1});
 const rounds=Math.max(...picks.map(p=>p.round));
 const sorted={};for(const p of Object.values(P))(sorted[p.pos]=sorted[p.pos]||[]).push(p.pts);for(const k in sorted)sorted[k].sort((a,b)=>b-a);
 const cnt={};for(const p of picks){cnt[p.pos]=(cnt[p.pos]||0)+1;p.slotRank=cnt[p.pos];p.expected=r1((sorted[p.pos]||[])[p.slotRank-1]||0);p.value=r1(p.pts-p.expected)}
 // QB/TE depth at the moment of each pick (consensus-top-N still on the board)
 const posCons={};for(const p of Object.values(P))if(p.adp>0||p.ranks?.[rankType])(posCons[p.pos]=posCons[p.pos]||[]).push(p);for(const k in posCons)posCons[k].sort((a,b)=>(a.adp||a.ranks[rankType])-(b.adp||b.ranks[rankType]));
 const takenBy=new Map(picks.map(p=>[p.id,p.overall]));
 for(const p of picks){const tol=Math.max(n*0.75,p.overall*0.2);p.delta=p.cons?r1(p.overall-p.cons):null;p.flags=[];
  if(p.cons&&p.overall<p.cons-tol)p.flags.push({t:'reach',bad:true,text:`Reach: taken #${p.overall}, consensus ${p.src} slot ${Math.round(p.cons)}`});
  if(p.cons&&p.overall>p.cons+tol)p.flags.push({t:'value',bad:false,text:`Value: fell to #${p.overall} (${p.src} slot ${Math.round(p.cons)})`});
  if(['K','D/ST'].includes(p.pos)&&p.round<rounds-1)p.flags.push({t:'kdef',bad:true,text:`${p.pos==='K'?'Kicker':'Defense'} before the last two rounds`});
  if(['QB','TE'].includes(p.pos)&&p.round<=6){const left=(posCons[p.pos]||[]).slice(0,n).filter(q=>q.id!==p.id&&(takenBy.get(q.id)||1e9)>p.overall).length;p.depthLeft=left;
   if(left>=Math.ceil(n/2)&&!(p.delta>0))p.flags.push({t:'depth',bad:true,text:`${left} of the consensus top-${n} ${p.pos}s were still available — ${p.pos} could wait`})}}
 const out={};for(const id in teams){const mine=picks.filter(p=>p.team===id);const have={},filled=()=>['0','2','4','6'].every(s=>(have[s]||0)>=(need[s]||0))&&((have[2]||0)+(have[4]||0)+(have[6]||0)>=(need[2]||0)+(need[4]||0)+(need[6]||0)+(need[23]||0));
  const slotOf={QB:'0',RB:'2',WR:'4',TE:'6','D/ST':'16',K:'17'};
  for(const p of mine){const s=slotOf[p.pos];if(['QB','TE','K','D/ST'].includes(p.pos)&&(have[s]||0)>=(need[s]||1)&&!filled())p.flags.push({t:'backup',bad:true,text:`Backup ${p.pos} taken before your starting lineup was filled`});
   if(p.pos==='RB'&&mine.some(q=>q.overall<p.overall&&q.pos==='RB'&&q.pro===p.pro&&p.pro))p.flags.push({t:'cuff',bad:null,text:`Handcuff to your ${mine.find(q=>q.overall<p.overall&&q.pos==='RB'&&q.pro===p.pro).name} (${p.pro})`});
   have[s]=(have[s]||0)+1;
   const w=1/Math.sqrt(p.round),dv=p.delta==null?0:Math.max(-3,Math.min(3,p.delta/n));p.decision=+(w*dv-p.flags.filter(f=>f.bad).length*0.4*w).toFixed(2);
   const goodDec=!p.flags.some(f=>f.bad),goodOut=p.value>=0;p.verdict=goodDec?(goodOut?'Good pick':'Bad luck'):(goodOut?'Lucky':'Bad pick')}
  const six=mine.filter(p=>p.round<=6),c=k=>six.filter(p=>p.pos===k).length,imb=[];
  if(Math.abs(c('RB')-c('WR'))>=3)imb.push(`${c('RB')} RB vs ${c('WR')} WR in rounds 1–6`);if(c('RB')===0)imb.push('no RB in rounds 1–6');if(c('WR')===0)imb.push('no WR in rounds 1–6');
  out[id]={...teams[id],picks:mine,imbalance:imb,decisionScore:+mine.reduce((a,p)=>a+p.decision,0).toFixed(2)-imb.length*0.5,score:r1(mine.filter(p=>p.round<=Math.ceil(rounds*0.6)).reduce((a,p)=>a+p.value,0)),total:r1(mine.reduce((a,p)=>a+p.pts,0)),
   reaches:mine.filter(p=>p.flags.some(f=>f.bad)).sort((a,b)=>a.decision-b.decision).slice(0,5),values:mine.filter(p=>p.flags.some(f=>f.t==='value')).sort((a,b)=>b.delta-a.delta).slice(0,4),
   badLuck:mine.filter(p=>p.verdict==='Bad luck'&&p.round<=rounds*0.75).sort((a,b)=>a.value-b.value).slice(0,4),
   avgReach:r1(mine.filter(p=>p.delta!=null&&p.round<=10).reduce((a,p,_,A)=>a+p.delta/A.length,0))}
  out[id].lessons=lessons(out[id],rounds,n)}
 const G=['A','A-','B+','B','B-','C+','C','C-','D+','D','D-','F'],grade=(arr,k,g)=>arr.sort((a,b)=>b[k]-a[k]).forEach((t,i)=>{t[g]=G[Math.min(11,Math.round(i*11/Math.max(1,arr.length-1)))];t[g+'Rank']=i+1});
 grade(Object.values(out),'score','outcomeGrade');const ranked=Object.values(out);grade(ranked,'decisionScore','grade');
 const runs=[];for(let i=0;i+5<=picks.length;i++){const w=picks.slice(i,i+5),c={};w.forEach(p=>c[p.pos]=(c[p.pos]||0)+1);const pos=Object.keys(c).find(k=>c[k]>=4);if(!pos)continue;
  const last=runs.at(-1);if(last&&last.pos===pos&&last.to>=w[0].overall-1){last.to=Math.max(last.to,w.at(-1).overall);continue}runs.push({pos,from:w[0].overall,to:w.at(-1).overall})}
 runs.forEach(r=>{const ps=picks.filter(p=>p.overall>=r.from&&p.overall<=r.to&&p.pos===r.pos);r.from=ps[0].overall;r.to=ps.at(-1).overall;r.round=ps[0].round;r.players=ps.map(p=>p.name);r.avgDelta=r1(ps.reduce((a,p)=>a+(p.delta||0),0)/ps.length);r.avgValue=r1(ps.reduce((a,p)=>a+p.value,0)/ps.length)});
 const tn=p=>({...p,teamName:teams[p.team]?.name});const withC=picks.filter(p=>p.delta!=null);
 return{season:s,complete:s<SEASON,rankSource:`ESPN average draft position (kona_player_info ownership.averageDraftPosition), re-ranked among the players actually drafted to give each a consensus pick slot; ESPN ${rankType} preseason rank (draftRanksByRankType.${rankType}) only where ADP is missing`,
  coverage:`${withC.filter(p=>p.src==='ADP').length} of ${picks.length} picks had ADP, ${withC.filter(p=>p.src!=='ADP').length} used rank, ${picks.length-withC.length} had neither`,
  teams:out,order:ranked.map(t=>t.id),bestValues:[...withC].sort((a,b)=>b.delta-a.delta).slice(0,8).map(tn),worstReaches:[...withC].filter(p=>p.round<rounds-1||['K','D/ST'].includes(p.pos)).sort((a,b)=>a.delta-b.delta).slice(0,8).map(tn),
  best:[...picks].sort((a,b)=>b.value-a.value).slice(0,6).map(tn),worst:[...picks].filter(p=>p.round<=rounds*0.75).sort((a,b)=>a.value-b.value).slice(0,6).map(tn),runs,rounds,prep:prep(picks,P,teams,rounds,n)}})}
function lessons(t,rounds,n){const L=[],m=t.picks,f=k=>m.filter(p=>p.flags.some(x=>x.t===k));
 const kd=f('kdef');if(kd.length)L.push({bad:true,text:`You spent ${kd.map(p=>`round ${p.round} on ${p.pos==='K'?'a kicker':'a defense'} (${p.name})`).join(' and ')}. Kickers and defenses are nearly interchangeable and streamable — always take them in the last two rounds.`});
 const dp=f('depth');for(const p of dp)L.push({bad:true,text:`${p.pos} in round ${p.round} (${p.name}) when ${p.depthLeft} consensus-starting ${p.pos}s were still on the board. With that depth, the logical move was RB/WR there and a ${p.pos} later.`});
 const re=f('reach').filter(p=>p.round<=8);if(re.length)L.push({bad:true,text:`Reaches vs ADP: ${re.map(p=>`${p.name} (#${p.overall}, ADP slot ${Math.round(p.cons)})`).join('; ')}. You could likely have gotten ${re.length>1?'them':'him'} a round later and taken the best player available.`});
 const bk=f('backup');if(bk.length)L.push({bad:true,text:`You took a backup ${[...new Set(bk.map(p=>p.pos))].join('/')} (${bk.map(p=>`${p.name}, rd ${p.round}`).join('; ')}) before filling every starting spot.`});
 const cf=f('cuff');if(cf.length)L.push({bad:null,text:`Handcuff${cf.length>1?'s':''}: ${cf.map(p=>p.name).join(', ')}. Fine as a late-round insurance policy; costly before round 10.`});
 if(t.imbalance.length)L.push({bad:true,text:`Roster balance: ${t.imbalance.join(', ')}. Starting lineups need both — imbalance forces weak starters or trades.`});
 const va=t.values;if(va.length)L.push({bad:false,text:`Good discipline letting value come to you: ${va.map(p=>`${p.name} (#${p.overall}, ADP slot ${Math.round(p.cons)})`).join('; ')}.`});
 const bl=t.badLuck;if(bl.length)L.push({bad:false,luck:true,text:`Bad luck, not bad picks: ${bl.map(p=>`${p.name} (rd ${p.round}, ADP ${p.cons?Math.round(p.cons):'?'})`).join(', ')} ${bl.length>1?'were':'was'} taken at or after consensus. Same process next year is fine — just diversify so one injury doesn't sink a position.`});
 if(t.avgReach<-n/2)L.push({bad:true,text:`On average you picked ${Math.abs(t.avgReach)} spots ahead of ADP in rounds 1–10. Trust the board more — let your target fall to you.`});
 return L}
function prep(picks,P,teams,rounds,n){const drafted=new Map(picks.map(p=>[p.id,p]));const out={};
 for(const pos of['QB','RB','WR','TE','D/ST','K']){const all=Object.values(P).filter(p=>p.pos===pos).sort((a,b)=>b.pts-a.pts);
  const breakouts=all.slice(0,40).map(p=>{const d=drafted.get(p.id);return{name:p.name,pts:p.pts,posRank:p.posRank,cost:d?`Rd ${d.round} (#${d.overall})`:'Undrafted',adp:p.adp>0?r1(p.adp):null,value:d?d.value:r1(p.pts-(all[11]?.pts||0)),undrafted:!d}}).filter(p=>p.undrafted?p.posRank<=15:p.value>0).sort((a,b)=>b.value-a.value).slice(0,5);
  const busts=picks.filter(p=>p.pos===pos&&p.round<=rounds*0.6).sort((a,b)=>a.value-b.value).slice(0,4).map(p=>({name:p.name,pts:p.pts,posRank:p.posRank,cost:`Rd ${p.round} (#${p.overall})`,adp:p.cons?Math.round(p.cons):null,value:p.value,verdict:p.verdict}));
  const tier=(a,b)=>r1(all.slice(a,b).reduce((x,p)=>x+p.pts,0)/Math.max(1,all.slice(a,b).length));
  const byRound=[[1,3],[4,7],[8,rounds]].map(([a,b])=>{const ps=picks.filter(p=>p.pos===pos&&p.round>=a&&p.round<=b);return{rounds:`${a}–${b}`,n:ps.length,avgValue:ps.length?r1(ps.reduce((x,p)=>x+p.value,0)/ps.length):null}});
  const ps=picks.filter(p=>p.pos===pos&&p.delta!=null);out[pos]={breakouts,busts,top3:tier(0,3),mid:tier(9,12),drop:r1(tier(0,3)-tier(9,12)),byRound,reachRate:ps.length?Math.round(100*ps.filter(p=>p.flags.some(f=>f.t==='reach'||f.t==='kdef')).length/ps.length):null,avgDelta:ps.length?r1(ps.reduce((a,p)=>a+p.delta,0)/ps.length):null}}
 const scar=Object.entries(out).filter(([k])=>['QB','RB','WR','TE'].includes(k)).sort((a,b)=>b[1].drop-a[1].drop);
 const most=Object.entries(out).filter(([,v])=>v.reachRate!=null).sort((a,b)=>b[1].reachRate-a[1].reachRate)[0];
 const tips=[`Biggest elite-vs-average gap: ${scar[0][0]} (top-3 average ${scar[0][1].top3} pts vs ${scar[0][1].mid} for #10–12). Paying ADP for an elite ${scar[0][0]} is a logical bet.`,
  `Smallest gap: ${scar.at(-1)[0]} (${scar.at(-1)[1].drop} pts between tiers) — wait there; the drop-off is small.`,
  most?`This league reaches most at ${most[0]} (${most[1].reachRate}% of picks went well ahead of ADP). Expect it again, but don't join the panic — take the value that falls.`:null].filter(Boolean);
 return{positions:out,tips}}
// ---------------- multi-year tendencies (needs every season ESPN will give us) ----------------
async function tendencies(){return cached('tend1',6*3600e3,async()=>{const seasons=[...new Set([...(historySeed.seasons||[]),SEASON])].sort((a,b)=>a-b);const got=[],missing=[];
 for(const s of seasons){try{got.push(await draft(s))}catch(e){missing.push({season:s,reason:e.message})}}
 const fin={};for(const r of historySeed.history||[])for(const l of r.seasonLines||[])fin[r.ownerId+'|'+l.year]=l;
 const M={};for(const d of got)for(const t of Object.values(d.teams)){const k=t.ownerId||t.manager;const m=M[k]=M[k]||{ownerId:t.ownerId,manager:t.manager,teamNames:new Set(),years:[]};m.teamNames.add(t.name);
  const first=pos=>t.picks.find(p=>p.pos===pos)?.round||null,early=t.picks.filter(p=>p.round<=8);
  m.years.push({season:d.season,team:t.name,teamId:t.id,r13:t.picks.filter(p=>p.round<=3).map(p=>p.pos),firstQB:first('QB'),firstTE:first('TE'),firstK:first('K'),firstDST:first('D/ST'),avgReach:t.avgReach,
   rb:early.filter(p=>p.pos==='RB').length,wr:early.filter(p=>p.pos==='WR').length,pros:t.picks.map(p=>p.pro).filter(Boolean),players:t.picks.map(p=>p.name),grade:t.grade,finish:fin[t.ownerId+'|'+d.season]?.finish||null,wins:fin[t.ownerId+'|'+d.season]?.wins})}
 const avg=a=>{a=a.filter(x=>x!=null);return a.length?r1(a.reduce((x,y)=>x+y,0)/a.length):null};
 const rows=Object.values(M).map(m=>{const Y=m.years,cnt=a=>Object.entries(a.reduce((o,x)=>(o[x]=(o[x]||0)+1,o),{})).sort((a,b)=>b[1]-a[1]);
  const rb=avg(Y.map(y=>y.rb)),wr=avg(Y.map(y=>y.wr));const repeat=cnt(Y.flatMap(y=>[...new Set(y.players)])).filter(([,c])=>c>=2).slice(0,6);
  const fav=cnt(Y.flatMap(y=>y.pros)).slice(0,3).map(([k,c])=>({team:k,n:c,share:Math.round(100*c/Y.flatMap(y=>y.pros).length)}));
  const done=Y.filter(y=>y.finish&&y.season<SEASON);const corr=[];
  if(done.length>=3){const good=done.filter(y=>y.finish<=4),bad=done.filter(y=>y.finish>8);const f=(A,k)=>avg(A.map(y=>y[k]));
   if(good.length&&bad.length){corr.push(`Top-4 finishes: avg first QB round ${f(good,'firstQB')}, ${f(good,'rb')} RB / ${f(good,'wr')} WR in rds 1–8, ADP reach ${f(good,'avgReach')}.`);corr.push(`Bottom finishes: first QB round ${f(bad,'firstQB')}, ${f(bad,'rb')} RB / ${f(bad,'wr')} WR, ADP reach ${f(bad,'avgReach')}.`)}}
  return{ownerId:m.ownerId,manager:m.manager,teamNames:[...m.teamNames],seasons:Y.map(y=>y.season),years:Y,r13:cnt(Y.flatMap(y=>y.r13)),firstQB:avg(Y.map(y=>y.firstQB)),firstTE:avg(Y.map(y=>y.firstTE)),firstK:avg(Y.map(y=>y.firstK)),firstDST:avg(Y.map(y=>y.firstDST)),
   avgReach:avg(Y.map(y=>y.avgReach)),rb,wr,lean:rb-wr>=1?'RB-heavy':wr-rb>=1?'WR-heavy':'Balanced',favTeams:fav,repeatPlayers:repeat.map(([k,c])=>({name:k,n:c})),results:corr}});
 return{seasons:got.map(d=>d.season),missing,rows,needsCookies:missing.some(x=>/private/.test(x.reason))}})}

// ---------------- weekly boxscores & transactions ----------------
async function week(w,done){return cached('box'+SEASON+'-'+w,done?7*864e5:5*60e3,async()=>{const d=await E(SEASON,`view=mMatchupScore&view=mBoxscore&scoringPeriodId=${w}`);const T={};
 for(const m of d.schedule.filter(m=>m.matchupPeriodId===w))for(const side of[m.home,m.away]){if(!side)continue;const r=side.rosterForCurrentScoringPeriod||side.rosterForMatchupPeriod;if(!r)continue;
  T[side.teamId]=r.entries.map(e=>{const pl=e.playerPoolEntry.player;return{id:pl.id,name:pl.fullName,pos:POS[pl.defaultPositionId]||'?',slots:pl.eligibleSlots,slot:e.lineupSlotId,pts:r1(e.playerPoolEntry.appliedStatTotal)}})}
 return T})}
async function txns(w,done){return cached('tx'+SEASON+'-'+w,done?7*864e5:10*60e3,async()=>{const d=await E(SEASON,`view=mTransactions2&scoringPeriodId=${w}`);
 return(d.transactions||[]).filter(t=>t.status==='EXECUTED'&&['WAIVER','FREEAGENT'].includes(t.type)).flatMap(t=>t.items.filter(i=>i.type==='ADD').map(i=>({team:String(i.toTeamId),id:i.playerId,week:t.scoringPeriodId,type:t.type,bid:t.bidAmount})))})}
const STARTS=new Set([0,2,4,6,16,17,23]);
function optimal(ent,need){const used=new Set();let tot=0;const take=(ok,k)=>{for(let i=0;i<k;i++){const b=ent.filter(e=>!used.has(e.id)&&ok(e)).sort((a,b)=>b.pts-a.pts)[0];if(!b)return;used.add(b.id);tot+=b.pts}};
 const S=[[0,'QB'],[2,'RB'],[4,'WR'],[6,'TE'],[16,'D/ST'],[17,'K']];for(const[s,pos]of S)take(e=>e.slots.includes(s),need[s]||0);take(e=>e.slots.includes(23),need[23]||0);return tot}
async function season(){const L=await getLeague();const last=Math.max(0,...L.weekly.map(m=>m.week));const ws=[...Array(last).keys()].map(i=>i+1);
 const [boxes,tx]=await Promise.all([Promise.all(ws.map(w=>week(w,true).catch(()=>({})))),Promise.all([...ws,last+1].map(w=>txns(w,w<=last).catch(()=>[])))]);return{L,ws,boxes,tx:tx.flat()}}
async function power(){return cached('power',5*60e3,async()=>{const{L,ws,boxes}=await season();const ids=L.teams.map(t=>t.id),T=Object.fromEntries(L.teams.map(t=>[t.id,t]));
 const sc={};for(const m of L.weekly){(sc[m.home]=sc[m.home]||{})[m.week]=m.hs;if(m.away)(sc[m.away]=sc[m.away]||{})[m.week]=m.as}
 const snap=upto=>{const r=ids.map(id=>{const wk=ws.filter(w=>w<=upto&&sc[id]?.[w]!=null);let aw=0,al=0,at=0;
  for(const w of wk)for(const o of ids)if(o!==id&&sc[o]?.[w]!=null){const a=sc[id][w],b=sc[o][w];a>b?aw++:a<b?al++:at++}
  const pts=wk.map(w=>sc[id][w]),avg=pts.reduce((a,b)=>a+b,0)/Math.max(1,pts.length),rec=pts.slice(-3),form=rec.reduce((a,b)=>a+b,0)/Math.max(1,rec.length);
  let w=0,l=0,pa=0;for(const m of L.weekly.filter(m=>m.week<=upto&&(m.home===id||m.away===id))){const me=m.home===id?m.hs:m.as,op=m.home===id?m.as:m.hs;pa+=op;if(me>op)w++;else if(me<op)l++}
  return{id,avg,form,ap:(aw+at/2)/Math.max(1,aw+al+at),aw,al,w,l,pa,pf:pts.reduce((a,b)=>a+b,0),g:pts.length}});
  const mu=k=>r.reduce((a,x)=>a+x[k],0)/r.length,sd=k=>Math.sqrt(r.reduce((a,x)=>a+(x[k]-mu(k))**2,0)/r.length)||1,z=(x,k)=>(x[k]-mu(k))/sd(k);
  r.forEach(x=>x.power=0.4*z(x,'avg')+0.25*z(x,'form')+0.35*z(x,'ap'));return r.sort((a,b)=>b.power-a.power).map((x,i)=>({...x,rank:i+1}))};
 const now=snap(ws.at(-1)||0),prev=ws.length>1?snap(ws.at(-2)):[];const pa=ids.map(id=>now.find(x=>x.id===id).pa).sort((a,b)=>b-a);
 const rows=now.map(x=>{const exp=x.ap*x.g;return{id:x.id,name:T[x.id].name,manager:T[x.id].manager,rank:x.rank,move:(prev.find(p=>p.id===x.id)?.rank||x.rank)-x.rank,record:`${x.w}-${x.l}`,allPlay:`${x.aw}-${x.al}`,allPlayPct:Math.round(x.ap*100),
  pf:r1(x.pf),pa:r1(x.pa),paRank:pa.indexOf(x.pa)+1,avg:r1(x.avg),form:r1(x.form),luck:r1(x.w-exp),power:+x.power.toFixed(2)}});
 const history=ws.map(w=>({week:w,ranks:Object.fromEntries(snap(w).map(x=>[x.id,x.rank]))}));
 return{week:ws.at(-1)||0,rows,history}})}
async function waivers(){return cached('wv',10*60e3,async()=>{const{L,ws,boxes,tx}=await season();const need=L.slotsNeeded||{},T=Object.fromEntries(L.teams.map(t=>[t.id,t]));
 const team={};for(const t of L.teams)team[t.id]={id:t.id,name:t.name,manager:t.manager,adds:0,pickups:{},bench:[],benchTotal:0};
 for(const a of tx)if(team[a.team])team[a.team].adds++;
 ws.forEach((w,i)=>{for(const[tid,ent]of Object.entries(boxes[i])){const t=team[tid];if(!t)continue;const act=ent.filter(e=>STARTS.has(e.slot)).reduce((a,e)=>a+e.pts,0),opt=optimal(ent,need);
  t.bench.push({week:w,actual:r1(act),optimal:r1(opt),left:r1(opt-act)});t.benchTotal+=opt-act;
  for(const e of ent){const a=tx.filter(x=>x.team===tid&&x.id===e.id&&x.week<=w).sort((x,y)=>y.week-x.week)[0];if(!a)continue;
   const p=t.pickups[e.id]=t.pickups[e.id]||{id:e.id,name:e.name,pos:e.pos,week:a.week,type:a.type,started:0,bench:0,weeks:0};p.weeks++;if(STARTS.has(e.slot))p.started+=e.pts;else if(e.slot!==21)p.bench+=e.pts}}});
 const rows=Object.values(team).map(t=>{const pk=Object.values(t.pickups).map(p=>({...p,started:r1(p.started),bench:r1(p.bench)})).sort((a,b)=>b.started-a.started);
  return{...t,pickups:pk,pickupPts:r1(pk.reduce((a,p)=>a+p.started,0)),benchTotal:r1(t.benchTotal)}});
 const G=['A','B','B','C','C','D','F'];const byPk=[...rows].sort((a,b)=>b.pickupPts-a.pickupPts);byPk.forEach((t,i)=>t.grade=G[Math.min(6,Math.floor(i*7/byPk.length))]);
 const best=rows.flatMap(t=>t.pickups.map(p=>({...p,team:t.name}))).sort((a,b)=>b.started-a.started).slice(0,10);
 return{weeks:ws,rows:byPk,best,benchRank:[...rows].sort((a,b)=>a.benchTotal-b.benchTotal).map(t=>({id:t.id,name:t.name,benchTotal:t.benchTotal}))}})}
// ---------------- trade ----------------
async function trade(a,b,give,get){const L=await getLeague();const A=L.teams.find(t=>t.id===a),B=L.teams.find(t=>t.id===b);if(!A||!B||a===b)throw Error('Pick two different teams.');
 const left=Math.max(0,18-L.week+1),need=L.slotsNeeded||{};
 const rate=p=>['OUT','INJURY_RESERVE','SUSPENSION'].includes(p.injury)?0:p.seasonProj?p.seasonProj/17:p.avg;const ros=p=>r1(rate(p)*left);
 const lineup=R=>{const ent=R.filter(p=>p.slot!=='IR').map(p=>({id:p.id,pts:rate(p),slots:p.slots.map(s=>({QB:0,RB:2,WR:4,TE:6,FLEX:23,'D/ST':16,K:17}[s])).filter(x=>x!=null)}));return optimal(ent,need)};
 const G=give.filter(id=>A.roster.some(p=>p.id===id)),R=get.filter(id=>B.roster.some(p=>p.id===id));if(!G.length&&!R.length)throw Error('Pick at least one player.');
 const after=(t,out,inn,other)=>[...t.roster.filter(p=>!out.includes(p.id)),...other.roster.filter(p=>inn.includes(p.id))];
 const posRank=(roster,pos,teams)=>{const top=R0=>R0.filter(p=>p.pos===pos).map(rate).sort((x,y)=>y-x).slice(0,pos==='RB'||pos==='WR'?2:1).reduce((x,y)=>x+y,0);const mine=top(roster);return 1+teams.filter(r=>top(r)>mine).length};
 const side=(t,out,inn,other,newOther)=>{const nr=after(t,out,inn,other);const others=L.teams.filter(x=>x.id!==t.id&&x.id!==other.id).map(x=>x.roster);
  const before=lineup(t.roster),aft=lineup(nr);
  return{id:t.id,name:t.name,manager:t.manager,gives:t.roster.filter(p=>out.includes(p.id)).map(p=>({name:p.name,pos:p.pos,avg:p.avg,ros:ros(p)})),gets:other.roster.filter(p=>inn.includes(p.id)).map(p=>({name:p.name,pos:p.pos,avg:p.avg,ros:ros(p)})),
   rosDelta:r1(other.roster.filter(p=>inn.includes(p.id)).reduce((x,p)=>x+ros(p),0)-t.roster.filter(p=>out.includes(p.id)).reduce((x,p)=>x+ros(p),0)),
   lineupBefore:r1(before),lineupAfter:r1(aft),lineupDelta:r1(aft-before),lineupRos:r1((aft-before)*left),
   positions:['QB','RB','WR','TE'].map(pos=>({pos,before:posRank(t.roster,pos,[...others,other.roster]),after:posRank(nr,pos,[...others,newOther])}))}};
 const nA=after(A,G,R,B),nB=after(B,R,G,A);const sa=side(A,G,R,B,nB),sb=side(B,R,G,A,nA);
 const diff=sa.lineupRos-sb.lineupRos,moved=[...sa.gives,...sa.gets].reduce((x,p)=>x+p.ros,0)||1,lop=Math.abs(diff)>Math.max(20,0.2*moved);
 const win=diff>0?sa:sb,lose=diff>0?sb:sa;
 const verdict=lop?'Lopsided':'Fair';const why=lop?`${win.name} gains about ${Math.abs(r1(diff))} more rest-of-season starting-lineup points than ${lose.name}. ${lose.lineupDelta<0?`${lose.name}'s weekly lineup gets ${Math.abs(lose.lineupDelta)} pts worse.`:`${lose.name} only nets ${lose.lineupDelta} pts/week.`}`
  :`Both lineups land within ${Math.abs(r1(diff))} projected points over the rest of the season. ${sa.lineupDelta>0&&sb.lineupDelta>0?'Both starting lineups improve — a true win-win.':'Pick it based on positional need.'}`;
 return{week:L.week,weeksLeft:left,sides:[sa,sb],verdict,why}}
async function rosters(){const L=await getLeague();return{teams:L.teams.map(t=>({id:t.id,name:t.name,manager:t.manager,roster:t.roster.map(p=>({id:p.id,name:p.name,pos:p.pos,team:p.team,avg:p.avg,slot:p.slot}))}))}}
return async function(p,u){const s=+(u.searchParams.get('season')||SEASON);
 if(p==='/api/draft')return draft(s);if(p==='/api/tendencies')return tendencies();if(p==='/api/power')return power();if(p==='/api/waiver-report')return waivers();if(p==='/api/rosters')return rosters();
 if(p==='/api/trade'){const ids=k=>(u.searchParams.get(k)||'').split(',').filter(Boolean).map(Number);return trade(u.searchParams.get('a'),u.searchParams.get('b'),ids('give'),ids('get'))}
 return null}};
