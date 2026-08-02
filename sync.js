/* ════════════════════════════════════════════════════════════════════════
   计划册 · 统一云同步客户端（v20）
   把「主题/调色盘」原本的占位式同步，扩展为「全部 12 类数据」的同步：
   · 同步对象 = 整个 state（任务/清单/习惯/专注/灵感/调色盘/设置…）
   · 后端可插拔：在设置页填写后端地址即可启用（与 plus.js 的 CONFIG.API_BASE 二选一）
   · 离线队列：无网络时先入队，联网后自动补推
   · 冲突处理：以最后写入时间（state._syncTs）为准，后写覆盖先写（Last-Write-Wins）
   · 后端契约：
       POST {base}/sync    body = {ts, device, user, payload:state}   → 200 即成功
       GET  {base}/sync?device=&user=   → 返回服务端保存的 {ts, payload}（缺省返回 null）
   客户端不依赖任何特定后端；未配置后端时完全不发起网络请求，仅本机双备份。
   ════════════════════════════════════════════════════════════════════════ */
(function(){
  const CFG_KEY="goalday-sync-cfg", DEV_KEY="goalday-sync-dev", Q_KEY="goalday-sync-queue";
  function cfg(){try{return JSON.parse(localStorage.getItem(CFG_KEY)||"{}");}catch(e){return {};}}
  function setCfg(o){try{localStorage.setItem(CFG_KEY,JSON.stringify(o));}catch(e){}}
  function deviceId(){let d=localStorage.getItem(DEV_KEY);if(!d){d="d"+Math.random().toString(36).slice(2,10);localStorage.setItem(DEV_KEY,d);}return d;}
  function apiBase(){
    const c=cfg();
    if(c.apiBase)return c.apiBase;
    try{if(typeof CONFIG!=="undefined"&&CONFIG&&CONFIG.API_BASE)return CONFIG.API_BASE;}catch(e){}
    return "";
  }
  function user(){return cfg().user||"";}
  const status={online:(typeof navigator!=="undefined"?navigator.onLine!==false:true),pending:0,last:null,err:null};
  let pushTimer=null;

  function setStatus(){
    const el=document.getElementById("syncStatus");
    if(!el)return;
    const base=apiBase();
    let t;
    if(!base){t="未配置后端 · 仅本机双备份（localStorage + IndexedDB）";}
    else if(!status.online){t="⚠️ 离线 · 改动已排队，联网后自动同步";}
    else if(status.err){t="⚠️ 同步异常："+status.err+"（将自动重试）";}
    else if(status.last){t="✅ 已同步 · "+new Date(status.last).toLocaleString();}
    else{t="☁️ 后端已连接 · 每次改动自动同步全量数据";}
    el.textContent=t;
  }
  function getState(){return window.JH_GET?window.JH_GET():null;}
  function enqueue(s){try{localStorage.setItem(Q_KEY,JSON.stringify({ts:s._syncTs||Date.now(),payload:s}));}catch(e){}}
  function pending(){try{return JSON.parse(localStorage.getItem(Q_KEY)||"null");}catch(e){return null;}}
  function clearQueue(){try{localStorage.removeItem(Q_KEY);}catch(e){}}
  function postJSON(url,body){return fetch(url,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});}
  function getJSON(url){return fetch(url).then(r=>r.ok?r.json():Promise.reject("HTTP "+r.status));}

  function pushSync(){
    const base=apiBase();if(!base)return Promise.resolve();
    const s=getState();if(!s)return Promise.resolve();
    if(typeof navigator!=="undefined"&&navigator.onLine===false){
      enqueue(s);status.pending=1;status.online=false;setStatus();return Promise.resolve();
    }
    const payload={ts:s._syncTs||Date.now(),device:deviceId(),user:user(),payload:s};
    status.online=true;status.err=null;
    return postJSON(base.replace(/\/$/,"")+"/sync",payload).then(r=>{
      if(!r.ok)throw new Error("HTTP "+r.status);
      clearQueue();status.pending=0;status.last=Date.now();setStatus();
      return pullSync();
    }).catch(err=>{
      /* 网络抖动：入队，联网后由 online 事件补推 */
      enqueue(s);status.pending=1;status.err=String(err&&err.message||err);setStatus();
    });
  }
  function pullSync(){
    const base=apiBase();if(!base)return Promise.resolve();
    const q=new URLSearchParams({device:deviceId(),user:user()});
    return getJSON(base.replace(/\/$/,"")+"/sync?"+q.toString()).then(rem=>{
      const s=getState();const localTs=s&&s._syncTs||0;
      if(rem&&rem.ts&&rem.ts>localTs&&rem.payload){
        if(window.JH_REPLACE)window.JH_REPLACE(rem.payload);  /* LWW：远端更新则覆盖 */
        status.last=Date.now();setStatus();
      }
    }).catch(()=>{});
  }
  /* 每次本地写入后触发（防抖合并 800ms 内的连续操作） */
  function onSave(){
    if(!apiBase())return;
    if(pushTimer)clearTimeout(pushTimer);
    pushTimer=setTimeout(()=>pushSync(),800);
  }
  function pushNow(){return pushSync().then(()=>{if(typeof toast==="function")toast("已同步到云端 ☁️");});}

  /* 联网/断网事件 */
  window.addEventListener("online",()=>{status.online=true;const p=pending();if(p)pushSync();else pullSync();setStatus();});
  window.addEventListener("offline",()=>{status.online=false;setStatus();});

  function wire(){
    const btn=document.getElementById("paletteSync");
    if(btn)btn.addEventListener("click",()=>{
      if(!apiBase()){if(typeof toast==="function")toast("请先在「云同步」中填写后端地址");return;}
      pushNow();
    });
    const inp=document.getElementById("syncBackend");
    if(inp){inp.value=apiBase();inp.addEventListener("change",()=>{const c=cfg();c.apiBase=inp.value.trim();setCfg(c);setStatus();if(typeof toast==="function")toast("后端地址已保存 ✅");});}
    const uinp=document.getElementById("syncUser");
    if(uinp){uinp.value=user();uinp.addEventListener("change",()=>{const c=cfg();c.user=uinp.value.trim();setCfg(c);if(typeof toast==="function")toast("账号已保存 ✅");});}
    setStatus();
  }
  if(typeof document!=="undefined"){
    if(document.readyState!=="loading")wire();
    else document.addEventListener("DOMContentLoaded",wire);
  }

  window.JH_SYNC={onSave,pushNow,pullNow:pullSync,setBackend:(b)=>{const c=cfg();c.apiBase=b;setCfg(c);setStatus();},status:()=>status};
})();
