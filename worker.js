/**
 * worker.js — Cloudflare Worker + Durable Objects · 单房间德州扑克
 * v2: 持久筹码、借筹码功能、解散房间投票
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
          'Access-Control-Allow-Methods': 'GET, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Upgrade',
        },
      });
    }
    const id   = env.POKER_ROOM.idFromName('main-room');
    const stub = env.POKER_ROOM.get(id);
    return stub.fetch(request);
  },
};

// ═══════════════════════════════════════════════
// §2  Durable Object
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

    // 从持久存储加载玩家数据（筹码 + 欠款）
    this.persistedPlayers = {};
    this.state.blockConcurrencyWhile(async () => {
      this.persistedPlayers = (await this.state.storage.get('persistedPlayers')) || {};
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
    return new Response("Texas Hold'em Durable Object is running", { status: 200 });
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

  get SMALL_BLIND()    { return 10; }
  get BIG_BLIND()      { return 20; }
  get INITIAL_CHIPS()  { return 1000; }
  get MAX_SEATS()      { return 10; }
  get DISCONNECT_TTL() { return 5 * 60 * 1000; }
  get SHOWDOWN_DELAY() { return 5000; }

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
      this._broadcast({ type: 'error', message: '至少需要 2 名有筹码且在线的玩家' }); return;
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
    const sbAmt=Math.min(this.SMALL_BLIND,sbP.chips), bbAmt=Math.min(this.BIG_BLIND,bbP.chips);
    sbP.chips-=sbAmt; sbP.bet=sbAmt; sbP.totalCommitted=sbAmt; if(sbP.chips===0) sbP.allIn=true;
    bbP.chips-=bbAmt; bbP.bet=bbAmt; bbP.totalCommitted=bbAmt; if(bbP.chips===0) bbP.allIn=true;
    gs.pot=sbAmt+bbAmt; gs.currentBet=bbAmt; gs.stage='preflop';
    gs.currentPlayerIndex=this._nextActionableIndex((gs.bigBlindIndex+1)%this.players.length);
    this._broadcastState();
    this._broadcast({ type:'message', message:`🃏 新一局开始！庄家：${this.players[gs.dealerIndex].name}，小盲：${sbP.name}，大盲：${bbP.name}` });
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
        if(addChips>player.chips){this._sendTo(playerId,{type:'error',message:'筹码不足'});return;}
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
      this._broadcast({type:'message',message:`🏆 ${active[0].name} 赢得 ${this.gameState.pot} 筹码（其他人全部弃牌）`});
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
    // 每个玩家累计赢得筹码
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
    setTimeout(() => this._endHand(), this.SHOWDOWN_DELAY);
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

  /** 将所有玩家的筹码和欠款写入持久存储 */
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
      if(!p.connected&&(now-p.lastSeen)>this.DISCONNECT_TTL){this.clients.delete(p.id);return false;}
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
          const chips = (persisted && persisted.chips > 0) ? persisted.chips : this.INITIAL_CHIPS;
          const debt  = persisted ? (persisted.debt || 0) : 0;
          this.audience.push({id:playerId,name,chips,debt,hand:[],folded:false,allIn:false,bet:0,connected:true,lastSeen:Date.now()});
          this._broadcastState();
          this._broadcast({ type:'message', message:`👀 ${name} 进入观众席（筹码 ${chips}${debt>0?' · 欠款 '+debt:''}）` });
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
        if (this.players.length >= this.MAX_SEATS) {
          this._sendTo(playerId,{type:'error',message:`座位已满（最多 ${this.MAX_SEATS} 人）`}); return;
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

      // ── 借筹码
      case 'borrow': {
        if (this.gameState.stage !== 'waiting') {
          this._sendTo(playerId,{type:'error',message:'只能在等待阶段借筹码'}); return;
        }
        const person = this.players.find(p=>p.id===playerId)||this.audience.find(p=>p.id===playerId);
        if (!person) return;
        person.chips += 1000; person.debt = (person.debt||0) + 1000;
        this._savePlayerData(); this._broadcastState();
        this._broadcast({type:'message',message:`💳 ${person.name} 向银行借了 1000 筹码（累计欠款 ${person.debt}）`});
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
          const needed = Math.floor(allConnected.length / 2);
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
