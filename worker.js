/**
 * worker.js — Cloudflare Worker + Durable Objects · 单房间德州扑克
 * v2: 持久🍓、借🍓功能、解散房间投票
 */

// ═══════════════════════════════════════════════
// §1  主 Worker 入口
// ═══════════════════════════════════════════════

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin':  '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Upgrade, Authorization',
        },
      });
    }
    const id   = env.POKER_ROOM.idFromName('main-room');
    const stub = env.POKER_ROOM.get(id);
    return stub.fetch(request);
  },
};

// ═══════════════════════════════════════════════
// §3  Admin Panel HTML（内联）
// ═══════════════════════════════════════════════

const ADMIN_HTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>♠ 管理后台</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}

:root{
  --bg:#0a0c0f;
  --surface:#111418;
  --surface2:#181c22;
  --border:#252a33;
  --border-focus:#4a90d9;
  --text:#e2e8f0;
  --muted:#6b7280;
  --green:#22c55e;
  --red:#ef4444;
  --blue:#3b82f6;
  --yellow:#f59e0b;
  --gold:#c9973a;
}

body{
  background:var(--bg);
  color:var(--text);
  font-family:-apple-system,'Segoe UI',system-ui,sans-serif;
  min-height:100vh;
  font-size:14px;
}

/* ── Login ───────────────────────────────────── */
#login-wrap{
  min-height:100vh;
  display:flex;align-items:center;justify-content:center;
  padding:20px;
  background:radial-gradient(ellipse 80% 60% at 50% 0%,rgba(74,144,217,.12) 0%,transparent 70%),var(--bg);
}
.login-card{
  width:100%;max-width:380px;
  background:var(--surface);
  border:1px solid var(--border);
  border-radius:16px;
  padding:40px 36px;
  box-shadow:0 24px 64px rgba(0,0,0,.7);
}
.login-logo{
  text-align:center;margin-bottom:32px;
}
.login-logo .suit{font-size:3rem;line-height:1;display:block;margin-bottom:8px}
.login-logo h1{font-size:1.3rem;font-weight:700;color:var(--text);letter-spacing:.05em}
.login-logo p{font-size:.75rem;color:var(--muted);margin-top:4px}
.field{margin-bottom:16px}
.field label{display:block;font-size:.78rem;color:var(--muted);margin-bottom:6px;font-weight:600;letter-spacing:.04em;text-transform:uppercase}
.field input{
  width:100%;padding:11px 14px;
  background:var(--bg);
  border:1px solid var(--border);
  border-radius:8px;color:var(--text);
  font-size:.9rem;outline:none;
  transition:border-color .2s,box-shadow .2s;
}
.field input:focus{border-color:var(--border-focus);box-shadow:0 0 0 3px rgba(74,144,217,.15)}
.btn-primary{
  width:100%;padding:12px;border:none;border-radius:8px;
  background:var(--blue);color:#fff;
  font-size:.9rem;font-weight:700;cursor:pointer;
  transition:opacity .15s,transform .1s;letter-spacing:.03em;
}
.btn-primary:hover{opacity:.88}
.btn-primary:active{transform:scale(.98)}
#login-err{
  padding:9px 12px;border-radius:7px;font-size:.82rem;margin-bottom:14px;
  background:rgba(239,68,68,.15);border:1px solid rgba(239,68,68,.35);color:#fca5a5;
  display:none;
}

/* ── Main layout ─────────────────────────────── */
#main-wrap{display:none;padding:0 0 40px}
.top-bar{
  background:var(--surface);
  border-bottom:1px solid var(--border);
  padding:14px 24px;
  display:flex;align-items:center;justify-content:space-between;
  position:sticky;top:0;z-index:10;
}
.top-bar-left{display:flex;align-items:center;gap:12px}
.top-bar h1{font-size:.95rem;font-weight:700;color:var(--text);letter-spacing:.04em}
#sync-badge{
  font-size:.68rem;padding:2px 8px;border-radius:10px;
  background:rgba(34,197,94,.15);border:1px solid rgba(34,197,94,.3);color:var(--green);
}
.btn-sm{
  padding:6px 14px;border:none;border-radius:6px;cursor:pointer;
  font-size:.78rem;font-weight:600;transition:opacity .15s;white-space:nowrap;
}
.btn-sm:hover{opacity:.8}
.btn-logout{background:var(--surface2);color:var(--muted);border:1px solid var(--border)}

.container{max-width:960px;margin:0 auto;padding:20px 16px;display:flex;flex-direction:column;gap:16px}

/* ── Global message ──────────────────────────── */
/* ── Toast ────────────────────────────────── */
#toast-box{
  position:fixed;bottom:24px;right:24px;z-index:999;
  display:flex;flex-direction:column;gap:8px;pointer-events:none;
  max-width:320px;
}
.toast{
  padding:11px 16px;border-radius:9px;font-size:.83rem;font-weight:500;
  box-shadow:0 8px 24px rgba(0,0,0,.5);
  animation:toast-in .22s ease;
  pointer-events:none;
  line-height:1.4;
}
@keyframes toast-in{
  from{opacity:0;transform:translateY(10px) scale(.96)}
  to{opacity:1;transform:none}
}
.toast-ok{background:#14532d;border:1px solid #166534;color:#86efac}
.toast-err{background:#450a0a;border:1px solid #7f1d1d;color:#fca5a5}

/* ── Panel card ──────────────────────────────── */
.panel{
  background:var(--surface);
  border:1px solid var(--border);
  border-radius:12px;
  overflow:hidden;
}
.panel-head{
  padding:14px 20px;
  border-bottom:1px solid var(--border);
  display:flex;align-items:center;justify-content:space-between;
  gap:8px;flex-wrap:wrap;
}
.panel-title{font-size:.82rem;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.08em}
.panel-body{padding:20px}

/* ── Stat grid ───────────────────────────────── */
.stat-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(110px,1fr));gap:10px}
.stat-box{
  background:var(--surface2);border:1px solid var(--border);
  border-radius:8px;padding:14px 16px;text-align:center;
  display:flex;flex-direction:column;align-items:center;justify-content:center;
}
.stat-box .val{font-size:1.8rem;font-weight:800;color:var(--blue);line-height:1}
.stat-box .lbl{font-size:.7rem;color:var(--muted);margin-top:4px}
#sg.val{font-size:1.1rem}

/* ── Player table ────────────────────────────── */
.tbl-wrap{overflow-x:auto;-webkit-overflow-scrolling:touch}
table{width:100%;border-collapse:collapse;min-width:560px}
thead th{
  padding:9px 12px;text-align:left;
  font-size:.7rem;font-weight:700;color:var(--muted);
  text-transform:uppercase;letter-spacing:.07em;
  background:var(--surface2);white-space:nowrap;
}
tbody tr{border-bottom:1px solid var(--border);transition:background .1s}
tbody tr:last-child{border-bottom:none}
tbody tr:hover{background:rgba(255,255,255,.02)}
td{padding:10px 12px;vertical-align:middle;font-size:.85rem}
.role-badge{
  display:inline-block;padding:2px 8px;border-radius:10px;font-size:.7rem;font-weight:700;white-space:nowrap;
}
.role-p{background:rgba(59,130,246,.2);color:#93c5fd;border:1px solid rgba(59,130,246,.3)}
.role-a{background:var(--surface2);color:var(--muted);border:1px solid var(--border)}
.conn-dot{display:inline-block;width:7px;height:7px;border-radius:50%;vertical-align:middle;margin-right:4px}
.conn-on{background:var(--green)}.conn-off{background:var(--red)}

/* Inline edit cell */
.edit-cell{display:flex;align-items:center;gap:5px;flex-wrap:nowrap}
.edit-cell input[type=number]{
  width:80px;padding:5px 8px;
  background:var(--bg);border:1px solid var(--border);
  border-radius:5px;color:var(--text);font-size:.82rem;outline:none;
  transition:border-color .15s;
  -moz-appearance:textfield;
}
.edit-cell input[type=number]::-webkit-inner-spin-button{-webkit-appearance:none}
.edit-cell input[type=number]:focus{border-color:var(--border-focus)}
.edit-cell .apply{
  padding:4px 9px;border:none;border-radius:5px;
  font-size:.72rem;font-weight:700;cursor:pointer;transition:opacity .15s;white-space:nowrap;
}
.apply-c{background:rgba(34,197,94,.2);color:#86efac;border:1px solid rgba(34,197,94,.3)}
.apply-d{background:rgba(239,68,68,.2);color:#fca5a5;border:1px solid rgba(239,68,68,.3)}
.apply:hover{opacity:.75}
.op-btn{
  padding:4px 9px;border:none;border-radius:5px;cursor:pointer;
  font-size:.72rem;font-weight:700;transition:opacity .15s;white-space:nowrap;
}
.op-btn:hover{opacity:.75}
.op-kick{background:rgba(245,158,11,.15);color:#fcd34d;border:1px solid rgba(245,158,11,.3)}

/* ── Config form ─────────────────────────────── */
.cfg-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:12px;margin-bottom:16px}
.cfg-field label{display:block;font-size:.72rem;color:var(--muted);margin-bottom:5px;font-weight:600;text-transform:uppercase;letter-spacing:.04em}
.cfg-field input{
  width:100%;padding:8px 10px;
  background:var(--bg);border:1px solid var(--border);
  border-radius:6px;color:var(--text);font-size:.85rem;outline:none;
  transition:border-color .15s;
}
.cfg-field input:focus{border-color:var(--border-focus)}
.btn-save{padding:8px 20px;border:none;border-radius:7px;background:var(--blue);color:#fff;font-size:.82rem;font-weight:700;cursor:pointer;transition:opacity .15s}
.btn-save:hover{opacity:.85}
.btn-danger{padding:8px 20px;border:none;border-radius:7px;background:rgba(239,68,68,.15);color:#fca5a5;border:1px solid rgba(239,68,68,.3);font-size:.82rem;font-weight:700;cursor:pointer;transition:opacity .15s}
.btn-danger:hover{opacity:.8}

/* ── Dissolve confirm modal ───────────────── */
.modal-backdrop{display:none;position:fixed;inset:0;background:rgba(0,0,0,.65);z-index:200;align-items:center;justify-content:center;padding:16px;}
.modal-backdrop.open{display:flex;}
.modal-box{background:var(--panel);border:1px solid var(--border);border-radius:12px;padding:28px 24px;max-width:380px;width:100%;text-align:center;box-shadow:0 8px 32px rgba(0,0,0,.4);}
.modal-title{font-size:1rem;font-weight:700;margin-bottom:10px;color:#fca5a5;}
.modal-body{font-size:.82rem;color:var(--muted);margin-bottom:22px;line-height:1.65;}
.modal-btns{display:flex;gap:12px;justify-content:center;flex-wrap:wrap;}
.modal-btns .btn-save{background:rgba(239,68,68,.2);border:1px solid rgba(239,68,68,.4);color:#fca5a5;}
.modal-btns .btn-save:hover{background:rgba(239,68,68,.35);}

/* ── Pwd row ─────────────────────────────────── */
.pwd-row{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px}
@media(max-width:480px){.pwd-row{grid-template-columns:1fr}}
</style>
</head>
<body>

<!-- ══ Login ══════════════════════════════════ -->
<div id="login-wrap">
  <div class="login-card">
    <div class="login-logo">
      <span class="suit">♠</span>
      <h1>管理后台</h1>
      <p>Texas Hold'em · Admin Panel</p>
    </div>
    <div id="login-err"></div>
    <div class="field">
      <label>管理密码</label>
      <input type="password" id="pi" placeholder="请输入密码…" autocomplete="current-password" />
    </div>
    <button class="btn-primary" onclick="doLogin()">登 录</button>
  </div>
</div>

<!-- ══ Main ═══════════════════════════════════ -->
<div id="main-wrap">
  <div class="top-bar">
    <div class="top-bar-left">
      <h1>♠ 德州扑克 &nbsp;管理后台</h1>
      <span id="sync-badge">● 自动刷新</span>
    </div>
    <button class="btn-sm btn-logout" onclick="doLogout()">退出登录</button>
  </div>

  <div class="container">
    <!-- 状态卡片 -->
    <div class="panel">
      <div class="panel-head">
        <span class="panel-title">房间状态</span>
        <span id="ri" style="font-size:.7rem;color:var(--muted)"></span>
      </div>
      <div class="panel-body">
        <div class="stat-grid">
          <div class="stat-box"><div class="val" id="ss">-</div><div class="lbl">在座玩家</div></div>
          <div class="stat-box"><div class="val" id="sa">-</div><div class="lbl">观众</div></div>
          <div class="stat-box"><div class="val" id="sp">-</div><div class="lbl">底池</div></div>
          <div class="stat-box"><div class="val" id="sg" style="font-size:1.1rem">-</div><div class="lbl">阶段</div></div>
        </div>
      </div>
    </div>

    <!-- 人员管理 -->
    <div class="panel">
      <div class="panel-head">
        <span class="panel-title">人员管理</span>
      </div>
      <div class="tbl-wrap">
        <table id="pt">
          <thead>
            <tr>
              <th>昵称</th>
              <th>角色</th>
              <th>连接</th>
              <th>筹码</th>
              <th>欠款</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody></tbody>
        </table>
      </div>
    </div>

    <!-- 游戏配置 -->
    <div class="panel">
      <div class="panel-head"><span class="panel-title">游戏配置</span></div>
      <div class="panel-body">
        <div class="cfg-grid">
          <div class="cfg-field"><label>小盲注</label><input type="number" id="csb" min="1"/></div>
          <div class="cfg-field"><label>大盲注</label><input type="number" id="cbb" min="1"/></div>
          <div class="cfg-field"><label>初始筹码</label><input type="number" id="cic" min="100" step="100"/></div>
          <div class="cfg-field"><label>最大座位数</label><input type="number" id="cms" min="2" max="20"/></div>
          <div class="cfg-field"><label>断线超时（分钟）</label><input type="number" id="cdt" min="1"/></div>
          <div class="cfg-field"><label>摊牌延迟（秒）</label><input type="number" id="csd" min="1"/></div>
          <div class="cfg-field"><label>聊天记录上限（条）</label><input type="number" id="ccl" min="10" max="500" step="10" title="房间最多保留的聊天条数，超出后最早的一条自动删除"/></div>
          <div class="cfg-field" style="grid-column:1/-1;display:flex;align-items:flex-start;flex-direction:column;gap:8px;padding:8px 0;border-top:1px solid #2a2e38;margin-top:4px">
            <label style="white-space:nowrap;font-weight:700;font-size:.78rem;color:var(--muted);text-transform:uppercase;letter-spacing:.06em">借米模式</label>
            <div style="display:flex;gap:20px;flex-wrap:wrap;align-items:center">
              <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:.85rem">
                <input type="radio" name="cbm" id="cbm-bank" value="bank" style="accent-color:#c8a840;cursor:pointer;width:15px;height:15px"/>
                银行借（低于上限每次+1000）
              </label>
              <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:.85rem">
                <input type="radio" name="cbm" id="cbm-peer" value="peer" style="accent-color:#c8a840;cursor:pointer;width:15px;height:15px"/>
                找人借（玩家间转账，需双方确认）
              </label>
            </div>
          </div>
          <div class="cfg-field" id="borrow-limit-row" style="grid-column:1/-1;display:flex;align-items:center;gap:12px;flex-wrap:wrap;padding:6px 0;border-top:1px solid #2a2e38">
            <label style="white-space:nowrap;font-weight:600">借米限制</label>
            <label style="display:flex;align-items:center;gap:6px;cursor:pointer">
              <input type="checkbox" id="cble" style="width:16px;height:16px;accent-color:#c8a840;cursor:pointer"/>
              开启
            </label>
            <label style="display:flex;align-items:center;gap:6px">
              借米条件--不超过
              <input type="number" id="cbl" min="0" step="50" style="width:90px" title="当玩家笹码超过此数时不准开启借米"/>
            </label>
          </div>
        </div>
        <button class="btn-save" onclick="saveConfig()">保存配置</button>
      </div>
    </div>

    <!-- 房间操作 -->
    <div class="panel">
      <div class="panel-head"><span class="panel-title">房间操作</span></div>
      <div class="panel-body">
        <button class="btn-danger" onclick="forceDiss()"> 强制解散房间（清除所有数据）</button>
      </div>
    </div>

    <!-- 修改密码 -->
    <div class="panel">
      <div class="panel-head"><span class="panel-title">修改管理密码</span></div>
      <div class="panel-body">
        <div class="pwd-row">
          <div class="cfg-field"><label>新密码</label><input type="password" id="np" placeholder="新密码"/></div>
          <div class="cfg-field"><label>确认密码</label><input type="password" id="np2" placeholder="再次输入"/></div>
        </div>
        <button class="btn-save" onclick="changePwd()">修改密码</button>
      </div>
    </div>
  </div>
</div>

<script>
var BASE=location.origin,TOKEN=localStorage.getItem('at')||'',timer=null;

function showMsg(txt,ok){
  if(!txt)return;
  var box=document.getElementById('toast-box');
  var t=document.createElement('div');
  t.className='toast '+(ok?'toast-ok':'toast-err');
  t.textContent=txt;
  box.appendChild(t);
  setTimeout(function(){
    t.style.transition='opacity .3s,transform .3s';
    t.style.opacity='0';t.style.transform='translateY(6px)';
    setTimeout(function(){if(t.parentNode)t.parentNode.removeChild(t);},320);
  },2800);
}

async function api(path,method,body){
  var opts={method:method||'GET',headers:{'Authorization':'Bearer '+TOKEN,'Content-Type':'application/json'}};
  if(body)opts.body=JSON.stringify(body);
  var r=await fetch(BASE+path,opts);
  return {ok:r.ok,status:r.status,data:await r.json().catch(function(){return{};})};
}

async function doLogin(){
  var pwd=document.getElementById('pi').value.trim();
  if(!pwd)return;
  var r=await api('/admin/login','POST',{password:pwd});
  if(r.ok&&r.data.token){
    TOKEN=r.data.token;localStorage.setItem('at',TOKEN);showMain();
  } else {
    var el=document.getElementById('login-err');
    el.textContent=r.data.error||'登录失败，请检查密码';
    el.style.display='block';
  }
}

function doLogout(){
  TOKEN='';localStorage.removeItem('at');clearInterval(timer);
  document.getElementById('main-wrap').style.display='none';
  document.getElementById('login-wrap').style.display='flex';
}

function showMain(){
  document.getElementById('login-wrap').style.display='none';
  document.getElementById('main-wrap').style.display='block';
  load();timer=setInterval(load,5000);
}

var STAGES={waiting:'等待',preflop:'翻牌前',flop:'翻牌',turn:'转牌',river:'河牌',showdown:'摊牌'};

async function load(){
  var r=await api('/admin/state');
  if(r.status===401){doLogout();return;}
  if(!r.ok)return;
  var d=r.data;
  document.getElementById('ss').textContent=d.seated;
  document.getElementById('sa').textContent=d.audience;
  document.getElementById('sp').textContent=d.pot;
  document.getElementById('sg').textContent=STAGES[d.stage]||d.stage;
  document.getElementById('ri').textContent='更新于 '+new Date().toLocaleTimeString();
  if(d.config){
    document.getElementById('csb').value=d.config.smallBlind;
    document.getElementById('cbb').value=d.config.bigBlind;
    document.getElementById('cic').value=d.config.initialChips;
    document.getElementById('cms').value=d.config.maxSeats;
    document.getElementById('cdt').value=Math.round(d.config.disconnectTtl/60000);
    document.getElementById('csd').value=Math.round(d.config.showdownDelay/1000);
    document.getElementById('ccl').value=d.config.chatHistoryLimit||50;
    document.getElementById('cble').checked=d.config.borrowLimitEnabled!==false;
    document.getElementById('cbl').value=d.config.borrowLimit??500;
    var _bm=d.config.borrowMode||'bank';
    var _bmEl=document.getElementById('cbm-'+_bm);
    if(_bmEl)_bmEl.checked=true;
    document.getElementById('borrow-limit-row').style.display=_bm==='bank'?'flex':'none';
  }
  buildTable(d.players||[]);
}

function buildTable(players){
  var tb=document.querySelector('#pt tbody');
  // 保留各行 input 当前值（避免刷新时清空正在输入的内容）
  var inputVals={};
  tb.querySelectorAll('tr[data-id]').forEach(function(tr){
    var id=tr.dataset.id;
    var ci=tr.querySelector('.ci');var di=tr.querySelector('.di');
    if(ci)inputVals[id+':c']=ci.value;
    if(di)inputVals[id+':d']=di.value;
  });
  tb.innerHTML='';
  players.forEach(function(p){
    var tr=document.createElement('tr');
    tr.dataset.id=p.id;
    var role=p.role==='player'
      ?'<span class="role-badge role-p">玩家</span>'
      :'<span class="role-badge role-a">观众</span>';
    var conn='<span class="conn-dot '+(p.connected?'conn-on':'conn-off')+'"></span>'+(p.connected?'在线':'离线');
    // chips input — 保留用户正在输入的值
    var cv=inputVals[p.id+':c']!==undefined?inputVals[p.id+':c']:p.chips;
    var dv=inputVals[p.id+':d']!==undefined?inputVals[p.id+':d']:(p.debt||0);
    var chips='<div class="edit-cell">'
      +'<input type="number" class="ci" value="'+cv+'" min="0" />'
      +'<button class="apply apply-c" onclick="setChips(\\''+p.id+'\\',this)">设置</button>'
      +'</div>';
    var debt='<div class="edit-cell">'
      +'<input type="number" class="di" value="'+dv+'" min="0" />'
      +'<button class="apply apply-d" onclick="setDebt(\\''+p.id+'\\',this)">设置</button>'
      +'</div>';
    var ops=p.role==='player'
      ?'<button class="op-btn op-kick" onclick="kickP(\\''+p.id+'\\')">→观众</button>'
      :'';
    tr.innerHTML='<td><b>'+p.name+'</b></td><td>'+role+'</td><td>'+conn+'</td>'
      +'<td>'+chips+'</td><td>'+debt+'</td><td>'+ops+'</td>';
    tb.appendChild(tr);
  });
}

async function setChips(id,btn){
  var input=btn.parentElement.querySelector('.ci');
  var val=parseInt(input.value,10);
  if(isNaN(val)||val<0){showMsg('请输入有效筹码数（≥0）',false);return;}
  var r=await api('/admin/set-chips','POST',{playerId:id,chips:val});
  showMsg(r.data.message||r.data.error,r.ok);
  if(r.ok)load();
}

async function setDebt(id,btn){
  var input=btn.parentElement.querySelector('.di');
  var val=parseInt(input.value,10);
  if(isNaN(val)||val<0){showMsg('请输入有效欠款数（≥0）',false);return;}
  var r=await api('/admin/set-debt','POST',{playerId:id,debt:val});
  showMsg(r.data.message||r.data.error,r.ok);
  if(r.ok)load();
}

async function kickP(id){
  if(!confirm('确认将该玩家移至观众席？'))return;
  var r=await api('/admin/kick','POST',{playerId:id});
  showMsg(r.data.message||r.data.error,r.ok);load();
}

async function saveConfig(){
  var body={
    smallBlind:+document.getElementById('csb').value,
    bigBlind:+document.getElementById('cbb').value,
    initialChips:+document.getElementById('cic').value,
    maxSeats:+document.getElementById('cms').value,
    disconnectTtl:+document.getElementById('cdt').value*60000,
    showdownDelay:+document.getElementById('csd').value*1000,
    chatHistoryLimit:+document.getElementById('ccl').value,
    borrowLimitEnabled:document.getElementById('cble').checked,
    borrowLimit:+document.getElementById('cbl').value||500,
    borrowMode:document.querySelector('input[name="cbm"]:checked')?.value||'bank'
  };
  var r=await api('/admin/config','POST',body);
  showMsg(r.data.message||r.data.error,r.ok);
}

function forceDiss(){
  document.getElementById('confirm-modal').classList.add('open');
}
async function confirmDiss(){
  document.getElementById('confirm-modal').classList.remove('open');
  var r=await api('/admin/dissolve','POST');
  showMsg(r.data.message||r.data.error,r.ok);load();
}

async function changePwd(){
  var p1=document.getElementById('np').value,p2=document.getElementById('np2').value;
  if(!p1){showMsg('密码不能为空',false);return;}
  if(p1!==p2){showMsg('两次密码不一致',false);return;}
  var r=await api('/admin/change-password','POST',{newPassword:p1});
  showMsg(r.data.message||r.data.error,r.ok);
  if(r.ok){document.getElementById('np').value='';document.getElementById('np2').value='';}
}

// 自动登录 & 回车支持
if(TOKEN){api('/admin/state').then(function(r){if(r.ok)showMain();else{TOKEN='';localStorage.removeItem('at');}});}
document.getElementById('pi').addEventListener('keydown',function(e){if(e.key==='Enter')doLogin();});
// 借米模式切换 → 实时显隐银行借米限制行
document.querySelectorAll('input[name="cbm"]').forEach(function(r){
  r.addEventListener('change',function(){
    document.getElementById('borrow-limit-row').style.display=this.value==='bank'?'flex':'none';
  });
});
</script>
<div id="confirm-modal" class="modal-backdrop">
  <div class="modal-box">
    <div class="modal-title">⚠ 确认解散房间？</div>
    <div class="modal-body">所有玩家数据（筹码、欠款）将被彺底清除，聊天记录同步清空。<br/>此操作<b>不可撤销</b>，请确认。</div>
    <div class="modal-btns">
      <button class="btn-save" onclick="confirmDiss()">确认解散</button>
      <button class="btn-danger" onclick="document.getElementById('confirm-modal').classList.remove('open')"> 取消</button>
    </div>
  </div>
</div>
<div id="toast-box"></div>
</body>
</html>`;

// ═══════════════════════════════════════════════
// §4  Durable Object
// ═══════════════════════════════════════════════

export class PokerRoom {
  constructor(state, env) {
    this.state = state;
    this.clients  = new Map();
    this.players  = [];   // 已上座的玩家（参与游戏）
    this.audience = [];   // 观众（旁观、等待上座）
    this.gameState = {
      deck:               [],
      community:          [],
      pot:                0,
      dealerIndex:        0,
      smallBlindIndex:    0,
      bigBlindIndex:      0,
      currentPlayerIndex: 0,
      currentBet:         0,
      stage:              'waiting',
      actedSet:           new Set(),
      lastRaiserIndex:    -1,
    };
    this.operationQueue   = Promise.resolve();
    this.cleanupScheduled = false;
    this.dissolveVotes    = new Set();
    this.startVotes       = new Set();
    this.kickVotes        = new Map(); // targetId → Set<voterId>
    this.chatHistory      = [];        // 聊天记录（内存，重启清零）
    this.pendingBorrowRequests = new Map(); // requestId → { fromId, toId, amount, timer }
    this.lastShowdown = null;          // 缓存最近一次摩牌结果，供重连用户补发

    // 可动态修改的配置
    this.config = {
      smallBlind:       10,
      bigBlind:         20,
      initialChips:     1000,
      maxSeats:         10,
      disconnectTtl:    5 * 60 * 1000,
      showdownDelay:    2000,
      chatHistoryLimit: 50,
      borrowLimitEnabled: true,        // ← 是否开启借米上限
      borrowLimit: 500,                // ← 筹码超过该值不能借
      borrowMode: 'bank',             // ← 借米模式: 'bank'银行借 | 'peer'找人借
    };

    // 管理员鉴权（token 仅内存保存，重启失效）
    this.adminPassword  = 'admin888';
    this.adminToken     = null;
    this.adminTokenExp  = 0;

    // 从持久存储加载玩家数据（🍓 + 欠款）+ 配置
    this.persistedPlayers = {};
    this.handStartChips   = {};  // 本局起始筹码，用于计算净盈亏
    this.state.blockConcurrencyWhile(async () => {
      const [pp, cfg, pwd] = await Promise.all([
        this.state.storage.get('persistedPlayers'),
        this.state.storage.get('config'),
        this.state.storage.get('adminPassword'),
      ]);
      this.persistedPlayers = pp || {};
      if (cfg) Object.assign(this.config, cfg);
      // 如果历史配置的摊牌延迟超过 2s，自动收紧到 2s
      if (this.config.showdownDelay > 2000) this.config.showdownDelay = 2000;
      if (pwd) this.adminPassword = pwd;
    });
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (request.headers.get('Upgrade') === 'websocket') {
      return this._upgradeWebSocket(request);
    }
    // ── 公开接口：战况统计（无需鉴权）────────────────────
    if (url.pathname === '/battle-stats') {
      if (request.method === 'OPTIONS') {
        return new Response(null, { headers: {
          'Access-Control-Allow-Origin':  '*',
          'Access-Control-Allow-Methods': 'GET, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
        }});
      }
      const stats = Object.entries(this.persistedPlayers)
        .filter(([, d]) => d.netProfit !== undefined)
        .map(([id, d]) => ({ id, name: d.name, netProfit: d.netProfit || 0 }))
        .sort((a, b) => b.netProfit - a.netProfit);
      return new Response(JSON.stringify({ stats }), {
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, OPTIONS',
        },
      });
    }

    if (url.pathname === '/status') {
      return new Response(
        JSON.stringify({
          status:   'ok',
          seated:   this.players.length,
          audience: this.audience.length,
          total:    this.players.length + this.audience.length,
          stage:    this.gameState.stage,
          pot:      this.gameState.pot,
        }),
        { headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } }
      );
    }
    // ── Admin 路由 ──────────────────────────────
    const p = url.pathname;

    // 管理页面
    if (p === '/admin' && request.method === 'GET') {
      return new Response(ADMIN_HTML, { headers: { 'Content-Type': 'text/html;charset=utf-8' } });
    }

    // CORS 预检（admin API）
    if (request.method === 'OPTIONS' && p.startsWith('/admin/')) {
      return new Response(null, { headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      }});
    }

    // 登录
    if (p === '/admin/login' && request.method === 'POST') {
      const body = await request.json().catch(() => ({}));
      if (body.password === this.adminPassword) {
        this.adminToken    = crypto.randomUUID();
        this.adminTokenExp = Date.now() + 24 * 3600 * 1000;
        return this._adminJson({ token: this.adminToken });
      }
      return this._adminJson({ error: '密码错误' }, 401);
    }

    // 需鉴权的 admin API
    if (p.startsWith('/admin/') && p !== '/admin/login') {
      if (!this._checkAdmin(request)) return this._adminJson({ error: '未授权，请重新登录' }, 401);

      // 房间实时状态
      if (p === '/admin/state' && request.method === 'GET') {
        const all = [...this.players, ...this.audience];
        return this._adminJson({
          seated:   this.players.length,
          audience: this.audience.length,
          pot:      this.gameState.pot,
          stage:    this.gameState.stage,
          config:   this.config,
          players:  all.map(x => ({
            id: x.id, name: x.name, chips: x.chips, debt: x.debt || 0,
            role: this.players.includes(x) ? 'player' : 'audience',
            connected: x.connected, pendingLeave: x.pendingAudience || false,
          })),
        });
      }

      if (request.method === 'POST') {
        const body = await request.json().catch(() => ({}));

        // 更新配置
        if (p === '/admin/config') {
          const allowed = ['smallBlind','bigBlind','initialChips','maxSeats','disconnectTtl','showdownDelay','chatHistoryLimit','borrowLimit'];
          for (const k of allowed) {
            if (body[k] !== undefined && Number.isFinite(+body[k]) && +body[k] >= 0) {
              this.config[k] = +body[k];
            }
          }
          if (typeof body.borrowLimitEnabled === 'boolean') {
            this.config.borrowLimitEnabled = body.borrowLimitEnabled;
          }
          if (body.borrowMode === 'bank' || body.borrowMode === 'peer') {
            this.config.borrowMode = body.borrowMode;
          }
          await this.state.storage.put('config', this.config);
          this._broadcastState();
          return this._adminJson({ message: '配置已保存' });
        }

        // 强制将玩家移至观众
        if (p === '/admin/kick') {
          const target = this.players.find(x => x.id === body.playerId)
                      || this.audience.find(x => x.id === body.playerId);
          if (!target) return this._adminJson({ error: '找不到该用户' }, 404);
          if (this.players.includes(target)) {
            this._moveToAudience(body.playerId, `[管理员] 将 ${target.name} 移至观众席`);
          }
          return this._adminJson({ message: `已操作 ${target.name}` });
        }

        // 调整🍓
        if (p === '/admin/give-chips') {
          const target = this.players.find(x => x.id === body.playerId)
                      || this.audience.find(x => x.id === body.playerId);
          if (!target) return this._adminJson({ error: '找不到该用户' }, 404);
          const amt = Math.round(+body.amount || 0);
          if (amt === 0) return this._adminJson({ error: '金额不能为 0' }, 400);
          target.chips = Math.max(0, (target.chips || 0) + amt);
          this._savePlayerData();
          this._broadcastState();
          return this._adminJson({ message: `${target.name} ◆调整 ${amt > 0 ? '+' : ''}${amt}，当前：${target.chips}` });
        }

        // 直接设置筹码为指定值
        if (p === '/admin/set-chips') {
          const target = this.players.find(x => x.id === body.playerId)
                      || this.audience.find(x => x.id === body.playerId);
          if (!target) return this._adminJson({ error: '找不到该用户' }, 404);
          const val = Math.round(+body.chips);
          if (!Number.isFinite(val) || val < 0) return this._adminJson({ error: '无效数值' }, 400);
          target.chips = val;
          this._savePlayerData();
          this._broadcastState();
          return this._adminJson({ message: `${target.name} 筹码已设为 ${val}` });
        }

        // 直接设置欠款为指定值
        if (p === '/admin/set-debt') {
          const target = this.players.find(x => x.id === body.playerId)
                      || this.audience.find(x => x.id === body.playerId);
          if (!target) return this._adminJson({ error: '找不到该用户' }, 404);
          const val = Math.round(+body.debt);
          if (!Number.isFinite(val) || val < 0) return this._adminJson({ error: '无效数值' }, 400);
          target.debt = val;
          this._savePlayerData();
          this._broadcastState();
          return this._adminJson({ message: `${target.name} 欠款已设为 ${val}` });
        }

        // 清除欠款
        if (p === '/admin/reset-debt') {
          const target = this.players.find(x => x.id === body.playerId)
                      || this.audience.find(x => x.id === body.playerId);
          if (!target) return this._adminJson({ error: '找不到该用户' }, 404);
          target.debt = 0;
          this._savePlayerData();
          this._broadcastState();
          return this._adminJson({ message: `${target.name} 赊已清零` });
        }

        // 强制解散
        if (p === '/admin/dissolve') {
          this._broadcast({ type: 'dissolve', message: '管理员强制解散了房间' });
          this.players = []; this.audience = [];
          this.dissolveVotes.clear(); this.kickVotes.clear();
          this.chatHistory = [];       // 解散时清空聊天记录
          this.persistedPlayers = {};
          await this.state.storage.delete('persistedPlayers').catch(() => {});
          const gs = this.gameState;
          gs.stage='waiting'; gs.community=[]; gs.pot=0;
          gs.currentBet=0; gs.actedSet=new Set(); gs.lastRaiserIndex=-1;
          return this._adminJson({ message: '房间已解散' });
        }

        // 修改管理密码
        if (p === '/admin/change-password') {
          if (!body.newPassword || body.newPassword.length < 4) {
            return this._adminJson({ error: '密码至少 4 位' }, 400);
          }
          this.adminPassword = body.newPassword;
          this.adminToken    = null; // 作废旧 token
          await this.state.storage.put('adminPassword', this.adminPassword);
          return this._adminJson({ message: '密码已修改，请重新登录' });
        }
      }

      return this._adminJson({ error: '未知 admin 路由' }, 404);
    }

    return new Response("Texas Hold'em Durable Object is running", { status: 200 });
  }

  // 检查 admin Bearer token
  _checkAdmin(request) {
    const auth  = request.headers.get('Authorization') || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    return !!(token && token === this.adminToken && Date.now() < this.adminTokenExp);
  }

  // 返回 JSON 响应（含 CORS）
  _adminJson(data, status = 200) {
    return new Response(JSON.stringify(data), {
      status,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    });
  }

  _upgradeWebSocket(request) {
    const url      = new URL(request.url);
    const playerId = url.searchParams.get('playerId') || crypto.randomUUID();
    const pair   = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    server.accept();
    this.clients.set(playerId, server);
    server.addEventListener('message', evt => {
      this._enqueue(() => this._handleMessage(playerId, evt.data));
    });
    server.addEventListener('close', () => {
      this._enqueue(() => {
        this.clients.delete(playerId);
        const player = this.players.find(p => p.id === playerId)
                    || this.audience.find(p => p.id === playerId);
        if (player) {
          player.connected = false;
          player.lastSeen  = Date.now();
          this._broadcastState();
          this._broadcast({ type: 'message', message: `${player.name} 断线` });
        }
      });
    });
    server.addEventListener('error', () => { this.clients.delete(playerId); });
    if (!this.cleanupScheduled) {
      this.cleanupScheduled = true;
      setInterval(() => this._cleanupStale(), 60_000);
    }
    return new Response(null, { status: 101, webSocket: client });
  }

  // 配置通过 this.config 访问，支持运行时修改

  _createDeck() {
    const SUITS = ['H', 'D', 'C', 'S'];
    const RANKS = ['2','3','4','5','6','7','8','9','T','J','Q','K','A'];
    const deck = [];
    for (const s of SUITS) for (const r of RANKS) deck.push(r + s);
    return deck;
  }

  _shuffleDeck(deck) {
    const d = [...deck];
    for (let i = d.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [d[i], d[j]] = [d[j], d[i]];
    }
    return d;
  }

  _rankValue(card) { return '23456789TJQKA'.indexOf(card[0]); }

  _combinations(arr, k) {
    if (k === 0) return [[]];
    if (arr.length < k) return [];
    const [head, ...tail] = arr;
    return [
      ...this._combinations(tail, k - 1).map(c => [head, ...c]),
      ...this._combinations(tail, k),
    ];
  }

  _evaluateHand5(cards) {
    const vals  = cards.map(c => this._rankValue(c)).sort((a, b) => b - a);
    const suits = cards.map(c => c[1]);
    const isFlush = suits.every(s => s === suits[0]);
    let isStraight = false, straightHigh = vals[0];
    if (new Set(vals).size === 5 && vals[0] - vals[4] === 4) isStraight = true;
    if (vals[0]===12 && vals[1]===3 && vals[2]===2 && vals[3]===1 && vals[4]===0) {
      isStraight = true; straightHigh = 3;
    }
    const cnt = {};
    for (const v of vals) cnt[v] = (cnt[v] || 0) + 1;
    const groups = Object.entries(cnt).map(([v,c])=>[+v,c]).sort((a,b)=>b[1]-a[1]||b[0]-a[0]);
    const g = groups.map(x => x[1]);
    if (isFlush && isStraight)    return [8, straightHigh];
    if (g[0]===4)                 return [7, groups[0][0], groups[1][0]];
    if (g[0]===3 && g[1]===2)    return [6, groups[0][0], groups[1][0]];
    if (isFlush)                  return [5, ...vals];
    if (isStraight)               return [4, straightHigh];
    if (g[0]===3)                 return [3, groups[0][0], groups[1][0], groups[2][0]];
    if (g[0]===2 && g[1]===2)    return [2, groups[0][0], groups[1][0], groups[2][0]];
    if (g[0]===2)                 return [1, groups[0][0], groups[1][0], groups[2][0], groups[3][0]];
    return [0, ...vals];
  }

  _compareScores(a, b) {
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      const ai = a[i]??-1, bi = b[i]??-1;
      if (ai>bi) return 1; if (ai<bi) return -1;
    }
    return 0;
  }

  _evaluateBestHand(cards) {
    let best = null;
    for (const combo of this._combinations(cards, 5)) {
      const score = this._evaluateHand5(combo);
      if (!best || this._compareScores(score, best) > 0) best = score;
    }
    return best;
  }

  _handRankName(score) {
    return ['高牌','一对','两对','三条','顺子','同花','葫芦','四条','同花顺'][score[0]]??'未知';
  }

  _broadcast(msg) {
    const str = JSON.stringify(msg);
    for (const ws of this.clients.values()) try { ws.send(str); } catch(_) {}
  }

  _sendTo(playerId, msg) {
    const ws = this.clients.get(playerId);
    if (ws) try { ws.send(JSON.stringify(msg)); } catch(_) {}
  }

  _broadcastState() {
    const gs = this.gameState;
    const allUsers        = [...this.players, ...this.audience];
    const seatedConnected = this.players.filter(p => p.connected);
    const allConnected    = allUsers.filter(p => p.connected);
    const dissolveCount   = [...this.dissolveVotes].filter(id => allConnected.find(p=>p.id===id)).length;
    const startCount      = [...this.startVotes].filter(id => seatedConnected.find(p=>p.id===id)).length;

    // 踢人投票状态
    const kickStatus = [];
    for (const [targetId, voters] of this.kickVotes.entries()) {
      const target = allUsers.find(p => p.id === targetId);
      if (!target) continue;
      const count = [...voters].filter(id => seatedConnected.find(p=>p.id===id)).length;
      kickStatus.push({ targetId, targetName: target.name, count, needed: Math.floor(seatedConnected.length / 2) });
    }

    const currentPlayerId = gs.currentPlayerIndex >= 0 && this.players[gs.currentPlayerIndex]
      ? this.players[gs.currentPlayerIndex].id : null;

    // 公开信息：玩家+观众
    const pub = allUsers.map(p => {
      const pIdx    = this.players.indexOf(p);
      const isSeated = pIdx !== -1;
      return {
        id: p.id, name: p.name, chips: p.chips, bet: p.bet || 0,
        folded: p.folded || false, allIn: p.allIn || false, connected: p.connected,
        isDealer: isSeated && pIdx === gs.dealerIndex,
        isSB:     isSeated && pIdx === gs.smallBlindIndex,
        isBB:     isSeated && pIdx === gs.bigBlindIndex,
        handCount: p.hand ? p.hand.length : 0,
        debt: p.debt || 0,
        role: isSeated ? 'player' : 'audience',
        votedDissolve: this.dissolveVotes.has(p.id),
        votedStart:    this.startVotes.has(p.id),
        pendingLeave:  p.pendingAudience || false,
      };
    });

    // 分别发送（玩家有手牌，观众没有）
    for (const person of allUsers) {
      const ws = this.clients.get(person.id);
      if (!ws) continue;
      const isSeated = this.players.includes(person);
      try {
        ws.send(JSON.stringify({
          type: 'state', players: pub, community: gs.community,
          pot: gs.pot, stage: gs.stage,
          currentPlayerId,
          currentBet: gs.currentBet,
          selfHand: isSeated ? (person.hand || []) : [],
          selfId:   person.id,
          selfRole: isSeated ? 'player' : 'audience',
          selfNetProfit: (this.persistedPlayers[person.id] || {}).netProfit || 0,
          dissolveVotes: dissolveCount, dissolveTotal: allConnected.length,
          startVotes:    startCount,    startTotal:    seatedConnected.length,
          kickStatus,
          maxSeats: this.config.maxSeats,
          config: {
            borrowLimitEnabled: this.config.borrowLimitEnabled,
            borrowLimit:        this.config.borrowLimit,
            borrowMode:         this.config.borrowMode || 'bank',
          },
        }));
      } catch(_) {}
    }
  }

  _getActionablePlayers() {
    return this.players.filter(p => !p.folded && !p.allIn && p.chips > 0);
  }

  _nextActionableIndex(startIdx) {
    const len = this.players.length;
    for (let i = 0; i < len; i++) {
      const idx = (startIdx + i) % len;
      const p = this.players[idx];
      if (!p.folded && !p.allIn && p.chips > 0) return idx;
    }
    return -1;
  }

  _startGame() {
    // 先处理 pendingAudience 玩家
    const remaining = [], toAudience = [];
    for (const p of this.players) {
      if (p.pendingAudience) { p.pendingAudience = false; toAudience.push(p); }
      else remaining.push(p);
    }
    this.players = remaining;
    for (const p of toAudience) this.audience.push(p);

    const connectable = this.players.filter(p => p.connected && p.chips > 0);
    if (connectable.length < 2) {
      this._broadcast({ type: 'error', message: '至少需要 2 名有◆且在线的玩家' }); return;
    }
    if (this.gameState.stage !== 'waiting') {
      this._broadcast({ type: 'error', message: '游戏已在进行中' }); return;
    }
    this.dissolveVotes.clear();
    this.startVotes.clear();
    this.kickVotes.clear();
    this.players = this.players.filter(p => p.chips > 0 || p.connected);
    for (const p of this.players) { p.folded=false; p.allIn=false; p.bet=0; p.hand=[]; p.totalCommitted=0; }
    const gs = this.gameState;
    gs.deck=this._shuffleDeck(this._createDeck()); gs.community=[];
    gs.pot=0; gs.actedSet=new Set(); gs.lastRaiserIndex=-1;
    gs.dealerIndex     = (gs.dealerIndex + 1) % this.players.length;
    gs.smallBlindIndex = (gs.dealerIndex + 1) % this.players.length;
    gs.bigBlindIndex   = (gs.dealerIndex + 2) % this.players.length;
    for (const p of this.players) p.hand = [gs.deck.pop(), gs.deck.pop()];
    // ── 记录本局起始筹码（盲注扣减前），用于结局净盈亏统计 ──
    this.handStartChips = {};
    for (const p of this.players) this.handStartChips[p.id] = p.chips;
    const sbP=this.players[gs.smallBlindIndex], bbP=this.players[gs.bigBlindIndex];
    const sbAmt=Math.min(this.config.smallBlind,sbP.chips), bbAmt=Math.min(this.config.bigBlind,bbP.chips);
    sbP.chips-=sbAmt; sbP.bet=sbAmt; sbP.totalCommitted=sbAmt; if(sbP.chips===0) sbP.allIn=true;
    bbP.chips-=bbAmt; bbP.bet=bbAmt; bbP.totalCommitted=bbAmt; if(bbP.chips===0) bbP.allIn=true;
    gs.pot=sbAmt+bbAmt; gs.currentBet=bbAmt; gs.stage='preflop';
    gs.currentPlayerIndex=this._nextActionableIndex((gs.bigBlindIndex+1)%this.players.length);
    this._broadcastState();
    this._broadcast({ type:'message', message:`[新局] 庄家：${this.players[gs.dealerIndex].name}，小：${sbP.name}，大：${bbP.name}` });
  }

  _handleAction(playerId, action, amount) {
    const gs = this.gameState;
    if (gs.stage==='waiting'||gs.stage==='showdown') {
      this._sendTo(playerId,{type:'error',message:'当前不是行动阶段'}); return;
    }
    const idx = this.players.findIndex(p => p.id===playerId);
    if (idx===-1) return;
    if (idx!==gs.currentPlayerIndex) {
      this._sendTo(playerId,{type:'error',message:'还没到你的回合'}); return;
    }
    const player = this.players[idx];
    if (player.folded||player.allIn) {
      this._sendTo(playerId,{type:'error',message:'你已弃牌或全押'}); return;
    }
    switch (action) {
      case 'fold':
        player.folded=true; gs.actedSet.add(playerId);
        this._broadcast({type:'message',message:`${player.name} 弃牌`}); break;
      case 'check':
        if (player.bet<gs.currentBet) { this._sendTo(playerId,{type:'error',message:'当前有注可跟，不能过牌'}); return; }
        gs.actedSet.add(playerId); this._broadcast({type:'message',message:`${player.name} 过牌`}); break;
      case 'call': {
        const need=Math.min(gs.currentBet-player.bet,player.chips);
        player.chips-=need; player.bet+=need; gs.pot+=need;
        player.totalCommitted=(player.totalCommitted||0)+need;
        if(player.chips===0) player.allIn=true;
        gs.actedSet.add(playerId); this._broadcast({type:'message',message:`${player.name} 跟注 ${need}`}); break;
      }
      case 'raise': {
        const minRaise=gs.currentBet*2;
        if(!amount||amount<minRaise){this._sendTo(playerId,{type:'error',message:`加注至少需要 ${minRaise}`});return;}
        const totalBet=Math.min(amount,player.chips+player.bet), addChips=totalBet-player.bet;
        if(addChips>player.chips){this._sendTo(playerId,{type:'error',message:'◆不足'});return;}
        player.chips-=addChips; gs.pot+=addChips; player.bet=totalBet; gs.currentBet=totalBet;
        player.totalCommitted=(player.totalCommitted||0)+addChips;
        if(player.chips===0) player.allIn=true;
        gs.actedSet=new Set([playerId]); gs.lastRaiserIndex=idx;
        this._broadcast({type:'message',message:`${player.name} 加注至 ${totalBet}`}); break;
      }
      case 'allin': {
        const allInAmt=player.chips; player.bet+=allInAmt; gs.pot+=allInAmt;
        player.totalCommitted=(player.totalCommitted||0)+allInAmt;
        if(player.bet>gs.currentBet){gs.currentBet=player.bet;gs.actedSet=new Set([playerId]);gs.lastRaiserIndex=idx;}
        else gs.actedSet.add(playerId);
        player.chips=0; player.allIn=true;
        this._broadcast({type:'message',message:`${player.name} 全押 ${allInAmt}`}); break;
      }
      default: this._sendTo(playerId,{type:'error',message:'未知操作类型'}); return;
    }
    this._advanceTurn();
  }

  _advanceTurn() {
    const active=this.players.filter(p=>!p.folded);
    if(active.length===1){
      // 其他人全部弃牌，剩余玩家赢得全部底池
      active[0].chips+=this.gameState.pot;
      this._broadcast({type:'message',message:`[\u80dc] ${active[0].name} 赢得 ${this.gameState.pot} ◆（其他人全部弃牌）`});
      this._endHand(); return;
    }
    if(this._isBettingRoundComplete()){ this._advanceStage(); return; }
    const next=this._nextActionableIndex((this.gameState.currentPlayerIndex+1)%this.players.length);
    // 找不到可行动玩家（剩余艟均已全押或弃牌），直接推进阶段
    if(next===-1){ this._advanceStage(); return; }
    this.gameState.currentPlayerIndex=next; this._broadcastState();
  }

  _isBettingRoundComplete() {
    const a=this._getActionablePlayers();
    if(a.length===0) return true;
    return a.every(p=>this.gameState.actedSet.has(p.id)&&p.bet===this.gameState.currentBet);
  }

  _advanceStage() {
    const gs=this.gameState;
    for(const p of this.players) p.bet=0;
    gs.currentBet=0; gs.actedSet=new Set(); gs.lastRaiserIndex=-1;
    // 发公共牌
    if(gs.stage==='preflop'){
      gs.stage='flop'; gs.community.push(gs.deck.pop(),gs.deck.pop(),gs.deck.pop());
      this._broadcast({type:'message',message:`[翻牌] ${gs.community.join(' ')}`});
    } else if(gs.stage==='flop'){
      gs.stage='turn'; gs.community.push(gs.deck.pop());
      this._broadcast({type:'message',message:`[转牌] ${gs.community[3]}`});
    } else if(gs.stage==='turn'){
      gs.stage='river'; gs.community.push(gs.deck.pop());
      this._broadcast({type:'message',message:`[河牌] ${gs.community[4]}`});
    } else if(gs.stage==='river'){
      gs.stage='showdown'; this._showdown(); return;
    } else { return; }
    // 检查是否还有玩家可以行动，如果全部全押则继续推进到摇牌
    const next=this._nextActionableIndex((gs.dealerIndex+1)%this.players.length);
    if(next===-1){ this._broadcastState(); this._advanceStage(); return; }  // 全压快进：先广播已发公共牌状态
    gs.currentPlayerIndex=next; this._broadcastState();
  }

  /**
   * 根据每位玩家本局总投入（totalCommitted）计算主池与边池
   * 返回 pots 数组，每项为 { amount, eligible: Player[] }
   */
  _buildSidePots() {
    // 获取所有唯一投入额度，升序
    const levels = [...new Set(this.players.map(p => p.totalCommitted || 0))]
      .filter(l => l > 0).sort((a, b) => a - b);
    const pots = [];
    let prev = 0;
    for (const level of levels) {
      const inPool = this.players.filter(p => (p.totalCommitted || 0) >= level);
      const amount = (level - prev) * inPool.length;
      if (amount <= 0) { prev = level; continue; }
      // 只有未弃牌且投入足够的玩家才有资格赢得此层底池
      const eligible = inPool.filter(p => !p.folded);
      pots.push({ amount, eligible });
      prev = level;
    }
    return pots;
  }

  _showdown() {
    const notFolded = this.players.filter(p => !p.folded);
    // 计算每位未弃牌玩家的最佳手牌
    const handScores = {};
    const handNames  = {};
    for (const p of notFolded) {
      const score = this._evaluateBestHand([...p.hand, ...this.gameState.community]);
      handScores[p.id] = score;
      handNames[p.id]  = this._handRankName(score);
    }
    // 构建主池/边池
    const pots = this._buildSidePots();
    // 每个玩家累计赢得🍓
    const winnings = {};
    const potResults = [];
    for (const pot of pots) {
      if (pot.eligible.length === 0) continue;
      let bestScore = null;
      for (const p of pot.eligible) {
        const s = handScores[p.id];
        if (!bestScore || this._compareScores(s, bestScore) > 0) bestScore = s;
      }
      const winners = pot.eligible.filter(p => this._compareScores(handScores[p.id], bestScore) === 0);
      const share = Math.floor(pot.amount / winners.length);
      for (const w of winners) {
        w.chips += share;
        winnings[w.id] = (winnings[w.id] || 0) + share;
      }
      potResults.push({
        amount: pot.amount,
        winners: winners.map(w => ({ id: w.id, name: w.name, amount: share, handName: handNames[w.id] })),
      });
    }
    // 汇总赢家列表（用于展示）
    const allWinners = Object.entries(winnings).map(([id, amount]) => {
      const p = this.players.find(p => p.id === id);
      return { id, name: p.name, amount, handName: handNames[id] || '' };
    });
    const showdownMsg = {
      type: 'showdown',
      results: notFolded.map(p => ({ id: p.id, name: p.name, hand: p.hand, handName: handNames[p.id] || '' })),
      winners: allWinners,
      pots: potResults,
      community: this.gameState.community,
      pot: this.gameState.pot,
    };
    this.lastShowdown = showdownMsg;  // 缓存以供重连用户补发
    this._broadcast(showdownMsg);
    this._broadcastState();
    setTimeout(() => this._endHand(), this.config.showdownDelay);
  }

  _endHand() {
    // 将 pendingAudience 玩家移至观众席
    const remaining2 = [];
    for (const p of this.players) {
      if (p.pendingAudience) {
        p.pendingAudience = false;
        p.folded = false; p.allIn = false; p.bet = 0; p.hand = [];
        this.audience.push(p);
      } else { remaining2.push(p); }
    }
    this.players = remaining2;
    // ── 结算净盈亏：遍历本局参与者，计算与起始筹码的差值 ──
    for (const [id, startChips] of Object.entries(this.handStartChips)) {
      const p = this.players.find(x => x.id === id) || this.audience.find(x => x.id === id);
      if (!p) continue;
      const delta = p.chips - startChips;
      const prev  = this.persistedPlayers[id] || {};
      this.persistedPlayers[id] = { ...prev, name: p.name, netProfit: (prev.netProfit || 0) + delta };
    }
    this.handStartChips = {};
    this.players=this.players.filter(p=>p.chips>0||p.connected);
    const gs=this.gameState;
    gs.stage='waiting'; gs.community=[]; gs.pot=0;
    gs.currentBet=0; gs.actedSet=new Set(); gs.lastRaiserIndex=-1;
    this.lastShowdown = null;  // 对局结束，清除摩牌缓存
    for(const p of this.players){p.folded=false;p.allIn=false;p.bet=0;p.hand=[];}
    this._savePlayerData();
    this._broadcastState();
    this._broadcast({type:'message',message:'本局结束，等待开始新一局…'});
  }

  /** 将所有玩家的🍓和欠款写入持久存储（保留 netProfit 等历史字段） */
  _savePlayerData() {
    const all = [...this.players, ...this.audience];
    for (const p of all) {
      const prev = this.persistedPlayers[p.id] || {};
      this.persistedPlayers[p.id] = { chips: p.chips, debt: p.debt || 0, name: p.name, netProfit: prev.netProfit || 0 };
    }
    this.state.storage.put('persistedPlayers', this.persistedPlayers).catch(() => {});
  }

  _cleanupStale() {
    const now=Date.now(), before=this.players.length+this.audience.length;
    const filter = arr => arr.filter(p => {
      if (p.pendingAudience) return true;
      if(!p.connected&&(now-p.lastSeen)>this.config.disconnectTtl){this.clients.delete(p.id);return false;}
      return true;
    });
    this.players  = filter(this.players);
    this.audience = filter(this.audience);
    if(this.players.length+this.audience.length<before) this._broadcastState();
  }

  _enqueue(fn) {
    this.operationQueue=this.operationQueue.then(()=>{try{fn();}catch(e){console.error('操作错误:',e);}});
  }

  // ─── 将玩家移至观众席（共用逻辑）──────────
  _moveToAudience(targetId, reason) {
    const targetIdx = this.players.findIndex(p => p.id === targetId);
    if (targetIdx === -1) return;
    const target = this.players[targetIdx];
    if (this.gameState.stage !== 'waiting') {
      if (!target.folded && !target.allIn) {
        target.folded = true;
        this.gameState.actedSet.add(targetId);
      }
      target.pendingAudience = true;
      this._broadcast({ type:'message', message:`${reason}（本局结束后生效）` });
      if (targetIdx === this.gameState.currentPlayerIndex) {
        this._advanceTurn();
      } else {
        this._broadcastState();
      }
    } else {
      this.players.splice(targetIdx, 1);
      target.bet = 0; target.folded = false; target.allIn = false; target.hand = [];
      this.audience.push(target);
      this.startVotes.delete(targetId);
      this.dissolveVotes.delete(targetId);
      this.kickVotes.delete(targetId);
      this._broadcastState();
      this._broadcast({ type:'message', message:reason });
    }
  }

  _handleMessage(playerId, raw) {
    let msg;
    try{msg=JSON.parse(raw);}catch(_){this._sendTo(playerId,{type:'error',message:'消息格式错误（需要 JSON）'});return;}
    switch(msg.type){

      // ── 加入房间（统一为观众入场）
      case 'join': {
        const inPlayers  = this.players.find(p => p.id === playerId);
        const inAudience = this.audience.find(p => p.id === playerId);
        if (inPlayers) {
          inPlayers.connected = true; inPlayers.lastSeen = Date.now();
          if (msg.name) {
            inPlayers.name = msg.name;
            if (this.persistedPlayers[playerId]) {
              this.persistedPlayers[playerId].name = msg.name;
              this.state.storage.put('persistedPlayers', this.persistedPlayers).catch(() => {});
            }
          }
          this._broadcastState();
          this._sendTo(playerId, { type: 'chat_history', messages: [...this.chatHistory] });
          if (this.lastShowdown && this.gameState.stage === 'showdown') {
            this._sendTo(playerId, this.lastShowdown);
          }
          this._broadcast({ type:'message', message:`${inPlayers.name} 重新连线（玩家）` });
        } else if (inAudience) {
          inAudience.connected = true; inAudience.lastSeen = Date.now();
          if (msg.name) {
            inAudience.name = msg.name;
            if (this.persistedPlayers[playerId]) {
              this.persistedPlayers[playerId].name = msg.name;
              this.state.storage.put('persistedPlayers', this.persistedPlayers).catch(() => {});
            }
          }
          this._broadcastState();
          this._sendTo(playerId, { type: 'chat_history', messages: [...this.chatHistory] });
          if (this.lastShowdown && this.gameState.stage === 'showdown') {
            this._sendTo(playerId, this.lastShowdown);
          }
          this._broadcast({ type:'message', message:`${inAudience.name} 重新连线（观众）` });
        } else {
          const name = (msg.name||'').trim()||`游客${this.audience.length+1}`;
          const persisted = this.persistedPlayers[playerId];
          const chips = (persisted && persisted.chips > 0) ? persisted.chips : this.config.initialChips;
          const debt  = persisted ? (persisted.debt || 0) : 0;
          if (persisted && name) {
            this.persistedPlayers[playerId].name = name;
            this.state.storage.put('persistedPlayers', this.persistedPlayers).catch(() => {});
          }
          this.audience.push({id:playerId,name,chips,debt,hand:[],folded:false,allIn:false,bet:0,connected:true,lastSeen:Date.now()});
          this._broadcastState();
          this._sendTo(playerId, { type: 'chat_history', messages: [...this.chatHistory] });
          if (this.lastShowdown && this.gameState.stage === 'showdown') {
            this._sendTo(playerId, this.lastShowdown);
          }
          this._broadcast({ type:'message', message:`${name} 进入观众席（◆ ${chips}${debt>0?' · 赊 '+debt:''}）` });
        }
        break;
      }

      // ── 上座
      case 'take_seat': {
        if (this.players.find(p => p.id === playerId)) {
          this._sendTo(playerId,{type:'error',message:'你已经在座位上了'}); return;
        }
        if (this.gameState.stage !== 'waiting') {
          this._sendTo(playerId,{type:'error',message:'游戏进行中，请等待本局结束后上座'}); return;
        }
        const inAud = this.audience.find(p => p.id === playerId);
        if (!inAud) return;
        if (this.players.length >= this.config.maxSeats) {
          this._sendTo(playerId,{type:'error',message:`座位已满（最多 ${this.config.maxSeats} 人）`}); return;
        }
        this.audience = this.audience.filter(p => p.id !== playerId);
        this.players.push(inAud);
        this._broadcastState();
        this._broadcast({type:'message',message:`${inAud.name} 上座加入游戏！`});
        break;
      }

      // ── 让座
      case 'give_seat': {
        const pIdx = this.players.findIndex(p => p.id === playerId);
        if (pIdx === -1) { this._sendTo(playerId,{type:'error',message:'你不在座位上'}); return; }
        const pName = this.players[pIdx].name;
        this.startVotes.delete(playerId);
        this.dissolveVotes.delete(playerId);
        this.kickVotes.delete(playerId);
        this._moveToAudience(playerId, `${pName} 主动让座`);
        break;
      }

      // ── 开始游戏投票
      case 'start_game': {
        if (this.gameState.stage !== 'waiting') {
          this._sendTo(playerId,{type:'error',message:'游戏已在进行中'}); break;
        }
        const startPlayer = this.players.find(p => p.id === playerId);
        if (!startPlayer) { this._sendTo(playerId,{type:'error',message:'只有玩家才能发起开始投票'}); break; }
        if (this.startVotes.has(playerId)) {
          this.startVotes.delete(playerId);
          this._broadcastState();
          this._broadcast({type:'message',message:`${startPlayer.name} 撤回了开始投票`});
        } else {
          this.startVotes.add(playerId);
          const connectedPlayers = this.players.filter(p => p.connected && p.chips > 0);
          const allVoted = connectedPlayers.length >= 2 && connectedPlayers.every(p => this.startVotes.has(p.id));
          this._broadcastState();
          this._broadcast({type:'message',message:`${startPlayer.name} 准备开始（${this.startVotes.size}/${connectedPlayers.length}）`});
          if (allVoted) this._startGame();
        }
        break;
      }

      case 'action': this._handleAction(playerId,msg.action,msg.amount); break;

      // ── 借🍓（銀行模式）
      case 'borrow': {
        if (this.gameState.stage !== 'waiting') {
          this._sendTo(playerId,{type:'error',message:'只能在等待阶段借🍓'}); return;
        }
        if (this.config.borrowMode === 'peer') {
          this._sendTo(playerId,{type:'error',message:'当前为「找人借」模式，请选择玩家'}); return;
        }
        const person = this.players.find(p=>p.id===playerId)||this.audience.find(p=>p.id===playerId);
        if (!person) return;
        // 借米限制检查
        if (this.config.borrowLimitEnabled !== false && person.chips > (this.config.borrowLimit ?? 500)) {
          this._sendTo(playerId,{type:'error',message:'你还有很多米，不准借'}); return;
        }
        person.chips += 1000; person.debt = (person.debt||0) + 1000;
        this._savePlayerData(); this._broadcastState();
        this._broadcast({type:'message',message:`${person.name} 向银行借了1000 ◆（累计赊 ${person.debt}）`});
        break;
      }

      // ── 借🍓（找人借模式）
      case 'borrow_peer': {
        if (this.gameState.stage !== 'waiting') {
          this._sendTo(playerId,{type:'error',message:'只能在等待阶段借米'}); return;
        }
        const amount = Math.round(+msg.amount||0);
        if (amount <= 0) {
          this._sendTo(playerId,{type:'error',message:'借米金额必须大于0'}); return;
        }
        const allPeople = [...this.players,...this.audience];
        const fromP = allPeople.find(p=>p.id===playerId);
        const toP   = allPeople.find(p=>p.id===msg.targetId);
        if (!fromP) return;
        if (!toP || toP.id === playerId) {
          this._sendTo(playerId,{type:'error',message:'无效的借米对象'}); return;
        }
        if (!toP.connected) {
          this._sendTo(playerId,{type:'error',message:'对方当前不在线'}); return;
        }
        if (toP.chips < amount) {
          this._sendTo(playerId,{type:'error',message:`${toP.name} 米不够（当前 ${toP.chips}）`}); return;
        }
        const requestId = crypto.randomUUID();
        const timer = setTimeout(() => {
          if (this.pendingBorrowRequests.has(requestId)) {
            this.pendingBorrowRequests.delete(requestId);
            this._sendTo(playerId,{type:'borrow_peer_result',success:false,message:'借米请求超时30秒未回应'});
          }
        }, 30000);
        this.pendingBorrowRequests.set(requestId,{fromId:playerId,toId:toP.id,amount,timer});
        this._sendTo(toP.id,{type:'borrow_peer_request',requestId,fromId:playerId,fromName:fromP.name,amount});
        this._sendTo(playerId,{type:'borrow_peer_result',success:null,message:`已向 ${toP.name} 发送请求，等待确认…`});
        break;
      }

      // ── 借🍓回应（被借方）
      case 'borrow_peer_respond': {
        const req = this.pendingBorrowRequests.get(msg.requestId);
        if (!req) { this._sendTo(playerId,{type:'error',message:'请求已过期或不存在'}); return; }
        if (req.toId !== playerId) return;
        clearTimeout(req.timer);
        this.pendingBorrowRequests.delete(msg.requestId);
        const allPeople2 = [...this.players,...this.audience];
        const fromP2 = allPeople2.find(p=>p.id===req.fromId);
        const toP2   = allPeople2.find(p=>p.id===req.toId);
        if (!msg.accept) {
          this._sendTo(req.fromId,{type:'borrow_peer_result',success:false,message:`${toP2?.name||'对方'} 拒绝了借米请求`});
          return;
        }
        if (!fromP2||!toP2) return;
        if (toP2.chips < req.amount) {
          this._sendTo(req.fromId,{type:'borrow_peer_result',success:false,message:`${toP2.name} 米不够，转账失败`});
          this._sendTo(playerId,{type:'error',message:'你的米不足，转账失败'});
          return;
        }
        toP2.chips   -= req.amount;
        fromP2.chips += req.amount;
        this._savePlayerData(); this._broadcastState();
        this._broadcast({type:'message',message:`${toP2.name} 借给 ${fromP2.name} ${req.amount} ◆`});
        this._sendTo(req.fromId,{type:'borrow_peer_result',success:true,message:`${toP2.name} 同意了！+${req.amount} ◆`});
        break;
      }

      // ── 解散投票（半数通过）
      case 'dissolve_vote': {
        const person = this.players.find(p=>p.id===playerId)||this.audience.find(p=>p.id===playerId);
        if (!person) return;
        if (this.dissolveVotes.has(playerId)) {
          this.dissolveVotes.delete(playerId);
          this._broadcastState();
          this._broadcast({type:'message',message:`${person.name} 撤回了解散投票`});
        } else {
          this.dissolveVotes.add(playerId);
          const allConnected = [...this.players,...this.audience].filter(p=>p.connected);
          const needed = Math.max(2, Math.floor(allConnected.length / 2));
          const count  = [...this.dissolveVotes].filter(id=>allConnected.find(p=>p.id===id)).length;
          this._broadcastState();
          this._broadcast({type:'message',message:`${person.name} 投票解散（${count}/${needed}，需要 ${needed} 票）`});
          if (needed > 0 && count >= needed) {
            this._broadcast({type:'dissolve',message:'超过半数同意，房间已解散！'});
            this.players=[]; this.audience=[];
            this.dissolveVotes.clear(); this.kickVotes.clear();
            this.chatHistory=[];       // 解散时清空聊天记录
            this.persistedPlayers={};
            this.state.storage.delete('persistedPlayers').catch(()=>{});
            const gs=this.gameState;
            gs.stage='waiting'; gs.community=[]; gs.pot=0;
            gs.currentBet=0; gs.actedSet=new Set(); gs.lastRaiserIndex=-1;
          }
        }
        break;
      }

      // ── 踢人投票
      case 'kick_vote': {
        const voter = this.players.find(p=>p.id===playerId);
        if (!voter) { this._sendTo(playerId,{type:'error',message:'只有玩家才能踢人'}); return; }
        const targetId = msg.targetId;
        if (!targetId || targetId === playerId) {
          this._sendTo(playerId,{type:'error',message:'无效的踢出目标'}); return;
        }
        const target = this.players.find(p=>p.id===targetId);
        if (!target) { this._sendTo(playerId,{type:'error',message:'目标不在座位上'}); return; }

        if (!this.kickVotes.has(targetId)) this.kickVotes.set(targetId,new Set());
        const votes = this.kickVotes.get(targetId);
        const seatedConnected = this.players.filter(p=>p.connected);
        const needed = Math.floor(seatedConnected.length / 2);

        if (votes.has(playerId)) {
          votes.delete(playerId);
          this._broadcastState();
          this._broadcast({type:'message',message:`${voter.name} 撤回了对 ${target.name} 的踢出投票`});
        } else {
          votes.add(playerId);
          const count = [...votes].filter(id=>seatedConnected.find(p=>p.id===id)).length;
          this._broadcastState();
          this._broadcast({type:'message',message:`${voter.name} 投票踢出 ${target.name}（${count}/${seatedConnected.length}，需要 ${needed}）`});
          if (needed > 0 && count >= needed) {
            this.kickVotes.delete(targetId);
            this._moveToAudience(targetId, `${target.name} 被投票移至观众席`);
          }
        }
        break;
      }

      case 'chat': {
        const chatText = (msg.text || '').trim().slice(0, 120);
        if (!chatText) break;
        const chatSender = this.players.find(p => p.id === playerId) || this.audience.find(p => p.id === playerId);
        if (!chatSender) break;
        const chatEntry = { name: chatSender.name, text: chatText, ts: Date.now() };
        this.chatHistory.push(chatEntry);
        if (this.chatHistory.length > this.config.chatHistoryLimit) this.chatHistory.shift();
        this._broadcast({ type: 'chat', ...chatEntry });
        break;
      }

      default: this._sendTo(playerId,{type:'error',message:`未知消息类型: ${msg.type}`});
    }
  }
}
