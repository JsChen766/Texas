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
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>♠ 管理后台</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{background:#0d1117;color:#e6edf3;font-family:system-ui,sans-serif;padding:20px}
h1{color:#58a6ff;margin-bottom:20px}
h2{color:#79c0ff;margin:20px 0 10px;border-bottom:1px solid #21262d;padding-bottom:6px}
.card{background:#161b22;border:1px solid #30363d;border-radius:10px;padding:16px;margin-bottom:16px}
label{display:block;font-size:.85rem;color:#8b949e;margin-bottom:4px}
input{background:#0d1117;border:1px solid #30363d;color:#e6edf3;padding:8px 12px;border-radius:6px;width:100%;margin-bottom:10px;font-size:.9rem}
input:focus{outline:none;border-color:#58a6ff}
.btn{padding:8px 18px;border:none;border-radius:6px;cursor:pointer;font-size:.85rem;font-weight:600;margin-right:6px}
.btn:hover{opacity:.85}
.btn-g{background:#238636;color:#fff}.btn-r{background:#da3633;color:#fff}
.btn-y{background:#d29922;color:#000}.btn-b{background:#1f6feb;color:#fff}
.btn-s{background:#30363d;color:#e6edf3;padding:4px 10px;font-size:.75rem}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:12px}
table{width:100%;border-collapse:collapse;font-size:.85rem}
th{background:#21262d;padding:8px;text-align:left;color:#8b949e}
td{padding:8px;border-bottom:1px solid #21262d;vertical-align:middle}
.badge{display:inline-block;padding:2px 8px;border-radius:10px;font-size:.75rem}
.bp{background:#1f6feb}.ba{background:#30363d}
.stat-row{display:flex;gap:16px;flex-wrap:wrap;margin-top:10px}
.sc{background:#21262d;border-radius:8px;padding:10px 18px;text-align:center;min-width:100px}
.sc .n{font-size:1.6rem;font-weight:700;color:#58a6ff}
.sc .l{font-size:.75rem;color:#8b949e}
.msg{padding:8px 14px;border-radius:6px;font-size:.85rem;margin-bottom:10px;display:none}
.mo{background:rgba(35,134,54,.3);border:1px solid #238636;color:#56d364}
.me{background:rgba(218,54,51,.3);border:1px solid #da3633;color:#ff7b72}
#ls{max-width:360px;margin:80px auto}
#ms{display:none}
</style>
</head>
<body>
<div id="ls">
  <h1 style="text-align:center">♠ 管理后台</h1>
  <div class="card">
    <div id="lm" class="msg me"></div>
    <label>管理密码</label>
    <input type="password" id="pi" placeholder="输入密码..." />
    <button class="btn btn-g" style="width:100%" onclick="doLogin()">登录</button>
  </div>
</div>
<div id="ms">
  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
    <h1>♠ 德州扑克 管理后台</h1>
    <button class="btn btn-y" onclick="doLogout()">退出登录</button>
  </div>
  <div id="mm" class="msg"></div>
  <div class="card">
    <h2>📊 房间状态 <span id="ri" style="font-size:.75rem;color:#8b949e"></span></h2>
    <div class="stat-row">
      <div class="sc"><div class="n" id="ss">-</div><div class="l">在座玩家</div></div>
      <div class="sc"><div class="n" id="sa">-</div><div class="l">观众</div></div>
      <div class="sc"><div class="n" id="sp">-</div><div class="l">底池</div></div>
      <div class="sc"><div class="n" id="sg">-</div><div class="l">阶段</div></div>
    </div>
  </div>
  <div class="card">
    <h2>👥 人员管理</h2>
    <table id="pt"><thead><tr><th>名称</th><th>角色</th><th>🍓</th><th>赊</th><th>连接</th><th>操作</th></tr></thead><tbody></tbody></table>
  </div>
  <div class="card">
    <h2>⚙️ 游戏配置</h2>
    <div class="grid2">
      <div><label>小</label><input type="number" id="csb" min="1"/></div>
      <div><label>大</label><input type="number" id="cbb" min="1"/></div>
      <div><label>初始🍓</label><input type="number" id="cic" min="100" step="100"/></div>
      <div><label>最大座位数</label><input type="number" id="cms" min="2" max="20"/></div>
      <div><label>断线超时（分钟）</label><input type="number" id="cdt" min="1"/></div>
      <div><label>摊牌延迟（秒）</label><input type="number" id="csd" min="1"/></div>
    </div>
    <button class="btn btn-g" onclick="saveConfig()">保存配置</button>
  </div>
  <div class="card">
    <h2>🚨 房间操作</h2>
    <button class="btn btn-r" onclick="forceDiss()">强制解散房间（清除所有数据）</button>
  </div>
  <div class="card">
    <h2>🔑 修改管理密码</h2>
    <div class="grid2">
      <div><label>新密码</label><input type="password" id="np" placeholder="新密码"/></div>
      <div><label>确认密码</label><input type="password" id="np2" placeholder="再次输入"/></div>
    </div>
    <button class="btn btn-b" onclick="changePwd()">修改密码</button>
  </div>
</div>
<script>
var BASE=location.origin,TOKEN=localStorage.getItem('at')||'',timer=null;
function showMsg(el,txt,ok){el.textContent=txt;el.style.display='block';el.className='msg '+(ok?'mo':'me');setTimeout(function(){el.style.display='none';},4000);}
async function api(path,method,body){
  var opts={method:method||'GET',headers:{'Authorization':'Bearer '+TOKEN,'Content-Type':'application/json'}};
  if(body)opts.body=JSON.stringify(body);
  var r=await fetch(BASE+path,opts);
  return {ok:r.ok,status:r.status,data:await r.json().catch(function(){return {};})};
}
async function doLogin(){
  var pwd=document.getElementById('pi').value;
  if(!pwd)return;
  var r=await api('/admin/login','POST',{password:pwd});
  if(r.ok&&r.data.token){TOKEN=r.data.token;localStorage.setItem('at',TOKEN);showMain();}
  else showMsg(document.getElementById('lm'),r.data.error||'登录失败',false);
}
function doLogout(){TOKEN='';localStorage.removeItem('at');clearInterval(timer);document.getElementById('ms').style.display='none';document.getElementById('ls').style.display='';}
function showMain(){document.getElementById('ls').style.display='none';document.getElementById('ms').style.display='block';load();timer=setInterval(load,5000);}
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
  document.getElementById('ri').textContent='最后更新：'+new Date().toLocaleTimeString();
  if(d.config){
    document.getElementById('csb').value=d.config.smallBlind;
    document.getElementById('cbb').value=d.config.bigBlind;
    document.getElementById('cic').value=d.config.initialChips;
    document.getElementById('cms').value=d.config.maxSeats;
    document.getElementById('cdt').value=Math.round(d.config.disconnectTtl/60000);
    document.getElementById('csd').value=Math.round(d.config.showdownDelay/1000);
  }
  var tb=document.querySelector('#pt tbody');tb.innerHTML='';
  (d.players||[]).forEach(function(p){
    var tr=document.createElement('tr');
    var role=p.role==='player'?'<span class="badge bp">玩家</span>':'<span class="badge ba">观众</span>';
    var ops='';
    if(p.role==='player')ops+='<button class="btn btn-y btn-s" onclick="kickP(\\''+p.id+'\\')">→观众</button> ';
    ops+='<button class="btn btn-b btn-s" onclick="giveC(\\''+p.id+'\\',\\''+p.name+'\\')">🍓</button> ';
    ops+='<button class="btn btn-s" onclick="rdbt(\\''+p.id+'\\',\\''+p.name+'\\')">清欠款</button>';
    tr.innerHTML='<td>'+p.name+'</td><td>'+role+'</td><td>'+p.chips+'</td>'
      +'<td style="color:'+(p.debt>0?'#ff7b72':'#8b949e')+'">'+( p.debt||0)+'</td>'
      +'<td>'+(p.connected?'🟢':'🔴')+(p.pendingLeave?' <small>让座中</small>':'')+'</td>'
      +'<td>'+ops+'</td>';
    tb.appendChild(tr);
  });
}
async function kickP(id){if(!confirm('确认将该玩家移至观众席？'))return;var r=await api('/admin/kick','POST',{playerId:id});showMsg(document.getElementById('mm'),r.data.message||r.data.error,r.ok);load();}
async function giveC(id,name){var amt=prompt('为 '+name+' 调整🍓（正/负数）：');if(amt===null)return;var n=parseInt(amt,10);if(isNaN(n)){alert('请输入有效数字');return;}var r=await api('/admin/give-chips','POST',{playerId:id,amount:n});showMsg(document.getElementById('mm'),r.data.message||r.data.error,r.ok);load();}
async function rdbt(id,name){if(!confirm('确认清除 '+name+' 的全部赊？'))return;var r=await api('/admin/reset-debt','POST',{playerId:id});showMsg(document.getElementById('mm'),r.data.message||r.data.error,r.ok);load();}
async function saveConfig(){
  var body={smallBlind:+document.getElementById('csb').value,bigBlind:+document.getElementById('cbb').value,initialChips:+document.getElementById('cic').value,maxSeats:+document.getElementById('cms').value,disconnectTtl:+document.getElementById('cdt').value*60000,showdownDelay:+document.getElementById('csd').value*1000};
  var r=await api('/admin/config','POST',body);showMsg(document.getElementById('mm'),r.data.message||r.data.error,r.ok);
}
async function forceDiss(){if(!confirm('确认强制解散？所有🍓数据将被清除！'))return;var r=await api('/admin/dissolve','POST');showMsg(document.getElementById('mm'),r.data.message||r.data.error,r.ok);load();}
async function changePwd(){var p1=document.getElementById('np').value,p2=document.getElementById('np2').value;if(!p1){showMsg(document.getElementById('mm'),'密码不能为空',false);return;}if(p1!==p2){showMsg(document.getElementById('mm'),'两次密码不一致',false);return;}var r=await api('/admin/change-password','POST',{newPassword:p1});showMsg(document.getElementById('mm'),r.data.message||r.data.error,r.ok);if(r.ok){document.getElementById('np').value='';document.getElementById('np2').value='';}}
if(TOKEN)api('/admin/state').then(function(r){if(r.ok)showMain();else{TOKEN='';localStorage.removeItem('at');}});
document.getElementById('pi').addEventListener('keydown',function(e){if(e.key==='Enter')doLogin();});
</script>
</body></html>`;

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

    // 可动态修改的配置
    this.config = {
      smallBlind:    10,
      bigBlind:      20,
      initialChips:  1000,
      maxSeats:      10,
      disconnectTtl: 5 * 60 * 1000,
      showdownDelay: 5000,
    };

    // 管理员鉴权（token 仅内存保存，重启失效）
    this.adminPassword  = 'admin888';
    this.adminToken     = null;
    this.adminTokenExp  = 0;

    // 从持久存储加载玩家数据（🍓 + 欠款）+ 配置
    this.persistedPlayers = {};
    this.state.blockConcurrencyWhile(async () => {
      const [pp, cfg, pwd] = await Promise.all([
        this.state.storage.get('persistedPlayers'),
        this.state.storage.get('config'),
        this.state.storage.get('adminPassword'),
      ]);
      this.persistedPlayers = pp || {};
      if (cfg) Object.assign(this.config, cfg);
      if (pwd) this.adminPassword = pwd;
    });
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (request.headers.get('Upgrade') === 'websocket') {
      return this._upgradeWebSocket(request);
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
          const allowed = ['smallBlind','bigBlind','initialChips','maxSeats','disconnectTtl','showdownDelay'];
          for (const k of allowed) {
            if (body[k] !== undefined && Number.isFinite(+body[k]) && +body[k] > 0) {
              this.config[k] = +body[k];
            }
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
            this._moveToAudience(body.playerId, `🔨 管理员将 ${target.name} 移至观众席`);
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
          return this._adminJson({ message: `${target.name} 🍓调整 ${amt > 0 ? '+' : ''}${amt}，当前：${target.chips}` });
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
          dissolveVotes: dissolveCount, dissolveTotal: allConnected.length,
          startVotes:    startCount,    startTotal:    seatedConnected.length,
          kickStatus,
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
      this._broadcast({ type: 'error', message: '至少需要 2 名有🍓且在线的玩家' }); return;
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
    const sbP=this.players[gs.smallBlindIndex], bbP=this.players[gs.bigBlindIndex];
    const sbAmt=Math.min(this.config.smallBlind,sbP.chips), bbAmt=Math.min(this.config.bigBlind,bbP.chips);
    sbP.chips-=sbAmt; sbP.bet=sbAmt; sbP.totalCommitted=sbAmt; if(sbP.chips===0) sbP.allIn=true;
    bbP.chips-=bbAmt; bbP.bet=bbAmt; bbP.totalCommitted=bbAmt; if(bbP.chips===0) bbP.allIn=true;
    gs.pot=sbAmt+bbAmt; gs.currentBet=bbAmt; gs.stage='preflop';
    gs.currentPlayerIndex=this._nextActionableIndex((gs.bigBlindIndex+1)%this.players.length);
    this._broadcastState();
    this._broadcast({ type:'message', message:`🃏 新一局开始！庄家：${this.players[gs.dealerIndex].name}，小：${sbP.name}，大：${bbP.name}` });
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
        if(addChips>player.chips){this._sendTo(playerId,{type:'error',message:'🍓不足'});return;}
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
      this._broadcast({type:'message',message:`🏆 ${active[0].name} 赢得 ${this.gameState.pot} 🍓（其他人全部弃牌）`});
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
      this._broadcast({type:'message',message:`🂠 翻牌：${gs.community.join(' ')}`});
    } else if(gs.stage==='flop'){
      gs.stage='turn'; gs.community.push(gs.deck.pop());
      this._broadcast({type:'message',message:`🂠 转牌：${gs.community[3]}`});
    } else if(gs.stage==='turn'){
      gs.stage='river'; gs.community.push(gs.deck.pop());
      this._broadcast({type:'message',message:`🂠 河牌：${gs.community[4]}`});
    } else if(gs.stage==='river'){
      gs.stage='showdown'; this._showdown(); return;
    } else { return; }
    // 检查是否还有玩家可以行动，如果全部全押则继续推进到摇牌
    const next=this._nextActionableIndex((gs.dealerIndex+1)%this.players.length);
    if(next===-1){ this._advanceStage(); return; }  // 递归推进直到摇牌
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
    this._broadcast({
      type: 'showdown',
      results: notFolded.map(p => ({ id: p.id, name: p.name, hand: p.hand, handName: handNames[p.id] || '' })),
      winners: allWinners,
      pots: potResults,
      community: this.gameState.community,
      pot: this.gameState.pot,
    });
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
    this.players=this.players.filter(p=>p.chips>0||p.connected);
    const gs=this.gameState;
    gs.stage='waiting'; gs.community=[]; gs.pot=0;
    gs.currentBet=0; gs.actedSet=new Set(); gs.lastRaiserIndex=-1;
    for(const p of this.players){p.folded=false;p.allIn=false;p.bet=0;p.hand=[];}
    this._savePlayerData();
    this._broadcastState();
    this._broadcast({type:'message',message:'本局结束，等待开始新一局…'});
  }

  /** 将所有玩家的🍓和欠款写入持久存储 */
  _savePlayerData() {
    const all = [...this.players, ...this.audience];
    for (const p of all) {
      this.persistedPlayers[p.id] = { chips: p.chips, debt: p.debt || 0, name: p.name };
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
          if (msg.name) inPlayers.name = msg.name;
          this._broadcastState();
          this._broadcast({ type:'message', message:`${inPlayers.name} 重新连线（玩家）` });
        } else if (inAudience) {
          inAudience.connected = true; inAudience.lastSeen = Date.now();
          if (msg.name) inAudience.name = msg.name;
          this._broadcastState();
          this._broadcast({ type:'message', message:`${inAudience.name} 重新连线（观众）` });
        } else {
          const name = (msg.name||'').trim()||`游客${this.audience.length+1}`;
          const persisted = this.persistedPlayers[playerId];
          const chips = (persisted && persisted.chips > 0) ? persisted.chips : this.config.initialChips;
          const debt  = persisted ? (persisted.debt || 0) : 0;
          this.audience.push({id:playerId,name,chips,debt,hand:[],folded:false,allIn:false,bet:0,connected:true,lastSeen:Date.now()});
          this._broadcastState();
          this._broadcast({ type:'message', message:`👀 ${name} 进入观众席（🍓 ${chips}${debt>0?' · 赊 '+debt:''}）` });
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
        if (this.startVotes.size > 0) {
          this.startVotes.clear();
          this._broadcast({type:'message',message:'有玩家上座，开始投票已重置'});
        }
        this._broadcastState();
        this._broadcast({type:'message',message:`🪑 ${inAud.name} 上座加入游戏！`});
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
        this._moveToAudience(playerId, `🚶 ${pName} 主动让座`);
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

      // ── 借🍓
      case 'borrow': {
        if (this.gameState.stage !== 'waiting') {
          this._sendTo(playerId,{type:'error',message:'只能在等待阶段借🍓'}); return;
        }
        const person = this.players.find(p=>p.id===playerId)||this.audience.find(p=>p.id===playerId);
        if (!person) return;
        person.chips += 1000; person.debt = (person.debt||0) + 1000;
        this._savePlayerData(); this._broadcastState();
        this._broadcast({type:'message',message:`💳 ${person.name} 向银行借了 1000 🍓（累计赊 ${person.debt}）`});
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
          const needed = Math.max(1, Math.floor(allConnected.length / 2));
          const count  = [...this.dissolveVotes].filter(id=>allConnected.find(p=>p.id===id)).length;
          this._broadcastState();
          this._broadcast({type:'message',message:`${person.name} 投票解散（${count}/${allConnected.length}，需要 ${needed}）`});
          if (needed > 0 && count >= needed) {
            this._broadcast({type:'dissolve',message:'超过半数同意，房间已解散！'});
            this.players=[]; this.audience=[];
            this.dissolveVotes.clear(); this.kickVotes.clear();
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
            this._moveToAudience(targetId, `🦶 ${target.name} 被投票移至观众席`);
          }
        }
        break;
      }

      default: this._sendTo(playerId,{type:'error',message:`未知消息类型: ${msg.type}`});
    }
  }
}
