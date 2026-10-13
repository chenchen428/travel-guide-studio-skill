/* Adapted from the user's reference map module. No server API keys or runtime routing calls. */
(function(){
'use strict';
if(!data.map||!data.map.routes||!data.map.pois)return;
var AM_POIS=data.map.pois, AM_ROUTES=data.map.routes;
/* ==========================================================================
   1. 常量与基础工具
   ========================================================================== */
/* 浏览器端 JS API key + 安全密钥（高德官方设计的公开用法，可写入 HTML）。
   ⛔ 服务端 Web 服务 key 绝不写入本文件。 */
var AM_JS_KEY = data.map.browserKey;
/* 🔒 方案0：高德安全密钥已彻底移除。
   运行期不再调用任何 AMap 服务类插件（Walking/Driving/Transfer/Geolocation），
   真实路网数据已在构建期用 Web服务 key 预计算并烘焙进 AM_ROUTES[*].stops[*].pre。
   底图瓦片 / Marker / Polyline / InfoWindow 只需公开 JS key，不需要 scode。 */
var AM_PLUGINS = 'AMap.Scale';   /* 🔒 方案0：只保留纯客户端插件，其余服务类插件已全部移除 */
var AM_SDK_TIMEOUT = 12000;      /* 12 秒超时 → 降级 */
var AM_API_GAP = 280;            /* 路径规划串行限流间隔（≥250ms），防 QPS */
var AM_CENTER = [AM_POIS[0].lng, AM_POIS[0].lat]; /* 初始/定位失败中心来自本次输入地点 */

/* POI 索引：id → 完整 POI（用于补 cat / rating / opentime / tel / rectag） */
var AM_POI = {};
(function(){ for(var i=0;i<AM_POIS.length;i++){ AM_POI[AM_POIS[i].id]=AM_POIS[i]; } })();

/* 模式清单：全览 + 输入中的全部日期与备选。alt 的 key/title/color 直接来自数据文件 */
var AM_MODES = [{k:'all', label:'全览', short:'全览', color:'#4a7c74', title:AM_ROUTES.days.length+' 天全览'}];
(function(){
  for(var i=0;i<AM_ROUTES.days.length;i++){
    var d=AM_ROUTES.days[i];
    AM_MODES.push({k:'d'+d.d, label:'DAY'+d.d, short:d.date, color:d.color, title:d.title,
      date:d.date, indoor:!!d.indoor, stops:d.stops, kind:'day', idx:i});
  }
  for(var j=0;j<AM_ROUTES.alt.length;j++){
    var a=AM_ROUTES.alt[j];
    var nm = a.label || a.title || a.key;
    AM_MODES.push({k:'a_'+a.key, label:nm, short:nm, color:a.color, title:a.title,
      swap:a.swap||'', stops:a.stops, kind:'alt', idx:j});
  }
})();
var AM_MODE_BY_K = {};
(function(){ for(var i=0;i<AM_MODES.length;i++) AM_MODE_BY_K[AM_MODES[i].k]=AM_MODES[i]; })();

/* 图层筛选：对应 poi.cat */
var AM_CATS = [
  {k:'scenic',  n:'景点'}, {k:'temple',  n:'寺庙'}, {k:'museum', n:'博物馆'},
  {k:'food',    n:'餐饮'}, {k:'hotel',   n:'酒店'}, {k:'transit',n:'交通'},
  {k:'show',    n:'演出'}, {k:'shop',    n:'购物'}, {k:'park',   n:'公园'}
];

/* 🔑 leg → 算法分流表（本模块最核心的决策）
   ---------------------------------------------------------------
   api    : 需要调用的高德路径规划插件名；null = 只用 haversine 直线距离
   reason : 为什么不调 API —— 山径/游船没有对应道路网，高德步行规划会给出
            荒谬的绕路结果（几十公里），必须强制用直线距离并明确标注口径。 */
var AM_LEG = {
  walk:     {ic:icon('walk'), nm:'步行',     api:'walking',  dash:null,          speed:4600, tag:'道路实测'},
  drive:    {ic:icon('car'), nm:'打车',     api:'driving',  dash:null,          speed:22000,tag:'道路实测'},
  metro:    {ic:icon('train'), nm:'地铁',     api:'transfer', dash:null,          speed:32000,tag:'轨道'},
  bus:      {ic:icon('train'), nm:'公交',     api:'transfer', dash:null,          speed:16000,tag:'公交'},
  boat:     {ic:icon('boat'), nm:'游船',     api:null,       dash:[12,8],        speed:0,    tag:'水面直线'},
  mountain: {ic:icon('mountain'), nm:'山径',     api:null,       dash:[3,7],         speed:2600, tag:'山径直线'},
  foot:     {ic:icon('walk'), nm:'景区内步行',api:null,      dash:[2,5],         speed:4200, tag:'景区内直线'}
};
/* 山径段绝对不调步行 API 的原因（写给未来维护者）：
   景区土路、山脊与溪谷可能没有道路路网；不使用机动车路网冒充山径。
   缺少真实山径数据时用 haversine，并明确标注直线口径。 */

/* ---------- 小工具 ---------- */
function amEsc(s){ /* 优先复用页面既有 esc()，缺失时本地兜底 */
  if(typeof esc==='function') return esc(s);
  return String(s==null?'':s).replace(/[&<>"']/g,function(c){
    return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});
}
function amFmt(s){ /* note 含 🔑/⚠️/🔴 与 **粗体** 标记 → 用页面 fmt() 渲染 */
  if(s==null) return '';
  if(typeof fmt==='function'){ try{ return fmt(s); }catch(e){} }
  return amEsc(s).replace(/\n/g,'<br>');
}
function amToast(m,ms){ if(typeof toast==='function'){ try{ toast(m,ms); return; }catch(e){} } }
function amHav(lng1,lat1,lng2,lat2){
  var R=6371008.8, r=Math.PI/180;
  var dLat=(lat2-lat1)*r, dLng=(lng2-lng1)*r;
  var a=Math.sin(dLat/2)*Math.sin(dLat/2)
      + Math.cos(lat1*r)*Math.cos(lat2*r)*Math.sin(dLng/2)*Math.sin(dLng/2);
  return 2*R*Math.asin(Math.min(1,Math.sqrt(a)));
}
function amDist(m){
  if(m==null||isNaN(m)) return '—';
  m=Math.round(m);
  if(m<950) return m+'m';
  return (m/1000).toFixed(1).replace(/\.0$/,'')+'km';
}
function amDur(sec){
  if(sec==null||isNaN(sec)||sec<=0) return '';
  sec=Math.round(sec);
  if(sec<60) return '约'+sec+'秒';
  var m=Math.round(sec/60);
  if(m<60) return '约'+m+'分钟';
  var h=Math.floor(m/60); m=m-h*60;
  return '约'+h+'小时'+(m?m+'分':'');
}
function amTMin(t){ /* '08:40' → 520，用于算「计划间隔」 */
  if(!t||typeof t!=='string') return null;
  var p=t.split(':'); if(p.length<2) return null;
  var h=parseInt(p[0],10), m=parseInt(p[1],10);
  if(isNaN(h)||isNaN(m)) return null;
  return h*60+m;
}
function amNoteHasTime(n){ /* note 里已写好「约25—30分钟」时，优先用作者原文，不覆盖 */
  return !!n && /\d+\s*(分钟|小时|分)/.test(n);
}
function amAmapUrl(name){
  return 'https://uri.amap.com/search?keyword='+encodeURIComponent(name||'')+'&city='+encodeURIComponent(data.destination);
}
function amIsDark(){
  var t=document.body.getAttribute('data-theme')||'light';
  if(t==='dark') return true;
  if(t==='light') return false;
  return !!(window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches);
}
function amMapStyle(){ return amIsDark()?'amap://styles/dark':'amap://styles/whitesmoke'; }
function amReduce(){
  return !!(window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches);
}
function amNum(n){ return String(n); }
function amCatOf(stop){ var p=AM_POI[stop.id]; return p&&p.cat?p.cat:'scenic'; }
function amOpenUrl(name){
  var u=amAmapUrl(name);
  window.open(u,'_blank','noopener');
}

/* ==========================================================================
   2. 路段计算（先 haversine 同步出全量数据，保证断网/首屏即时可用）
   ========================================================================== */
/* 为一个模式生成 segs[]：{i, leg, L, from, to, dist, dur, api, path, gapMin, text}
   —— dist/dur 初值来自 haversine + 速度推算，API 回来后原地替换并置 api=true */
function amBuildSegs(mode){
  var st=mode.stops||[], segs=[];
  for(var i=1;i<st.length;i++){
    var a=st[i-1], b=st[i];
    var leg=b.leg||'foot';
    var L=AM_LEG[leg]||AM_LEG.foot;
    var d=amHav(a.lng,a.lat,b.lng,b.lat);
    var ta=amTMin(a.t), tb=amTMin(b.t);
    var gap=(ta!=null&&tb!=null&&tb>ta)?(tb-ta):null;
    var dur=L.speed? d/L.speed*3600 : null;
    /* 山径：直线距离 × 1.35 经验绕行系数估算耗时（口径明确标注「推算」） */
    if(leg==='mountain') dur = d*1.35/L.speed*3600;
    segs.push({
      i:i, leg:leg, L:L, from:a, to:b,
      dist:d, dur:dur, api:false, apiFail:false,
      path:null,                      /* API 返回的真实路网折线（walk/drive） */
      gapMin:gap, note:b.note||'',
      kind: (leg==='mountain')?'mountain' : (leg==='boat')?'water' : 'road'
    });
  }
  return segs;
}
/* 汇总：道路 / 山径 / 水面 分开统计并注明口径 */
function amSum(segs){
  var o={n:segs.length, road:0, roadT:0, mtn:0, mtnT:0, water:0, waterT:0, foot:0, apiN:0, gaps:0};
  for(var i=0;i<segs.length;i++){
    var s=segs[i];
    if(s.api) o.apiN++;
    if(s.gapMin) o.gaps+=s.gapMin;
    if(s.kind==='mountain'){ o.mtn+=s.dist; o.mtnT+=(s.dur||0); }
    else if(s.kind==='water'){ o.water+=s.dist; o.waterT+=(s.dur||0); }
    else { o.road+=s.dist; o.roadT+=(s.dur||0); }
    if(s.leg==='foot') o.foot+=s.dist;
  }
  return o;
}
/* 一句话里程/耗时摘要 */
function amSumText(su){
  var parts=[];
  if(su.road) parts.push('道路 '+amDist(su.road));
  if(su.mtn)  parts.push('山径直线 '+amDist(su.mtn));
  if(su.water)parts.push('水面直线 '+amDist(su.water));
  var total=su.road+su.mtn+su.water;
  var s='<b>'+amDist(total)+'</b>（'+parts.join(' + ')+'）';
  /* 耗时口径：优先用「计划间隔」之和（作者排定的时刻表 → 日程跨度，最真实）；
     无时刻数据时回落为纯交通时间推算，并显式标注不同口径，绝不混为一谈 */
  var t = su.gaps ? su.gaps*60 : (su.roadT+su.mtnT);
  if(t) s+=' · '+(su.gaps?'日程跨度':'纯交通')+' <b>'+amDur(t).replace('约','')+'</b>';
  return s;
}

/* ==========================================================================
   3. 🔴 SDK 懒加载 + 12s 超时降级
   --------------------------------------------------------------------------
   页面首屏绝不引入高德脚本（保住「断网可用」这个已验证卖点）。
   只有用户第一次点开地图时才注入高德 JS API 脚本（本页不需要任何密钥配置）。
   状态机：idle → loading → ready | failed。失败/超时后永久降级为纯文字路线，
   且降级路径不抛任何异常、不产生 console error。 */
var amSDK = {st:'idle', cbs:[], tmo:null};

function amLoadSDK(cb){
  if(amSDK.st==='ready'){ cb(null); return; }
  if(amSDK.st==='failed'){ cb(new Error('sdk-failed')); return; }
  amSDK.cbs.push(cb);
  if(amSDK.st==='loading') return;
  amSDK.st='loading';

  function done(err){
    if(amSDK.st==='ready'||amSDK.st==='failed') return;
    clearTimeout(amSDK.tmo);
    amSDK.st = err ? 'failed' : 'ready';
    var q=amSDK.cbs.slice(); amSDK.cbs.length=0;
    for(var i=0;i<q.length;i++){ try{ q[i](err); }catch(e){} }
  }

  try{
    /* 🔒 方案0：本页不需要任何高德密钥配置 —— 运行期无服务类接口调用 */
    var s=document.createElement('script');
    s.src='https://webapi.amap.com/maps?v=2.0&key='+AM_JS_KEY+'&plugin='+encodeURIComponent(AM_PLUGINS);
    s.async=true; s.crossOrigin='anonymous';
    s.onload=function(){
      /* onload 后 AMap 全局对象应已就绪；再兜底轮询 10×120ms */
      var n=0;
      (function chk(){
        if(window.AMap&&window.AMap.Map){ done(null); }
        else if(++n<10){ setTimeout(chk,120); }
        else { done(new Error('amap-missing')); }
      })();
    };
    s.onerror=function(){ done(new Error('network')); };
    document.head.appendChild(s);
    amSDK.tmo=setTimeout(function(){ done(new Error('timeout')); }, AM_SDK_TIMEOUT);
  }catch(e){ done(e); }
}

/* ---------- 降级：纯文字逐段路线（数据全内联，断网也有） ---------- */
function amFallbackHTML(mode){
  var st=mode.stops||[], segs=amBuildSegs(mode), su=amSum(segs);
  var h='<div class="am-fb">';
  h+='<div class="am-fb-hd"><span class="am-fb-ic">📴</span><div>'
    +'<b>地图需要网络，当前不可用</b>'
    +'<div class="am-fb-sub">高德底图脚本未能加载（离线 / 超时 / 被拦截）。下面是完整的逐段路线文字版，坐标与里程已内联，断网也能看。</div>'
    +'</div></div>';
  h+='<div class="am-fb-sum">📍 '+st.length+' 站 · 总里程 '+amSumText(su)+'</div>';
  h+='<ol class="am-fb-list">';
  for(var i=0;i<st.length;i++){
    var p=st[i], sg=segs[i-1];
    if(sg){
      h+='<li class="am-fb-leg"><span class="am-fb-lic">'+sg.L.ic+'</span>'
        +'<span>'+amEsc(sg.L.nm)+' · '+amDist(sg.dist)
        +(sg.leg==='mountain'?'（实际步行更长）':'')
        +(sg.gapMin?' · 计划间隔 '+sg.gapMin+' 分钟':'')
        +(sg.note?'<span class="am-fb-note">'+amFmt(sg.note)+'</span>':'')
        +'</span></li>';
    }
    h+='<li class="am-fb-stop"><span class="am-fb-no" style="background:'+amEsc(mode.color||'#4a7c74')+'">'+amNum(i+1)+'</span>'
      +'<div class="am-fb-bd"><div class="am-fb-t">'+(p.t?'<span class="am-fb-time">'+amEsc(p.t)+'</span>':'')
      +amEsc(p.name)+'</div>';
    if(p.address) h+='<div class="am-fb-ad">'+amEsc(p.address)+'</div>';
    h+='<div class="am-fb-act"><a class="am-btn am-btn-pri" href="'+amAmapUrl(p.amap_name||p.name)+'" target="_blank" rel="noopener">🧭 在高德打开</a>'
      +(typeof mapBtn==='function'? mapBtn(p.amap_name||p.name) :'')
      +'</div></div></li>';
  }
  h+='</ol></div>';
  return styleGlyphs(h);
}

/* ==========================================================================
   4. 高德路径规划串行队列（限流 + 缓存 + 静默降级）
   --------------------------------------------------------------------------
   只对 walk / drive / metro / bus 段调 API；boat / mountain / foot 永不入队。
   结果写入全局缓存，两个视图（内嵌 / 全屏）共享，避免重复请求。 */
var AM_CACHE = {};                       /* modeKey#segIdx → {dist,dur,path} */
var amQ = {items:[], busy:false};
function amEnqueue(job){ amQ.items.push(job); amPump(); }
function amPump(){
  if(amQ.busy) return;
  var j=amQ.items.shift(); if(!j) return;
  amQ.busy=true;
  setTimeout(function(){
    try{ j(); }catch(e){ amQ.busy=false; amPump(); }
  }, AM_API_GAP);
}
function amFlattenPath(steps){
  var out=[];
  if(!steps||!steps.length) return out;
  for(var i=0;i<steps.length;i++){
    var p=steps[i].path; if(!p) continue;
    for(var j=0;j<p.length;j++){ out.push([p[j].lng||p[j].getLng(), p[j].lat||p[j].getLat()]); }
  }
  return out;
}
/* 单个路段的 API 请求。失败一律静默 → 保留 haversine 直线值 */
function amRequest(modeK, segIdx, leg, a, b){
  /* 🔒 方案0：不再调用高德步行/驾车/公交路径规划插件（那些需要安全密钥）。
     改为读取构建期用高德 Web服务 API 预计算好的真实路网结果 b.pre。
     同步返回 → 无网络往返、无 QPS 限流、断网也有数据、且 100% 覆盖（原运行期
     受 280ms 串行限流影响，单日通常只能算完 2—3 段）。 */
  var ck=modeK+'#'+segIdx;
  if(AM_CACHE[ck]) return;
  var pre = b && b.pre;
  if(pre && pre.dist){
    AM_CACHE[ck]={
      dist: pre.dist,
      dur:  pre.dur || null,
      path: (pre.path && pre.path.length>1) ? pre.path : null,   /* 真实路网折线 */
      src:  pre.src || '原稿高德数据',
      pre:  pre                                                  /* 保留票价/线路等供抽屉展示 */
    };
  }else{
    AM_CACHE[ck]={fail:true};
  }
  amBroadcast(modeK, segIdx);
}
/* 结果回来 → 通知所有正在显示该模式的视图增量刷新 */
function amBroadcast(modeK, segIdx){
  for(var i=0;i<amViewers.length;i++){
    var v=amViewers[i];
    if(v.mode&&v.mode.k===modeK){ try{ v.applyCache(segIdx); }catch(e){} }
  }
}

/* ==========================================================================
   5. 地图视图（内嵌 / 全屏共用一套引擎）
   ========================================================================== */
var amViewers=[];

function amViewer(o){
  var V={
    el:o.el, wrap:o.wrap, inline:!!o.inline,
    map:null, iw:null, geo:null,
    markers:[], lines:[], overlays:[],
    mode:null, segs:[], sel:-1,
    cats:(function(){var c={};for(var i=0;i<AM_CATS.length;i++)c[AM_CATS[i].k]=true;return c;})(),
    token:0, failed:false, scale:null, meMk:null, drawerH:150,
    onDrawer:o.onDrawer||null, onStatus:o.onStatus||null, onPaint:o.onPaint||null
  };
  amExtend(V);   /* 挂载选中/InfoWindow/API/定位等方法（见第 6 节） */
  amViewers.push(V);

  /* ---- 5.1 创建地图（懒加载成功后调用一次） ---- */
  V.create=function(){
    if(V.map) return true;
    try{
      V.map=new AMap.Map(V.el,{
        viewMode:'2D',                      /* 手机端 2D 性能更好 */
        mapStyle:amMapStyle(),
        zoom:12, center:AM_CENTER,
        resizeEnable:true, isHotspot:true,
        features:['bg','road','building','point'],
        WebGLParams:{preserveDrawingBuffer:false}
      });
      V.scale=new AMap.Scale({position:'LB'});   /* 比例尺：徒步日很需要 */
      V.map.addControl(V.scale);
      return true;
    }catch(e){ V.failed=true; return false; }
  };

  /* ---- 5.2 主题跟随（data-theme 变化时切 mapStyle） ---- */
  V.theme=function(){
    if(!V.map) return;
    try{ V.map.setMapStyle(amMapStyle()); }catch(e){}
  };

  /* ---- 5.3 设置模式并重绘 ---- */
  V.setMode=function(k,keepCenter){
    var m=AM_MODE_BY_K[k]; if(!m) return;
    V.mode=m; V.sel=-1; V.token++;
    V.segs=amBuildSegs(m);
    /* 已有 API 缓存的路段直接套用真实路网数值 */
    for(var i=0;i<V.segs.length;i++){
      var c=AM_CACHE[m.k+'#'+(i+1)];
      if(c&&!c.pending&&!c.fail&&c.dist){ V.segs[i].dist=c.dist; if(c.dur)V.segs[i].dur=c.dur; V.segs[i].api=true; if(c.path)V.segs[i].path=c.path; }
    }
    V.draw(keepCenter);
    V.queueApi();
    V.paint();
  };

  /* ---- 5.4 绘制 marker + polyline ---- */
  V.draw=function(keepCenter){
    var m=V.map, mode=V.mode;
    if(!m||!mode) return;
    m.clearMap();
    V.markers=[]; V.lines=[];
    var st=mode.stops||[], all=(mode.k==='all');
    var segs=all?[]:V.segs;

    if(all){
      /* 全览：所有日期路线同时显示，各用自己的 color */
      for(var di=0;di<AM_ROUTES.days.length;di++){
        var dd=AM_ROUTES.days[di];
        for(var j=1;j<dd.stops.length;j++){
          var A=dd.stops[j-1], B=dd.stops[j];
          var lg=AM_LEG[B.leg||'foot']||AM_LEG.foot;
          V.addLine([[A.lng,A.lat],[B.lng,B.lat]], dd.color, 3, .5, lg.dash, 40+di);
        }
        for(var k2=0;k2<dd.stops.length;k2++) V.addMarker(dd.stops[k2], k2, dd.stops.length, dd.color, dd, true);
      }
    }else{
      /* 单日：逐段 polyline（山径虚线 / 游船另一种虚线 / 道路实线） */
      for(var i=0;i<segs.length;i++){
        var s=segs[i];
        var path = s.path && s.path.length>1
                 ? s.path
                 : [[s.from.lng,s.from.lat],[s.to.lng,s.to.lat]];
        V.addLine(path, mode.color, 5, .92, s.L.dash, 90+i, s.i);
      }
      for(var n=0;n<st.length;n++) V.addMarker(st[n], n, st.length, mode.color, mode, false);
    }
    if(!keepCenter) V.fit();
  };

  V.addLine=function(path,color,weight,op,dash,zi,segIdx){
    try{
      var pl=new AMap.Polyline({
        path:path, strokeColor:color, strokeWeight:weight, strokeOpacity:op,
        lineJoin:'round', lineCap:'round', zIndex:zi,
        strokeStyle: dash?'dashed':'solid',
        strokeDasharray: dash||[10,5],
        isOutline:false, cursor:'pointer'
      });
      if(segIdx!=null){
        pl.on('click',function(){ V.select(segIdx,true); });
      }
      V.map.add(pl); V.lines.push({pl:pl,seg:segIdx});
      return pl;
    }catch(e){ return null; }
  };

  V.addMarker=function(stop, idx, total, color, mode, mini){
    var cat=amCatOf(stop);
    if(!V.cats[cat]) return;                 /* 图层筛选 */
    try{
      var el=document.createElement('div');
      var isS=(idx===0), isE=(idx===total-1);
      el.className='am-mk'+(mini?' am-mk-mini':'')+(isS?' am-mk-s':'')+(isE?' am-mk-e':'');
      el.style.setProperty('--amc', color||'#4a7c74');
      el.innerHTML='<i>'+(mini?amNum(idx+1):amNum(idx+1))+'</i>';
      el.setAttribute('role','button');
      el.setAttribute('aria-label',amEsc(stop.name));
      var mk=new AMap.Marker({
        position:[stop.lng,stop.lat], content:el, anchor:'center',
        zIndex: isS||isE?160:140, offset:new AMap.Pixel(0,0), cursor:'pointer',
        title:stop.name
      });
      mk.on('click',function(ev){ try{if(ev&&ev.stopPropagation)ev.stopPropagation();}catch(e){} V.selectStop(idx, stop, mode); });
      mk.on('touchend',function(){});
      V.map.add(mk);
      V.markers.push({mk:mk,el:el,idx:idx,stop:stop,mode:mode});
    }catch(e){}
  };

  V.fit=function(){
    if(!V.map) return;
    try{
      /* padding：[上, 下, 左, 右] —— 顶部让给 chips、底部让给抽屉 */
      var pad = V.inline ? [46,26,26,26] : [30, V.drawerH||150, 34, 34];
      if(V.map.setFitView) V.map.setFitView(V.overlaysAll(), false, pad, V.inline?16:15);
    }catch(e){ try{V.map.setFitView(null,false,[40,120,40,40]);}catch(e2){} }
  };
  V.overlaysAll=function(){
    var out=[];
    for(var i=0;i<V.markers.length;i++) out.push(V.markers[i].mk);
    for(var j=0;j<V.lines.length;j++) out.push(V.lines[j].pl);
    return out;
  };

  return V;
}

/* ==========================================================================
   🔒 方案0 配套：WGS-84 → GCJ-02（国测局火星坐标）标准转换
   --------------------------------------------------------------------------
   navigator.geolocation 返回 WGS-84，高德底图用 GCJ-02。
   中国境内两者相差约 300—600 米，不转换会导致"定位蓝点漂移"。
   境外坐标（amOutChina 判定）直接原样返回，不做偏移。
   ========================================================================== */
var AM_GCJ_A=6378245.0, AM_GCJ_EE=0.00669342162296594323;
function amOutChina(x,y){ return !(x>73.66&&x<135.05&&y>3.86&&y<53.55); }
function amTLat(x,y){
  var r=-100.0+2.0*x+3.0*y+0.2*y*y+0.1*x*y+0.2*Math.sqrt(Math.abs(x));
  r+=(20.0*Math.sin(6.0*x*Math.PI)+20.0*Math.sin(2.0*x*Math.PI))*2.0/3.0;
  r+=(20.0*Math.sin(y*Math.PI)+40.0*Math.sin(y/3.0*Math.PI))*2.0/3.0;
  r+=(160.0*Math.sin(y/12.0*Math.PI)+320.0*Math.sin(y*Math.PI/30.0))*2.0/3.0;
  return r;
}
function amTLng(x,y){
  var r=300.0+x+2.0*y+0.1*x*x+0.1*x*y+0.1*Math.sqrt(Math.abs(x));
  r+=(20.0*Math.sin(6.0*x*Math.PI)+20.0*Math.sin(2.0*x*Math.PI))*2.0/3.0;
  r+=(20.0*Math.sin(x*Math.PI)+40.0*Math.sin(x/3.0*Math.PI))*2.0/3.0;
  r+=(150.0*Math.sin(x/12.0*Math.PI)+300.0*Math.sin(x/30.0*Math.PI))*2.0/3.0;
  return r;
}
function amWgs2Gcj(lng,lat){
  lng=Number(lng); lat=Number(lat);
  if(!isFinite(lng)||!isFinite(lat)) return AM_CENTER.slice();
  if(amOutChina(lng,lat)) return [lng,lat];
  var dLat=amTLat(lng-105.0,lat-35.0), dLng=amTLng(lng-105.0,lat-35.0);
  var rl=lat/180.0*Math.PI, m=Math.sin(rl), m2=1-AM_GCJ_EE*m*m, sq=Math.sqrt(m2);
  dLat=(dLat*180.0)/((AM_GCJ_A*(1-AM_GCJ_EE))/(m2*sq)*Math.PI);
  dLng=(dLng*180.0)/(AM_GCJ_A/sq*Math.cos(rl)*Math.PI);
  return [lng+dLng, lat+dLat];
}

/* ==========================================================================
   6. 选中态 / InfoWindow / 抽屉渲染 / API 增量刷新 / 定位
   ========================================================================== */
/* V 是工厂返回的普通对象；以下方法由 amExtend(V) 挂载。 */
function amExtend(V){
  V.select=function(i){
    var s=V.segs.find(function(x){return x.i===i;});if(!s||!V.map)return;
    var selected=[];V.lines.forEach(function(x){x.pl.setOptions({strokeWeight:x.seg===i?8:4,strokeOpacity:x.seg===i?1:.35});if(x.seg===i)selected.push(x.pl);});
    if(selected.length)V.map.setFitView(selected,false,[35,70,35,35],16);
    amToast(s.L.nm+' · '+amDist(s.dist)+(s.dur?' · '+amDur(s.dur):'')+(s.api?'（原稿预计算路网）':'（直线口径）'));
  };

  /* ---- 6.1 选中某站 → 放大描边 + InfoWindow ---- */
  V.selectStop=function(idx, stop, mode){
    V.sel=idx;
    for(var i=0;i<V.markers.length;i++){
      V.markers[i].el.classList.toggle('am-mk-on', V.markers[i].idx===idx && V.markers[i].mode===mode);
    }
    var drawer=!V.inline&&AM.ovl&&AM.ovl.querySelector('#amDrawer');
    if(drawer&&drawer.classList.contains('am-open')){
      amToggleDrawer();
      setTimeout(function(){
        if(V.map&&V.sel===idx&&AM.ovl.classList.contains('on')){ V.map.resize(); V.openIW(stop, mode, idx); }
      },300);
    }else V.openIW(stop, mode, idx);
    /* 抽屉里对应行高亮并滚动到可见 */
    if(V.onDrawer) { try{V.onDrawer(idx);}catch(e){} }
  };

  /* ---- 6.2 InfoWindow ---- */
  V.openIW=function(stop, mode, idx){
    if(!V.map||!window.AMap) return;
    var poi=AM_POI[stop.id]||{};
    var name=stop.name||poi.name||'';
    var amName=stop.amap_name||poi.amap_name||name;
    var h='<div class="am-iw" role="dialog" aria-label="'+amEsc(name)+'">';
    h+='<button class="am-iw-x" data-am-iwclose aria-label="关闭">'+icon('close')+'</button>';
    h+='<div class="am-iw-hd"><span class="am-iw-no" style="background:'+amEsc(mode.color||'#4a7c74')+'">'+amNum(idx+1)+'</span>'
      +'<div><div class="am-iw-t">'+amEsc(name)+'</div>'
      +(stop.t?'<div class="am-iw-time">🕐 计划 '+amEsc(stop.t)+(mode.date?' · '+amEsc(mode.date):'')+'</div>':'')+'</div></div>';
    if(stop.note) h+='<div class="am-iw-note">'+amFmt(stop.note)+'</div>';
    if(stop.address||poi.address) h+='<div class="am-iw-row"><span class="am-iw-k">📍 地址</span><span>'+amEsc(stop.address||poi.address)+'</span></div>';
    /* 原稿高德数据数据（构建期地理编码取得）—— 用【原稿高德数据】徽标明确口径 */
    var ot=stop.opentime||poi.opentime, rt=stop.rating||poi.rating, tl=stop.tel||poi.tel;
    if(ot||rt||tl){
      h+='<div class="am-iw-am"><span class="am-iw-badge">原稿高德数据</span>';
      if(rt) h+='<div class="am-iw-row"><span class="am-iw-k">⭐ 评分</span><span class="am-num">'+amEsc(rt)+'</span></div>';
      if(ot) h+='<div class="am-iw-row"><span class="am-iw-k">🕘 营业</span><span class="am-iw-ot">'+amEsc(ot)+'</span></div>';
      if(tl) h+='<div class="am-iw-row"><span class="am-iw-k">📞 电话</span><span>'
            +String(tl).split(';').slice(0,2).map(function(x){
               return '<a class="am-tel am-num" href="tel:'+amEsc(x.replace(/[^0-9]/g,''))+'">'+amEsc(x)+'</a>';}).join(' ')
            +'</span></div>';
      h+='</div>';
    }
    if(poi.rectag) h+='<div class="am-iw-row"><span class="am-iw-k">🏷️ 推荐</span><span>'+amEsc(poi.rectag)+'</span></div>';
    if(poi.fixnote) h+='<div class="am-iw-fix">📌 坐标口径：'+amEsc(poi.fixnote)+'</div>';
    h+='<div class="am-iw-co am-num">GCJ-02 '+Number(stop.lng).toFixed(5)+', '+Number(stop.lat).toFixed(5)+'</div>';
    h+='<div class="am-iw-act">'
      +'<a class="am-btn am-btn-pri" href="'+amAmapUrl(amName)+'" target="_blank" rel="noopener">🧭 在高德打开</a>'
      +'<button class="am-btn" data-copy="'+amEsc(name)+'">📋 复制名称</button>'
      +'</div></div>';

    var box=document.createElement('div');
    box.innerHTML=styleGlyphs(h);
    box=box.firstChild;
    try{
      if(V.iw){ V.iw.close(); V.iw=null; }
      V.iw=new AMap.InfoWindow({
        isCustom:true, content:box, offset:new AMap.Pixel(0,-20),
        autoMove:true, closeWhenClickMap:true, anchor:'bottom-center'
      });
      var closeBtn=box.querySelector('[data-am-iwclose]');
      if(closeBtn) closeBtn.addEventListener('click',function(e){
        e.preventDefault(); e.stopPropagation();
        try{ V.iw&&V.iw.close(); }catch(err){} V.iw=null; V.sel=-1;
        for(var i=0;i<V.markers.length;i++) V.markers[i].el.classList.remove('am-mk-on');
      });
      /* InfoWindow 内部点击：自己处理复制（因为 stopPropagation 会阻断页面
         既有的 document 级 [data-copy] 委托），再阻止冒泡以免触发 closeWhenClickMap */
      box.addEventListener('click',function(e){
        var cp=e.target.closest&&e.target.closest('[data-copy]');
        if(cp){
          e.preventDefault();
          try{ if(typeof copyText==='function') copyText(cp.getAttribute('data-copy')); }catch(err){}
        }
        e.stopPropagation();
      });
      V.iw.open(V.map,[stop.lng,stop.lat]);
    }catch(e){}
  };

  /* ---- 6.3 抽屉/概况面板渲染（回调由外部提供） ---- */
  V.paint=function(){ if(V.onPaint) V.onPaint(); };

  /* ---- 6.4 🔴 API 增量请求：仅单日/备选模式，全览模式一律不调 ---- */
  V.queueApi=function(){
    var mode=V.mode; if(!mode||mode.k==='all'||!V.map) return;
    var myTok=V.token;
    for(var i=0;i<V.segs.length;i++){
      var s=V.segs[i];
      if(!s.L.api) continue;                            /* boat/mountain/foot → 永不调 API */
      if(AM_CACHE[mode.k+'#'+s.i]) continue;            /* 已有结果或已在队列 */
      /* metro/bus：note 里作者已写好「约25—30分钟」→ 尊重原文，不再用 API 覆盖 */
      if((s.leg==='metro'||s.leg==='bus') && amNoteHasTime(s.note)) continue;
      (function(sg){
        amRequest(mode.k, sg.i, sg.leg, sg.from, sg.to);
      })(s);
    }
    if(myTok!==V.token) return;
  };

  /* ---- 6.5 API 结果落地 → 增量替换数值 + 重画该段折线 ---- */
  V.applyCache=function(segIdx){
    var mode=V.mode; if(!mode) return;
    var c=AM_CACHE[mode.k+'#'+segIdx];
    if(!c||c.pending) return;
    var s=null;
    for(var i=0;i<V.segs.length;i++) if(V.segs[i].i===segIdx){ s=V.segs[i]; break; }
    if(!s) return;
    if(c.fail){ s.apiFail=true; V.paint(); return; }
    if(c.dist){ s.dist=c.dist; s.api=true; }
    if(c.dur){ s.dur=c.dur; s.api=true; }
    /* 用真实路网折线替换直线（仅 walk/drive 返回 path） */
    if(c.path&&c.path.length>1){
      s.path=c.path;
      for(var j=0;j<V.lines.length;j++){
        if(V.lines[j].seg===segIdx){
          try{ V.lines[j].pl.setPath(c.path); }catch(e){}
        }
      }
    }
    V.paint();
  };

  /* ---- 6.6 定位到我：改用浏览器原生 navigator.geolocation ----
     🔒 方案0：高德定位插件属服务类插件（需安全密钥），故改用浏览器原生定位 API。
     ⚠️ 关键坑：浏览器返回 WGS-84，高德底图是 GCJ-02。中国境内不转换会偏移约
        300—600 米，蓝点会掉到隔壁街区。故必须做 WGS84→GCJ02 转换（amWgs2Gcj）。
     ⚠️ 浏览器仅在 https 或 localhost 下允许定位；file:// 打开时会直接失败 →
        已有 fail() 回退到行程地图中心，不会卡死。 ---- */
  V.locate=function(){
    if(!V.map){ amToast('地图未就绪'); return; }
    var fail=function(msg){
      amToast(msg||'定位失败，已回到行程地图中心',2600);
      try{ V.map.setZoomAndCenter(13,AM_CENTER); }catch(e){}
    };
    if(!navigator.geolocation){ fail('当前浏览器不支持定位，已回到行程地图中心'); return; }
    amToast('正在获取位置…',1400);
    try{
      navigator.geolocation.getCurrentPosition(function(pos){
        try{
          var ll=amWgs2Gcj(pos.coords.longitude, pos.coords.latitude);
          V.map.setZoomAndCenter(15,ll);
          var mk=new AMap.Marker({position:ll,anchor:'center',zIndex:300,
                                  content:'<div class="am-me"></div>'});
          V.map.add(mk);
          if(V.meMk){ try{V.map.remove(V.meMk);}catch(e){} }
          V.meMk=mk;
          amToast('✅ 已定位（精度 '+(pos.coords.accuracy?Math.round(pos.coords.accuracy)+'m':'未知')
                  +'，已校正 GCJ-02 偏移）',2800);
        }catch(e){ fail(); }
      }, function(err){
        fail(err&&err.code===1?'定位权限被拒绝，已回到行程地图中心'
            :err&&err.code===3?'定位超时，已回到行程地图中心'
            :'无法获取定位，已回到行程地图中心');
      }, {enableHighAccuracy:true, timeout:9000, maximumAge:60000});
    }catch(e){ fail(); }
  };
}

/* ==========================================================================
   7. 全屏地图浮层
   ========================================================================== */
var AM={
  ovl:null, ov:null,          /* 浮层根节点 / 浮层 viewer */
  inl:null, iv:null,          /* 行程 Tab 内嵌容器 / 内嵌 viewer */
  mode:'all',                 /* 浮层当前模式 */
  tripView:'tl',              /* 行程 Tab 视图：'tl' 时间轴 | 'map' 地图 */
  obs:null, injecting:false, ready:false
};

function amBuildOverlay(){
  if(AM.ovl) return AM.ovl;
  var root=document.createElement('div');
  root.className='am-mask';
  root.id='am-ovl';
  root.setAttribute('role','dialog');
  root.setAttribute('aria-modal','true');
  root.setAttribute('aria-label',data.destination+'旅行路线地图');
  root.innerHTML=
    '<div class="am-panel">'
    +'<div class="am-top">'
      +'<button class="am-top-x" data-amclose aria-label="关闭地图">'+icon('close')+'</button>'
      +'<div class="am-top-t"><div class="am-top-h">'+icon('map')+' 路线地图</div>'
      +'<div class="am-top-s" id="amModeName">全程总览</div></div>'
      +'<button class="am-top-b" id="amLocBtn" aria-label="定位到我" title="定位到我">'+icon('locate')+'</button>'
    +'</div>'
    +'<div class="am-chips am-chips-mode" id="amModes"></div>'
    +'<div class="am-chips am-chips-cat" id="amCats"></div>'
    +'<div class="am-canvas">'
      +'<div class="am-map" id="amMap"></div>'
      +'<div class="am-legend" id="amLegend"></div>'
      +'<div class="am-pill" id="amPill"></div>'
      +'<div class="am-load" id="amLoad"><div class="am-spin"></div><div>正在加载地图…</div></div>'
      +'<div class="am-fbwrap" id="amFb"></div>'
    +'</div>'
    +'<div class="am-drawer" id="amDrawer">'
      +'<button class="am-dhd" id="amDhd" aria-expanded="false">'
        +'<span class="am-grab"></span>'
        +'<span class="am-dsum" id="amDsum">—</span>'
        +'<span class="am-darrow">'+icon('chevron-up')+'</span>'
      +'</button>'
      +'<div class="am-dbody" id="amDbody"></div>'
    +'</div>'
    +'</div>';
  document.body.appendChild(root);
  AM.ovl=root;

  /* 关闭：✕ / ESC / 点遮罩空白处 */
  root.addEventListener('click',function(e){
    if(e.target===root) amCloseOverlay();
    if(e.target.closest('[data-amclose]')) amCloseOverlay();
    var chip=e.target.closest('[data-ammode]');
    if(chip){ amSetOverlayMode(chip.getAttribute('data-ammode')); if(AM.ov&&AM.ov.map)requestAnimationFrame(function(){AM.ov.map.resize();AM.ov.fit();}); return; }
    var cat=e.target.closest('[data-amcat]');
    if(cat){ amToggleCat(cat.getAttribute('data-amcat')); return; }
    if(e.target.closest('#amLocBtn')){ if(AM.ov) AM.ov.locate(); else amToast('地图尚未就绪'); return; }
    if(e.target.closest('#amDhd')){ amToggleDrawer(); return; }
    var sg=e.target.closest('[data-amseg]');
    if(sg){ amFocusSeg(+sg.getAttribute('data-amseg')); return; }
    var sp=e.target.closest('[data-amstop]');
    if(sp){ amFocusStop(+sp.getAttribute('data-amstop')); return; }
    var op=e.target.closest('[data-amopen]');
    if(op){ amOpenUrl(op.getAttribute('data-amopen')); return; }
  });
  document.addEventListener('keydown',function(e){
    if(e.key==='Escape'&&AM.ovl&&AM.ovl.classList.contains('on')) amCloseOverlay();
  });

  /* 渲染模式 chips */
  var mh='';
  for(var i=0;i<AM_MODES.length;i++){
    var m=AM_MODES[i];
    mh+='<button class="am-chip am-mchip" data-ammode="'+m.k+'"'
      +' style="--amc:'+m.color+'"><i class="am-dot"></i>'+amEsc(m.label)+'</button>';
  }
  root.querySelector('#amModes').innerHTML=mh;
  /* 渲染图层 chips */
  var ch='';
  for(var j=0;j<AM_CATS.length;j++){
    ch+='<button class="am-chip am-cchip on" data-amcat="'+AM_CATS[j].k+'">'+amEsc(AM_CATS[j].n)+'</button>';
  }
  root.querySelector('#amCats').innerHTML=ch;
  return root;
}

function amOpenOverlay(modeK){
  var root=amBuildOverlay();
  var prev=document.activeElement;
  AM._prevFocus=prev;
  root.classList.add('on');root.querySelector('[data-amclose]').focus();
  document.body.classList.add('am-lock');          /* 锁背景滚动 */
  if(modeK) AM.mode=modeK;
  amPaintChips();
  amEnsureOverlayViewer();
  requestAnimationFrame(function(){requestAnimationFrame(function(){if(AM.ov&&AM.ov.map){AM.ov.map.resize();AM.ov.fit();}});});
}
function amCloseOverlay(){
  if(!AM.ovl) return;
  AM.ovl.classList.remove('on');
  document.body.classList.remove('am-lock');
  try{ if(AM.ov&&AM.ov.iw) AM.ov.iw.close(); }catch(e){}
  if(AM._prevFocus&&AM._prevFocus.focus) { try{AM._prevFocus.focus();}catch(e){} }
}
function amPaintChips(){
  if(!AM.ovl) return;
  var ms=AM.ovl.querySelectorAll('[data-ammode]');
  for(var i=0;i<ms.length;i++) ms[i].classList.toggle('on', ms[i].getAttribute('data-ammode')===AM.mode);
  var cs=AM.ovl.querySelectorAll('[data-amcat]');
  for(var j=0;j<cs.length;j++) cs[j].classList.toggle('on', !!(AM.ov&&AM.ov.cats[cs[j].getAttribute('data-amcat')]));
  var m=AM_MODE_BY_K[AM.mode];
  var nm=AM.ovl.querySelector('#amModeName');
  if(nm&&m) nm.textContent = m.k==='all' ? AM_ROUTES.days.length+' 天全览 · '+AM_ROUTES.days.reduce(function(n,d){return n+d.stops.length;},0)+' 站' : (m.label+' · '+m.title);
}
function amToggleCat(k){
  if(!AM.ov) return;
  AM.ov.cats[k]=!AM.ov.cats[k];
  var on=0; for(var i=0;i<AM_CATS.length;i++) if(AM.ov.cats[AM_CATS[i].k]) on++;
  if(on===0){ AM.ov.cats[k]=true; amToast('至少保留一个图层'); }
  else { AM.ov.draw(); AM.ov.fit(); }
  amPaintChips();
  amPaintDrawer();
}
function amToggleDrawer(){
  var d=AM.ovl&&AM.ovl.querySelector('#amDrawer');
  if(!d) return;
  var open=d.classList.toggle('am-open');
  var hd=AM.ovl.querySelector('#amDhd');
  if(hd) hd.setAttribute('aria-expanded', open?'true':'false');
  if(AM.ov){ AM.ov.drawerH = open?Math.round(window.innerHeight*0.52):64; AM.ov.fit(); }
}
function amSetOverlayMode(k){
  if(!AM_MODE_BY_K[k]) return;
  AM.mode=k;
  amPaintChips();
  var fb=AM.ovl.querySelector('#amFb'); if(fb) fb.innerHTML='';
  if(AM.ov&&AM.ov.map){
    AM.ov.setMode(k);
    amPaintLegend();
  }else{
    amEnsureOverlayViewer();
  }
}
/* 图例：仅全览模式显示分天配色 + 线型口径 */
function amPaintLegend(){
  var box=AM.ovl&&AM.ovl.querySelector('#amLegend');
  if(!box) return;
  if(AM.mode!=='all'){ box.innerHTML=''; box.classList.remove('on'); return; }
  var h='<div class="am-lg-t">分天配色</div>';
  for(var i=0;i<AM_ROUTES.days.length;i++){
    var d=AM_ROUTES.days[i];
    h+='<div class="am-lg-r"><i style="background:'+d.color+'"></i>DAY'+d.d+' <span>'+amEsc(d.date)+'</span></div>';
  }
  h+='<div class="am-lg-t">线型口径</div>'
    +'<div class="am-lg-r"><b class="am-lg-l am-lg-solid"></b>道路（实测）</div>'
    +'<div class="am-lg-r"><b class="am-lg-l am-lg-mtn"></b>山径（直线）</div>'
    +'<div class="am-lg-r"><b class="am-lg-l am-lg-boat"></b>游船（水面直线）</div>';
  box.innerHTML=h;
  box.classList.add('on');
}
function amPill(txt,ms){
  var p=AM.ovl&&AM.ovl.querySelector('#amPill');
  if(!p) return;
  if(!txt){ p.classList.remove('on'); p.innerHTML=''; return; }
  p.innerHTML=styleGlyphs(txt); p.classList.add('on');
  clearTimeout(p._t);
  if(ms) p._t=setTimeout(function(){ p.classList.remove('on'); }, ms);
}

/* ---- 8.1 确保浮层 viewer 已创建（触发懒加载 → 成功建图 / 失败降级） ---- */
function amEnsureOverlayViewer(){
  var root=AM.ovl; if(!root) return;
  var load=root.querySelector('#amLoad'), fb=root.querySelector('#amFb');
  if(AM.ov&&AM.ov.map){ AM.ov.setMode(AM.mode); amPaintLegend(); return; }
  if(amSDK.st==='failed'){ amOverlayDegrade(); return; }
  load.classList.add('on'); fb.innerHTML='';
  amLoadSDK(function(err){
    if(!AM.ovl||!AM.ovl.classList.contains('on')) { if(!err) amWarmOverlay(); return; }
    load.classList.remove('on');
    if(err||!window.AMap){ amOverlayDegrade(); return; }
    amWarmOverlay();
  });
}
/* 浮层虽未打开也把 SDK 建好（预热），第二次打开零等待 */
function amWarmOverlay(){
  var root=AM.ovl; if(!root) return;
  var el=root.querySelector('#amMap');
  if(!AM.ov){
    AM.ov=amViewer({el:el, inline:false, onPaint:amPaintDrawer, onDrawer:amDrawerHighlight});
    if(!AM.ov.create()){ amOverlayDegrade(); return; }
  }
  root.querySelector('#amLoad').classList.remove('on');
  root.querySelector('#amFb').innerHTML='';
  AM.ov.setMode(AM.mode);
  amPaintLegend();amPaintChips();
}
/* 🔴 降级：地图不可用 → 友好卡片 + 纯文字逐段路线（数据内联，断网可用） */
function amOverlayDegrade(){
  var root=AM.ovl; if(!root) return;
  root.querySelector('#amLoad').classList.remove('on');
  root.querySelector('#amLegend').classList.remove('on');
  var fb=root.querySelector('#amFb');
  var m=AM_MODE_BY_K[AM.mode];
  var h='';
  if(m.k==='all'){
    h+='<div class="am-fb">';
    h+='<div class="am-fb-hd"><span class="am-fb-ic">📴</span><div><b>地图需要网络，当前不可用</b>'
      +'<div class="am-fb-sub">高德底图脚本未能加载（离线 / 12 秒超时 / 被网络策略拦截）。所有坐标与里程已内联，下面按天给出纯文字路线，每个点都能一键在高德打开。</div></div></div>';
    for(var i=0;i<AM_ROUTES.days.length;i++){
      var d=AM_ROUTES.days[i], sg=amBuildSegs({stops:d.stops,color:d.color}), su=amSum(sg);
      h+='<div class="am-fb-day" style="--amc:'+d.color+'">'
        +'<button class="am-fb-dhd" data-amfbday="'+d.d+'"><i></i>DAY'+d.d+' · '+amEsc(d.date)+' · '+amEsc(d.title)
        +'<span class="am-fb-dsum">'+d.stops.length+' 站 · '+amDist(su.road+su.mtn+su.water)+'</span></button>'
        +'<div class="am-fb-dbd">'+amFallbackList(d.stops,d.color,sg)+'</div></div>';
    }
    for(var j=0;j<AM_ROUTES.alt.length;j++){
      var a=AM_ROUTES.alt[j], sg2=amBuildSegs({stops:a.stops,color:a.color}), su2=amSum(sg2);
      h+='<div class="am-fb-day" style="--amc:'+a.color+'">'
        +'<button class="am-fb-dhd" data-amfbday="a'+j+'"><i></i>'+amEsc(a.title.slice(0,22))
        +'<span class="am-fb-dsum">'+a.stops.length+' 站 · '+amDist(su2.road+su2.mtn+su2.water)+'</span></button>'
        +'<div class="am-fb-dbd">'+amFallbackList(a.stops,a.color,sg2)+'</div></div>';
    }
    h+='</div>';
  }else{
    h=amFallbackHTML(m);
  }
  fb.innerHTML=h;
  fb.classList.add('on');
  /* 降级卡片内的按天折叠 */
  fb.addEventListener('click',function(e){
    var b=e.target.closest('[data-amfbday]');
    if(!b) return;
    var d=b.parentNode; d.classList.toggle('am-open');
  });
  amPill('',0);
}
function amFallbackList(stops,color,segs){
  var h='<ol class="am-fb-list">';
  for(var i=0;i<stops.length;i++){
    var p=stops[i], sg=segs[i-1];
    if(sg) h+='<li class="am-fb-leg"><span class="am-fb-lic">'+sg.L.ic+'</span><span>'
      +amEsc(sg.L.nm)+' · '+amDist(sg.dist)+(sg.leg==='mountain'?'（实际步行更长）':'')
      +(sg.gapMin?' · 计划间隔 '+sg.gapMin+' 分钟':'')
      +(sg.note?'<span class="am-fb-note">'+amFmt(sg.note)+'</span>':'')+'</span></li>';
    h+='<li class="am-fb-stop"><span class="am-fb-no" style="background:'+amEsc(color)+'">'+amNum(i+1)+'</span>'
      +'<div class="am-fb-bd"><div class="am-fb-t">'+(p.t?'<span class="am-fb-time">'+amEsc(p.t)+'</span>':'')+amEsc(p.name)+'</div>'
      +(p.address?'<div class="am-fb-ad">'+amEsc(p.address)+'</div>':'')
      +'<div class="am-fb-act"><a class="am-btn am-btn-pri" href="'+amAmapUrl(p.amap_name||p.name)+'" target="_blank" rel="noopener">🧭 在高德打开</a>'
      +(typeof mapBtn==='function'?mapBtn(p.amap_name||p.name):'')+'</div></div></li>';
  }
  return h+'</ol>';
}

/* ---- 8.2 抽屉：概况 + 逐段列表 ---- */
function amPaintDrawer(){
  var root=AM.ovl; if(!root||!AM.ov) return;
  var sum=root.querySelector('#amDsum'), body=root.querySelector('#amDbody');
  var V=AM.ov, mode=V.mode; if(!mode) return;
  var st=mode.stops||[], sg=V.segs, su=amSum(sg);

  if(mode.k==='all'){
    var tot=0; for(var i=0;i<AM_ROUTES.days.length;i++) tot+=AM_ROUTES.days[i].stops.length;
    sum.innerHTML='<b>'+AM_ROUTES.days.length+' 天全览</b> · '+tot+' 站 · '+AM_ROUTES.days.length+' 条路线'
      +'<span class="am-dsum-x">历史路线数据；全览里程为直线口径</span>';
    var h='<div class="am-dtip">全览模式只显示直线距离，避免一次性发出几十个规划请求。点上方任一 <b>DAY</b> 芯片可查看该日<b>原稿高德数据路网</b>里程与耗时。</div>';
    h+='<div class="am-dlist">';
    for(var j=0;j<AM_ROUTES.days.length;j++){
      var d=AM_ROUTES.days[j], s2=amBuildSegs({stops:d.stops}), u2=amSum(s2);
      h+='<button class="am-dayrow" data-ammode="'+('d'+d.d)+'" style="--amc:'+d.color+'">'
        +'<i></i><span class="am-dr-t">DAY'+d.d+' <em>'+amEsc(d.date)+'</em></span>'
        +'<span class="am-dr-d">'+amEsc(d.title)+'</span>'
        +'<span class="am-dr-m am-num">'+d.stops.length+' 站 · '+amDist(u2.road+u2.mtn+u2.water)+'</span></button>';
    }
    h+='</div>';
    body.innerHTML=h;
    return;
  }

  sum.innerHTML='<b>'+amEsc(mode.label)+'</b> · '+st.length+' 站 · '+amSumText(su)
    +(su.apiN?'<span class="am-dsum-api am-num">'+su.apiN+'/'+sg.length+' 段原稿高德数据</span>':'');

  var hh='';
  /* 口径说明：山径/水面/道路必须分开标注，这是「精准真实」的关键 */
  hh+='<div class="am-dtip">';
  if(su.mtn) hh+='⛰️ 山径 <b>'+amDist(su.mtn)+'</b> 为直线距离（高德步行路网沿机动车道计算，会给山脊线几十公里的荒谬绕行，故不采用）；实际步行更长。';
  if(su.water) hh+='⛵ 水面 <b>'+amDist(su.water)+'</b> 为湖面直线距离。';
  if(su.road) hh+='🛣️ 道路 <b>'+amDist(su.road)+'</b>'+(su.apiN?'（含 '+su.apiN+' 段<b>原稿高德数据路网</b>）':'（直线估算，未包含该段预计算路网，显示直线估算）')+'。';
  hh+='</div><div class="am-dlist">';
  for(var n=0;n<st.length;n++){
    var p=st[n], s=sg[n-1];
    if(s){
      hh+='<div class="am-legrow'+(s.api?' am-api':'')+'" data-amseg="'+s.i+'">'
        +'<span class="am-lr-ic">'+s.L.ic+'</span><span class="am-lr-bd">'
        +'<span class="am-lr-t">'+amEsc(s.L.nm)+' · '+amDist(s.dist)
        +(s.dur?' · '+amDur(s.dur):'')
        +(s.api?'<i class="am-tag am-tag-api">原稿高德数据</i>':'<i class="am-tag">'+amEsc(s.L.tag)+'</i>')
        +(s.leg==='mountain'?'<i class="am-tag am-tag-w">实际步行更长</i>':'')
        +(s.gapMin?'<i class="am-tag am-tag-g">计划间隔 '+s.gapMin+' 分钟</i>':'')
        +'</span>'
        +(s.note?'<span class="am-lr-n">'+amFmt(s.note)+'</span>':'')
        +'</span></div>';
    }
    var poi=AM_POI[p.id]||{};
    hh+='<button class="am-stoprow" data-amstop="'+n+'" style="--amc:'+amEsc(mode.color)+'">'
      +'<span class="am-sr-no">'+amNum(n+1)+'</span>'
      +'<span class="am-sr-bd"><span class="am-sr-t">'+(p.t?'<em class="am-num">'+amEsc(p.t)+'</em>':'')+amEsc(p.name)+'</span>'
      +(p.address||poi.address?'<span class="am-sr-a">'+amEsc(p.address||poi.address)+'</span>':'')
      +((p.rating||poi.rating)?'<span class="am-sr-r">⭐ '+amEsc(p.rating||poi.rating)+' · 原稿高德数据</span>':'')
      +'</span></button>';
  }
  hh+='</div>';
  body.innerHTML=styleGlyphs(hh);
  amPill(su.apiN&&su.apiN===sg.filter(function(x){return !!x.L.api&&!((x.leg==='metro'||x.leg==='bus')&&amNoteHasTime(x.note));}).length
        ? '✅ 已完成 '+su.apiN+' 段原稿高德数据路网' : (su.apiN? '历史路网数据 '+su.apiN+' 段…':''), su.apiN?2600:0);
}
function amDrawerHighlight(idx){
  var root=AM.ovl; if(!root) return;
  var rows=root.querySelectorAll('.am-stoprow');
  for(var i=0;i<rows.length;i++){
    var on=(+rows[i].getAttribute('data-amstop')===idx);
    rows[i].classList.toggle('on',on);
    if(on&&root.querySelector('#amDrawer').classList.contains('am-open')&&rows[i].scrollIntoView) { try{rows[i].scrollIntoView({block:'nearest',behavior:amReduce()?'auto':'smooth'});}catch(e){} }
  }
}
function amFocusSeg(i){
  var V=AM.ov; if(!V||!V.map||!V.segs) return;
  var s=null; for(var k=0;k<V.segs.length;k++) if(V.segs[k].i===i) s=V.segs[k];
  if(!s) return;
  for(var j=0;j<V.lines.length;j++){
    V.lines[j].pl.setOptions({strokeWeight: V.lines[j].seg===i?8:4, strokeOpacity: V.lines[j].seg===i?1:.35});
  }
  try{ V.map.setFitView([V.lines.filter(function(x){return x.seg===i;})[0].pl],false,[60,180,60,60],16); }catch(e){}
  amToast(s.L.nm+' '+amDist(s.dist)+(s.dur?' · '+amDur(s.dur):'')+(s.api?'（原稿高德数据）':'（直线口径）'),2400);
}
function amFocusStop(i){
  var V=AM.ov; if(!V||!V.map) return;
  var mk=null;
  for(var k=0;k<V.markers.length;k++) if(V.markers[k].idx===i) mk=V.markers[k];
  if(mk){ try{ V.map.setCenter([mk.stop.lng,mk.stop.lat]); }catch(e){} V.selectStop(i, mk.stop, mk.mode); }
}

function amCurDayKey(){ return 'd'+(dayIndex+1); }
function amPaintInlineFoot(){
 var ft=document.getElementById('amInFt');if(!ft)return;
 var m=AM_MODE_BY_K[AM.imode];if(!m)return;
 var sg=AM.iv&&AM.iv.segs.length?AM.iv.segs:amBuildSegs(m),su=amSum(sg);
 ft.innerHTML='<div class="am-in-sum">'+m.stops.length+' 站 · '+amSumText(su)+(su.apiN?' · '+su.apiN+' 段原稿预计算路网':'')+'</div><div class="map-note">坐标系 GCJ-02；路线与营业资料截至 '+amEsc(data.map.asOf||data.asOf)+'。道路使用原稿预计算路网，山径与水面为直线口径；并非实时路况。</div><div class="am-in-act"><button class="am-btn am-btn-pri" data-amfull>'+icon('expand')+' 全屏地图</button><button class="am-btn" data-aminline-loc>'+icon('locate')+' 定位到我</button><button class="am-btn" data-amview="tl">回时间轴</button></div>';
}
function amReleaseInline(){
 if(AM.iv){if(AM.iv.map)AM.iv.map.destroy();var i=amViewers.indexOf(AM.iv);if(i>=0)amViewers.splice(i,1);AM.iv=null;}
}
function amMountInline(){
 amReleaseInline();AM.imode=amCurDayKey();var host=document.getElementById('am-inline');if(!host)return;
 var m=AM_MODE_BY_K[AM.imode];if(!m){host.innerHTML='<p class="map-note">此日尚未提供地图坐标与路线数据。</p>';return;}
 document.getElementById('amInHd').innerHTML='<span class="am-in-dot"></span><div class="am-in-tt"><b>'+amEsc(m.label)+'</b> · '+amEsc(m.title)+'</div>';
 amPaintInlineFoot();var loading=document.getElementById('amInLoad');loading.classList.add('on');
 amLoadSDK(function(err){
  if(document.getElementById('am-inline')!==host)return;
  loading.classList.remove('on');
  if(err){host.dataset.mapStatus='failed';var fb=document.getElementById('amInFb');fb.innerHTML=amFallbackHTML(m);fb.classList.add('on');host.classList.add('am-degraded');return;}
  AM.iv=amViewer({el:document.getElementById('amInMap'),inline:true,onPaint:amPaintInlineFoot});
  if(!AM.iv.create()){host.dataset.mapStatus='failed';toast('地图初始化未完成，请在高德打开地点。');return;}
  host.dataset.mapStatus='ready';AM.iv.setMode(AM.imode);
 });
}
function amOpenCurrent(k){AM.imode=amCurDayKey();amOpenOverlay(k||AM.imode);}
window.travelMap={mount:amMountInline,release:amReleaseInline,open:amOpenCurrent,close:amCloseOverlay};
document.addEventListener('click',function(e){
 var t=e.target;
 if(t.closest('[data-amfull]')||t.closest('#am-fab')){amOpenCurrent();return;}
 if(t.closest('[data-map-all]')){amOpenCurrent('all');return;}
 if(t.closest('[data-aminline-loc]')){if(AM.iv)AM.iv.locate();else toast('地图尚未就绪');return;}
 if(t.closest('[data-amview="tl"]')){view='timeline';renderTrip();}
});
new MutationObserver(function(){amViewers.forEach(function(v){v.theme();});}).observe(document.body,{attributes:true,attributeFilter:['data-theme']});
var resizeTimer;window.addEventListener('resize',function(){clearTimeout(resizeTimer);resizeTimer=setTimeout(function(){amViewers.forEach(function(v){if(v.map){v.map.resize();v.fit();}});},240);});
var fab=document.createElement('button');fab.id='am-fab';fab.className='am-fab';fab.setAttribute('aria-label','打开路线地图');fab.innerHTML=icon('map');document.body.appendChild(fab);
if(current==='trip'&&view==='route')amMountInline();
})();
