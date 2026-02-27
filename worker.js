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
    this.clients = new Map();
    this.players = [];
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
          status:    'ok',
          players:   this.players.length,
          connected: this.players.filter(p => p.connected).length,
          stage:     this.gameState.stage,
          pot:       this.gameState.pot,
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
        const player = this.players.find(p => p.id === playerId);
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
  get MAX_PLAYERS()    { return 8; }
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
    const connectedIds   = new Set(this.players.filter(p => p.connected).map(p => p.id));
    const dissolveTotal  = connectedIds.size;
    const dissolveCount  = [...this.dissolveVotes].filter(id => connectedIds.has(id)).length;
    const pub = this.players.map((p, i) => ({
      id: p.id, name: p.name, chips: p.chips, bet: p.bet,
      folded: p.folded, allIn: p.allIn, connected: p.connected,
      isDealer: i===gs.dealerIndex, isSB: i===gs.smallBlindIndex,
      isBB: i===gs.bigBlindIndex, handCount: p.hand?p.hand.length:0,
      debt: p.debt || 0,
      votedDissolve: this.dissolveVotes.has(p.id),
    }));
    for (const player of this.players) {
      const ws = this.clients.get(player.id);
      if (!ws) continue;
      try {
        ws.send(JSON.stringify({
          type: 'state', players: pub, community: gs.community,
          pot: gs.pot, stage: gs.stage,
          currentPlayerIndex: gs.currentPlayerIndex, currentBet: gs.currentBet,
          dealerIndex: gs.dealerIndex, smallBlindIndex: gs.smallBlindIndex,
          bigBlindIndex: gs.bigBlindIndex,
          selfHand: player.hand || [], selfId: player.id,
          dissolveVotes: dissolveCount, dissolveTotal,
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
    const connectable = this.players.filter(p => p.connected && p.chips > 0);
    if (connectable.length < 2) {
      this._broadcast({ type: 'error', message: '至少需要 2 名有筹码且在线的玩家' }); return;
    }
    if (this.gameState.stage !== 'waiting') {
      this._broadcast({ type: 'error', message: '游戏已在进行中' }); return;
    }
    this.dissolveVotes.clear();
    this.players = this.players.filter(p => p.chips > 0 || p.connected);
    for (const p of this.players) { p.folded=false; p.allIn=false; p.bet=0; p.hand=[]; }
    const gs = this.gameState;
    gs.deck=this._shuffleDeck(this._createDeck()); gs.community=[];
    gs.pot=0; gs.actedSet=new Set(); gs.lastRaiserIndex=-1;
    gs.dealerIndex     = (gs.dealerIndex + 1) % this.players.length;
    gs.smallBlindIndex = (gs.dealerIndex + 1) % this.players.length;
    gs.bigBlindIndex   = (gs.dealerIndex + 2) % this.players.length;
    for (const p of this.players) p.hand = [gs.deck.pop(), gs.deck.pop()];
    const sbP=this.players[gs.smallBlindIndex], bbP=this.players[gs.bigBlindIndex];
    const sbAmt=Math.min(this.SMALL_BLIND,sbP.chips), bbAmt=Math.min(this.BIG_BLIND,bbP.chips);
    sbP.chips-=sbAmt; sbP.bet=sbAmt; if(sbP.chips===0) sbP.allIn=true;
    bbP.chips-=bbAmt; bbP.bet=bbAmt; if(bbP.chips===0) bbP.allIn=true;
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
        if(player.chips===0) player.allIn=true;
        gs.actedSet.add(playerId); this._broadcast({type:'message',message:`${player.name} 跟注 ${need}`}); break;
      }
      case 'raise': {
        const minRaise=gs.currentBet*2;
        if(!amount||amount<minRaise){this._sendTo(playerId,{type:'error',message:`加注至少需要 ${minRaise}`});return;}
        const totalBet=Math.min(amount,player.chips+player.bet), addChips=totalBet-player.bet;
        if(addChips>player.chips){this._sendTo(playerId,{type:'error',message:'筹码不足'});return;}
        player.chips-=addChips; gs.pot+=addChips; player.bet=totalBet; gs.currentBet=totalBet;
        if(player.chips===0) player.allIn=true;
        gs.actedSet=new Set([playerId]); gs.lastRaiserIndex=idx;
        this._broadcast({type:'message',message:`${player.name} 加注至 ${totalBet}`}); break;
      }
      case 'allin': {
        const allInAmt=player.chips; player.bet+=allInAmt; gs.pot+=allInAmt;
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
      active[0].chips+=this.gameState.pot;
      this._broadcast({type:'message',message:`🏆 ${active[0].name} 赢得 ${this.gameState.pot} 筹码（其他人全部弃牌）`});
      this._endHand(); return;
    }
    if(this._isBettingRoundComplete()){this._advanceStage();return;}
    const next=this._nextActionableIndex((this.gameState.currentPlayerIndex+1)%this.players.length);
    if(next===-1){this._advanceStageAllIn();return;}
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
    switch(gs.stage){
      case 'preflop':
        gs.stage='flop'; gs.community.push(gs.deck.pop(),gs.deck.pop(),gs.deck.pop());
        this._broadcast({type:'message',message:`🂠 翻牌：${gs.community.join(' ')}`}); break;
      case 'flop':
        gs.stage='turn'; gs.community.push(gs.deck.pop());
        this._broadcast({type:'message',message:`🂠 转牌：${gs.community[3]}`}); break;
      case 'turn':
        gs.stage='river'; gs.community.push(gs.deck.pop());
        this._broadcast({type:'message',message:`🂠 河牌：${gs.community[4]}`}); break;
      case 'river': gs.stage='showdown'; this._showdown(); return;
      default: return;
    }
    gs.currentPlayerIndex=this._nextActionableIndex((gs.dealerIndex+1)%this.players.length);
    this._broadcastState();
  }

  _advanceStageAllIn() {
    const gs=this.gameState;
    for(const p of this.players) p.bet=0;
    gs.currentBet=0; gs.actedSet=new Set(); gs.lastRaiserIndex=-1;
    while(gs.community.length<5){
      if(gs.stage==='preflop'){gs.community.push(gs.deck.pop(),gs.deck.pop(),gs.deck.pop());gs.stage='flop';}
      else if(gs.stage==='flop'){gs.community.push(gs.deck.pop());gs.stage='turn';}
      else if(gs.stage==='turn'){gs.community.push(gs.deck.pop());gs.stage='river';}
      else break;
    }
    gs.stage='showdown'; this._broadcastState(); this._showdown();
  }

  _showdown() {
    const notFolded=this.players.filter(p=>!p.folded);
    const results=notFolded.map(p=>{
      const score=this._evaluateBestHand([...p.hand,...this.gameState.community]);
      return {player:p,score,handName:this._handRankName(score)};
    });
    results.sort((a,b)=>this._compareScores(b.score,a.score));
    const topScore=results[0].score;
    const winners=results.filter(r=>this._compareScores(r.score,topScore)===0);
    const winAmount=Math.floor(this.gameState.pot/winners.length);
    for(const w of winners) w.player.chips+=winAmount;
    this._broadcast({
      type:'showdown',
      results:notFolded.map(p=>({id:p.id,name:p.name,hand:p.hand,handName:results.find(r=>r.player.id===p.id)?.handName??''})),
      winners:winners.map(w=>({id:w.player.id,name:w.player.name,amount:winAmount,handName:w.handName})),
      community:this.gameState.community, pot:this.gameState.pot,
    });
    this._broadcastState();
    setTimeout(()=>this._endHand(),this.SHOWDOWN_DELAY);
  }

  _endHand() {
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
    for (const p of this.players) {
      this.persistedPlayers[p.id] = { chips: p.chips, debt: p.debt || 0, name: p.name };
    }
    this.state.storage.put('persistedPlayers', this.persistedPlayers).catch(() => {});
  }

  _cleanupStale() {
    const now=Date.now(), before=this.players.length;
    this.players=this.players.filter(p=>{
      if(!p.connected&&(now-p.lastSeen)>this.DISCONNECT_TTL){this.clients.delete(p.id);return false;}
      return true;
    });
    if(this.players.length<before) this._broadcastState();
  }

  _enqueue(fn) {
    this.operationQueue=this.operationQueue.then(()=>{try{fn();}catch(e){console.error('操作错误:',e);}});
  }

  _handleMessage(playerId, raw) {
    let msg;
    try{msg=JSON.parse(raw);}catch(_){this._sendTo(playerId,{type:'error',message:'消息格式错误（需要 JSON）'});return;}
    switch(msg.type){
      case 'join': {
        const existing=this.players.find(p=>p.id===playerId);
        if(existing){
          existing.connected=true; existing.lastSeen=Date.now();
          if(msg.name) existing.name=msg.name;
          this._broadcastState(); this._broadcast({type:'message',message:`${existing.name} 重新连线`});
        } else {
          if(this.players.length>=this.MAX_PLAYERS){this._sendTo(playerId,{type:'error',message:'房间已满（最多 8 人）'});return;}
          const name=(msg.name||'').trim()||`玩家${this.players.length+1}`;
          // 从持久化存储恢复筹码和欠款
          const persisted = this.persistedPlayers[playerId];
          const chips = (persisted && persisted.chips > 0) ? persisted.chips : this.INITIAL_CHIPS;
          const debt  = persisted ? (persisted.debt || 0) : 0;
          this.players.push({id:playerId,name,chips,debt,hand:[],folded:false,allIn:false,bet:0,connected:true,lastSeen:Date.now()});
          this._broadcastState(); this._broadcast({type:'message',message:`${name} 加入房间（筹码 ${chips}${debt>0?' · 欠款 '+debt:''}）`});
        }
        break;
      }
      case 'start_game': this._startGame(); break;
      case 'action': this._handleAction(playerId,msg.action,msg.amount); break;

      case 'borrow': {
        if (this.gameState.stage !== 'waiting') {
          this._sendTo(playerId,{type:'error',message:'只能在等待阶段借筹码'}); return;
        }
        const player = this.players.find(p => p.id === playerId);
        if (!player) return;
        const BORROW_AMOUNT = 1000;
        player.chips += BORROW_AMOUNT;
        player.debt   = (player.debt || 0) + BORROW_AMOUNT;
        this._savePlayerData();
        this._broadcastState();
        this._broadcast({type:'message',message:`💳 ${player.name} 向银行借了 ${BORROW_AMOUNT} 筹码（累计欠款 ${player.debt}）`});
        break;
      }

      case 'dissolve_vote': {
        const player = this.players.find(p => p.id === playerId);
        if (!player) return;
        if (this.dissolveVotes.has(playerId)) {
          // 再次点击 = 撤回投票
          this.dissolveVotes.delete(playerId);
          this._broadcastState();
          this._broadcast({type:'message',message:`${player.name} 撤回了解散投票`});
        } else {
          this.dissolveVotes.add(playerId);
          const connectedPlayers = this.players.filter(p => p.connected);
          const allVoted = connectedPlayers.length > 0 && connectedPlayers.every(p => this.dissolveVotes.has(p.id));
          this._broadcastState();
          this._broadcast({type:'message',message:`${player.name} 投票解散（${this.dissolveVotes.size}/${connectedPlayers.length}）`});
          if (allVoted) {
            this._broadcast({type:'dissolve',message:'所有人同意，房间已解散！'});
            // 清空房间并重置持久化数据
            this.players = [];
            this.dissolveVotes.clear();
            this.persistedPlayers = {};
            this.state.storage.delete('persistedPlayers').catch(() => {});
            const gs = this.gameState;
            gs.stage='waiting'; gs.community=[]; gs.pot=0;
            gs.currentBet=0; gs.actedSet=new Set(); gs.lastRaiserIndex=-1;
          }
        }
        break;
      }

      default: this._sendTo(playerId,{type:'error',message:`未知消息类型: ${msg.type}`});
    }
  }
}
