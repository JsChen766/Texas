/**
 * worker.js — Cloudflare Worker · 单房间德州扑克后端
 *
 * 架构说明：
 *  - 普通 Worker，不使用 Durable Objects / KV / D1
 *  - 全局变量保存房间状态（Worker 热实例内有效）
 *  - WebSocket 实时双向通信
 *  - 支持断线重连、自动轮庄、完整牌型判断
 */

// ═══════════════════════════════════════════════
// §1  全局状态
// ═══════════════════════════════════════════════

/** @type {Map<string, WebSocket>} playerId -> 活跃 WebSocket */
let clients = new Map();

/**
 * 玩家数组
 * @type {Array<{
 *   id: string, name: string, chips: number,
 *   hand: string[], folded: boolean, allIn: boolean,
 *   bet: number, connected: boolean, lastSeen: number
 * }>}
 */
let players = [];

/**
 * 游戏状态
 * stage: "waiting" | "preflop" | "flop" | "turn" | "river" | "showdown"
 */
let gameState = {
  deck: [],
  community: [],
  pot: 0,
  dealerIndex: 0,
  smallBlindIndex: 0,
  bigBlindIndex: 0,
  currentPlayerIndex: 0,
  currentBet: 0,
  stage: "waiting",
  /** 本轮已行动的 playerId 集合（用于判断 BB option） */
  actedSet: new Set(),
  /** 最后一次加注的玩家下标（-1 表示无） */
  lastRaiserIndex: -1,
};

/** 串行化操作队列，防止并发竞争 */
let operationQueue = Promise.resolve();

/** 确保定时清理只注册一次 */
let cleanupScheduled = false;

// ═══════════════════════════════════════════════
// §2  游戏常量
// ═══════════════════════════════════════════════
const SMALL_BLIND      = 10;
const BIG_BLIND        = 20;
const INITIAL_CHIPS    = 1000;
const MAX_PLAYERS      = 8;
const DISCONNECT_TTL   = 5 * 60 * 1000; // 5 分钟后移除离线玩家
const SHOWDOWN_DELAY   = 5000;          // 摊牌后等待 5 秒再收局

// ═══════════════════════════════════════════════
// §3  牌组工具
// ═══════════════════════════════════════════════
const SUITS = ['H', 'D', 'C', 'S'];                                     // ♥ ♦ ♣ ♠
const RANKS = ['2','3','4','5','6','7','8','9','T','J','Q','K','A'];     // 2–A (数值 0–12)

/** 生成一副 52 张牌 */
function createDeck() {
  const deck = [];
  for (const s of SUITS) for (const r of RANKS) deck.push(r + s);
  return deck;
}

/** Fisher-Yates 洗牌（不修改原数组） */
function shuffleDeck(deck) {
  const d = [...deck];
  for (let i = d.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [d[i], d[j]] = [d[j], d[i]];
  }
  return d;
}

/** 牌面值 → 数值 0–12 */
const rankValue = (card) => RANKS.indexOf(card[0]);

/** 牌花色 */
const cardSuit = (card) => card[1];

// ═══════════════════════════════════════════════
// §4  牌型判断（7 选 5）
// ═══════════════════════════════════════════════

/** 从数组 arr 中取所有长度为 k 的组合 */
function combinations(arr, k) {
  if (k === 0) return [[]];
  if (arr.length < k) return [];
  const [head, ...tail] = arr;
  const withHead    = combinations(tail, k - 1).map(c => [head, ...c]);
  const withoutHead = combinations(tail, k);
  return [...withHead, ...withoutHead];
}

/**
 * 评估 5 张牌，返回可比较的分数数组
 * 格式：[等级(0–8), ...决胜牌值...]
 * 8=同花顺 7=四条 6=葫芦 5=同花 4=顺子 3=三条 2=两对 1=一对 0=高牌
 */
function evaluateHand5(cards) {
  // 按牌值降序排列
  const vals = cards.map(rankValue).sort((a, b) => b - a);
  const suits = cards.map(cardSuit);

  const isFlush = suits.every(s => s === suits[0]);

  // 检测普通顺子
  let isStraight = false;
  let straightHigh = vals[0];
  if (new Set(vals).size === 5 && vals[0] - vals[4] === 4) {
    isStraight = true;
    straightHigh = vals[0];
  }
  // A-2-3-4-5 轮式顺子（Steel Wheel）
  if (vals[0] === 12 && vals[1] === 3 && vals[2] === 2 && vals[3] === 1 && vals[4] === 0) {
    isStraight = true;
    straightHigh = 3; // 5-high
  }

  // 统计每个牌值出现次数
  const cnt = {};
  for (const v of vals) cnt[v] = (cnt[v] || 0) + 1;

  // 按 [出现次数 DESC, 牌值 DESC] 排序，方便后续比较
  const groups = Object.entries(cnt)
    .map(([v, c]) => [+v, c])
    .sort((a, b) => b[1] - a[1] || b[0] - a[0]);

  const g = groups.map(x => x[1]); // 各组大小

  if (isFlush && isStraight)   return [8, straightHigh];
  if (g[0] === 4)              return [7, groups[0][0], groups[1][0]];
  if (g[0] === 3 && g[1] === 2) return [6, groups[0][0], groups[1][0]];
  if (isFlush)                 return [5, ...vals];
  if (isStraight)              return [4, straightHigh];
  if (g[0] === 3)              return [3, groups[0][0], groups[1][0], groups[2][0]];
  if (g[0] === 2 && g[1] === 2) return [2, groups[0][0], groups[1][0], groups[2][0]];
  if (g[0] === 2)              return [1, groups[0][0], groups[1][0], groups[2][0], groups[3][0]];
  return [0, ...vals];
}

/** 比较两个分数数组，返回 1 / -1 / 0 */
function compareScores(a, b) {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const ai = a[i] ?? -1;
    const bi = b[i] ?? -1;
    if (ai > bi) return  1;
    if (ai < bi) return -1;
  }
  return 0;
}

/** 从 cards（最多 7 张）中选出最佳 5 张并返回其分数 */
function evaluateBestHand(cards) {
  let best = null;
  for (const combo of combinations(cards, 5)) {
    const score = evaluateHand5(combo);
    if (!best || compareScores(score, best) > 0) best = score;
  }
  return best;
}

/** 分数 → 牌型名称 */
function handRankName(score) {
  const NAMES = [
    '高牌', '一对', '两对', '三条',
    '顺子', '同花', '葫芦', '四条', '同花顺',
  ];
  return NAMES[score[0]] ?? '未知';
}

// ═══════════════════════════════════════════════
// §5  通信工具
// ═══════════════════════════════════════════════

/** 向所有已连接客户端广播 */
function broadcast(msg) {
  const str = JSON.stringify(msg);
  for (const ws of clients.values()) {
    try { ws.send(str); } catch (_) {}
  }
}

/** 向指定玩家发送消息 */
function sendTo(playerId, msg) {
  const ws = clients.get(playerId);
  if (ws) try { ws.send(JSON.stringify(msg)); } catch (_) {}
}

/**
 * 广播游戏状态
 * 每个玩家只能看到自己的手牌（selfHand），其他人手牌隐藏
 */
function broadcastState() {
  const pub = players.map((p, i) => ({
    id:        p.id,
    name:      p.name,
    chips:     p.chips,
    bet:       p.bet,
    folded:    p.folded,
    allIn:     p.allIn,
    connected: p.connected,
    isDealer:  i === gameState.dealerIndex,
    isSB:      i === gameState.smallBlindIndex,
    isBB:      i === gameState.bigBlindIndex,
    handCount: p.hand ? p.hand.length : 0,
  }));

  for (const player of players) {
    const ws = clients.get(player.id);
    if (!ws) continue;
    try {
      ws.send(JSON.stringify({
        type:               'state',
        players:            pub,
        community:          gameState.community,
        pot:                gameState.pot,
        stage:              gameState.stage,
        currentPlayerIndex: gameState.currentPlayerIndex,
        currentBet:         gameState.currentBet,
        dealerIndex:        gameState.dealerIndex,
        smallBlindIndex:    gameState.smallBlindIndex,
        bigBlindIndex:      gameState.bigBlindIndex,
        selfHand:           player.hand || [],         // ← 只发给本人
        selfId:             player.id,
      }));
    } catch (_) {}
  }
}

// ═══════════════════════════════════════════════
// §6  玩家工具
// ═══════════════════════════════════════════════

/** 返回能参与行动的玩家（未弃牌、未全押、有筹码） */
function getActionablePlayers() {
  return players.filter(p => !p.folded && !p.allIn && p.chips > 0);
}

/**
 * 从 startIdx 开始（含），向后找第一个可行动玩家的下标
 * 找不到返回 -1
 */
function nextActionableIndex(startIdx) {
  const len = players.length;
  for (let i = 0; i < len; i++) {
    const idx = (startIdx + i) % len;
    const p = players[idx];
    if (!p.folded && !p.allIn && p.chips > 0) return idx;
  }
  return -1;
}

// ═══════════════════════════════════════════════
// §7  游戏流程
// ═══════════════════════════════════════════════

/** 开始新一局 */
function startGame() {
  const connectable = players.filter(p => p.connected && p.chips > 0);
  if (connectable.length < 2) {
    broadcast({ type: 'error', message: '至少需要 2 名有筹码且在线的玩家' });
    return;
  }
  if (gameState.stage !== 'waiting') {
    broadcast({ type: 'error', message: '游戏已在进行中' });
    return;
  }

  // 清理筹码耗尽且离线的玩家
  players = players.filter(p => p.chips > 0 || p.connected);

  // 重置玩家轮次状态
  for (const p of players) {
    p.folded = false;
    p.allIn  = false;
    p.bet    = 0;
    p.hand   = [];
  }

  // 洗牌
  gameState.deck      = shuffleDeck(createDeck());
  gameState.community = [];
  gameState.pot       = 0;
  gameState.actedSet  = new Set();
  gameState.lastRaiserIndex = -1;

  // ── 自动轮庄 ──────────────────────────────────
  // dealerIndex 在已有玩家列表中循环推进
  gameState.dealerIndex      = (gameState.dealerIndex + 1) % players.length;
  gameState.smallBlindIndex  = (gameState.dealerIndex + 1) % players.length;
  gameState.bigBlindIndex    = (gameState.dealerIndex + 2) % players.length;

  // ── 发手牌 ────────────────────────────────────
  for (const p of players) {
    p.hand = [gameState.deck.pop(), gameState.deck.pop()];
  }

  // ── 扣盲注 ────────────────────────────────────
  const sbP = players[gameState.smallBlindIndex];
  const bbP = players[gameState.bigBlindIndex];

  const sbAmt = Math.min(SMALL_BLIND, sbP.chips);
  const bbAmt = Math.min(BIG_BLIND,  bbP.chips);

  sbP.chips -= sbAmt;  sbP.bet = sbAmt;  if (sbP.chips === 0) sbP.allIn = true;
  bbP.chips -= bbAmt;  bbP.bet = bbAmt;  if (bbP.chips === 0) bbP.allIn = true;

  gameState.pot        = sbAmt + bbAmt;
  gameState.currentBet = bbAmt;
  gameState.stage      = 'preflop';

  // preflop 从 BB 后第一个可行动玩家开始
  gameState.currentPlayerIndex = nextActionableIndex(
    (gameState.bigBlindIndex + 1) % players.length
  );

  broadcastState();
  broadcast({
    type:    'message',
    message: `🃏 新一局开始！庄家：${players[gameState.dealerIndex].name}，SB：${sbP.name}，BB：${bbP.name}`,
  });
}

// ─────────────────────────────────────────────────
// 处理玩家行动
// ─────────────────────────────────────────────────
function handleAction(playerId, action, amount) {
  if (gameState.stage === 'waiting' || gameState.stage === 'showdown') {
    sendTo(playerId, { type: 'error', message: '当前不是行动阶段' });
    return;
  }

  const idx = players.findIndex(p => p.id === playerId);
  if (idx === -1) return;

  if (idx !== gameState.currentPlayerIndex) {
    sendTo(playerId, { type: 'error', message: '还没到你的回合' });
    return;
  }

  const player = players[idx];
  if (player.folded || player.allIn) {
    sendTo(playerId, { type: 'error', message: '你已弃牌或全押' });
    return;
  }

  switch (action) {

    // ── Fold ───────────────────────────────────
    case 'fold':
      player.folded = true;
      gameState.actedSet.add(playerId);
      broadcast({ type: 'message', message: `${player.name} 弃牌` });
      break;

    // ── Check ──────────────────────────────────
    case 'check':
      if (player.bet < gameState.currentBet) {
        sendTo(playerId, { type: 'error', message: '当前有注可跟，不能过牌' });
        return;
      }
      gameState.actedSet.add(playerId);
      broadcast({ type: 'message', message: `${player.name} 过牌` });
      break;

    // ── Call ───────────────────────────────────
    case 'call': {
      const need = Math.min(gameState.currentBet - player.bet, player.chips);
      player.chips     -= need;
      player.bet       += need;
      gameState.pot    += need;
      if (player.chips === 0) player.allIn = true;
      gameState.actedSet.add(playerId);
      broadcast({ type: 'message', message: `${player.name} 跟注 ${need}` });
      break;
    }

    // ── Raise ──────────────────────────────────
    case 'raise': {
      const minRaise = gameState.currentBet * 2;
      if (!amount || amount < minRaise) {
        sendTo(playerId, { type: 'error', message: `加注至少需要 ${minRaise}（当前注的两倍）` });
        return;
      }
      // amount 是玩家本轮的总注额（全量，非增量）
      const totalBet  = Math.min(amount, player.chips + player.bet);
      const addChips  = totalBet - player.bet;
      if (addChips > player.chips) {
        sendTo(playerId, { type: 'error', message: '筹码不足' });
        return;
      }
      player.chips          -= addChips;
      gameState.pot         += addChips;
      player.bet             = totalBet;
      gameState.currentBet   = totalBet;
      if (player.chips === 0) player.allIn = true;

      // 加注后，其他玩家需要重新行动
      gameState.actedSet        = new Set([playerId]);
      gameState.lastRaiserIndex  = idx;
      broadcast({ type: 'message', message: `${player.name} 加注至 ${totalBet}` });
      break;
    }

    // ── All-in ─────────────────────────────────
    case 'allin': {
      const allInAmt = player.chips;
      player.bet       += allInAmt;
      gameState.pot    += allInAmt;
      if (player.bet > gameState.currentBet) {
        gameState.currentBet  = player.bet;
        gameState.actedSet    = new Set([playerId]);
        gameState.lastRaiserIndex = idx;
      } else {
        gameState.actedSet.add(playerId);
      }
      player.chips  = 0;
      player.allIn  = true;
      broadcast({ type: 'message', message: `${player.name} 全押 ${allInAmt}` });
      break;
    }

    default:
      sendTo(playerId, { type: 'error', message: '未知操作类型' });
      return;
  }

  advanceTurn();
}

// ─────────────────────────────────────────────────
// 推进行动
// ─────────────────────────────────────────────────
function advanceTurn() {
  // 只剩一人未弃牌 → 直接赢得底池
  const activePlayers = players.filter(p => !p.folded);
  if (activePlayers.length === 1) {
    const winner = activePlayers[0];
    winner.chips += gameState.pot;
    broadcast({
      type:    'message',
      message: `🏆 ${winner.name} 赢得 ${gameState.pot} 筹码（其他人全部弃牌）`,
    });
    endHand();
    return;
  }

  // 检查本轮下注是否结束
  if (isBettingRoundComplete()) {
    advanceStage();
    return;
  }

  // 移动到下一个可行动玩家
  const next = nextActionableIndex((gameState.currentPlayerIndex + 1) % players.length);
  if (next === -1) {
    // 所有人都全押或弃牌，直接跑完公共牌
    advanceStageAllIn();
    return;
  }
  gameState.currentPlayerIndex = next;
  broadcastState();
}

/**
 * 判断本轮下注是否完成：
 *  所有可行动玩家（未弃牌、未全押、有筹码）均已行动，
 *  且注额已跟齐到 currentBet
 */
function isBettingRoundComplete() {
  const actionable = getActionablePlayers();
  if (actionable.length === 0) return true;
  return actionable.every(
    p => gameState.actedSet.has(p.id) && p.bet === gameState.currentBet
  );
}

/** 进入下一个公共牌阶段 */
function advanceStage() {
  // 重置本轮下注状态
  for (const p of players) p.bet = 0;
  gameState.currentBet      = 0;
  gameState.actedSet        = new Set();
  gameState.lastRaiserIndex = -1;

  switch (gameState.stage) {
    case 'preflop':
      gameState.stage = 'flop';
      gameState.community.push(
        gameState.deck.pop(),
        gameState.deck.pop(),
        gameState.deck.pop()
      );
      broadcast({ type: 'message', message: `🂠 翻牌：${gameState.community.join(' ')}` });
      break;
    case 'flop':
      gameState.stage = 'turn';
      gameState.community.push(gameState.deck.pop());
      broadcast({ type: 'message', message: `🂠 转牌：${gameState.community[3]}` });
      break;
    case 'turn':
      gameState.stage = 'river';
      gameState.community.push(gameState.deck.pop());
      broadcast({ type: 'message', message: `🂠 河牌：${gameState.community[4]}` });
      break;
    case 'river':
      gameState.stage = 'showdown';
      showdown();
      return;
    default:
      return;
  }

  // 下注顺序从庄家后开始
  gameState.currentPlayerIndex = nextActionableIndex(
    (gameState.dealerIndex + 1) % players.length
  );
  broadcastState();
}

/** 所有人全押场景下直接把剩余公共牌发完 */
function advanceStageAllIn() {
  for (const p of players) p.bet = 0;
  gameState.currentBet      = 0;
  gameState.actedSet        = new Set();
  gameState.lastRaiserIndex = -1;

  while (gameState.community.length < 5 && gameState.stage !== 'showdown') {
    if (gameState.stage === 'preflop') {
      gameState.community.push(
        gameState.deck.pop(), gameState.deck.pop(), gameState.deck.pop()
      );
      gameState.stage = 'flop';
    } else if (gameState.stage === 'flop') {
      gameState.community.push(gameState.deck.pop());
      gameState.stage = 'turn';
    } else if (gameState.stage === 'turn') {
      gameState.community.push(gameState.deck.pop());
      gameState.stage = 'river';
    } else if (gameState.stage === 'river') {
      break;
    }
  }

  gameState.stage = 'showdown';
  broadcastState();
  showdown();
}

// ─────────────────────────────────────────────────
// 摊牌
// ─────────────────────────────────────────────────
function showdown() {
  const notFolded = players.filter(p => !p.folded);

  // 计算每人最佳牌型
  const results = notFolded.map(p => {
    const score = evaluateBestHand([...p.hand, ...gameState.community]);
    return { player: p, score, handName: handRankName(score) };
  });

  // 排序，找出赢家（允许平局）
  results.sort((a, b) => compareScores(b.score, a.score));
  const topScore  = results[0].score;
  const winners   = results.filter(r => compareScores(r.score, topScore) === 0);
  const winAmount = Math.floor(gameState.pot / winners.length);

  for (const w of winners) w.player.chips += winAmount;

  // 广播摊牌结果（可见所有人手牌）
  broadcast({
    type:     'showdown',
    results:  notFolded.map(p => ({
      id:       p.id,
      name:     p.name,
      hand:     p.hand,
      handName: results.find(r => r.player.id === p.id)?.handName ?? '',
    })),
    winners:  winners.map(w => ({
      id:       w.player.id,
      name:     w.player.name,
      amount:   winAmount,
      handName: w.handName,
    })),
    community: gameState.community,
    pot:       gameState.pot,
  });

  broadcastState();

  // 延迟收局
  setTimeout(endHand, SHOWDOWN_DELAY);
}

// ─────────────────────────────────────────────────
// 收局
// ─────────────────────────────────────────────────
function endHand() {
  // 移除筹码耗尽且离线的玩家
  players = players.filter(p => p.chips > 0 || p.connected);

  gameState.stage           = 'waiting';
  gameState.community       = [];
  gameState.pot             = 0;
  gameState.currentBet      = 0;
  gameState.actedSet        = new Set();
  gameState.lastRaiserIndex = -1;

  for (const p of players) {
    p.folded = false;
    p.allIn  = false;
    p.bet    = 0;
    p.hand   = [];
  }

  broadcastState();
  broadcast({ type: 'message', message: '本局结束，等待开始新一局…' });
}

// ═══════════════════════════════════════════════
// §8  断线重连 + 定时清理
// ═══════════════════════════════════════════════

/** 清理超过 DISCONNECT_TTL 未重连的玩家 */
function cleanupStale() {
  const now = Date.now();
  const before = players.length;
  players = players.filter(p => {
    if (!p.connected && (now - p.lastSeen) > DISCONNECT_TTL) {
      clients.delete(p.id);
      return false;
    }
    return true;
  });
  if (players.length < before) broadcastState();
}

// ═══════════════════════════════════════════════
// §9  WebSocket 消息路由
// ═══════════════════════════════════════════════

/**
 * 所有消息处理入口，通过 Promise 队列串行执行，
 * 防止并发修改全局状态
 */
function enqueue(fn) {
  operationQueue = operationQueue.then(() => {
    try { fn(); } catch (e) { console.error('操作错误:', e); }
  });
}

function handleMessage(playerId, raw) {
  enqueue(() => {
    let msg;
    try { msg = JSON.parse(raw); } catch (_) {
      sendTo(playerId, { type: 'error', message: '消息格式错误（需要 JSON）' });
      return;
    }

    switch (msg.type) {

      // ── 加入 / 重连 ───────────────────────────
      case 'join': {
        const existing = players.find(p => p.id === playerId);
        if (existing) {
          // 重连：恢复状态，不重置筹码
          existing.connected = true;
          existing.lastSeen  = Date.now();
          if (msg.name) existing.name = msg.name;
          broadcastState();
          broadcast({ type: 'message', message: `${existing.name} 重新连线` });
        } else {
          // 新玩家
          if (players.length >= MAX_PLAYERS) {
            sendTo(playerId, { type: 'error', message: '房间已满（最多 8 人）' });
            return;
          }
          const name = (msg.name || '').trim() || `玩家${players.length + 1}`;
          players.push({
            id:        playerId,
            name,
            chips:     INITIAL_CHIPS,
            hand:      [],
            folded:    false,
            allIn:     false,
            bet:       0,
            connected: true,
            lastSeen:  Date.now(),
          });
          broadcastState();
          broadcast({ type: 'message', message: `${name} 加入房间（初始筹码 ${INITIAL_CHIPS}）` });
        }
        break;
      }

      // ── 开始游戏 ──────────────────────────────
      case 'start_game':
        startGame();
        break;

      // ── 玩家行动 ──────────────────────────────
      case 'action':
        handleAction(playerId, msg.action, msg.amount);
        break;

      default:
        sendTo(playerId, { type: 'error', message: `未知消息类型: ${msg.type}` });
    }
  });
}

// ═══════════════════════════════════════════════
// §10  WebSocket 升级处理
// ═══════════════════════════════════════════════

function upgradeWebSocket(request) {
  // playerId 由前端通过 URL query 传入
  const url      = new URL(request.url);
  const playerId = url.searchParams.get('playerId') || crypto.randomUUID();

  const pair   = new WebSocketPair();
  const client = pair[0];
  const server = pair[1];

  server.accept();

  // 注册 WebSocket
  clients.set(playerId, server);

  server.addEventListener('message', evt => {
    handleMessage(playerId, evt.data);
  });

  server.addEventListener('close', () => {
    enqueue(() => {
      clients.delete(playerId);
      const player = players.find(p => p.id === playerId);
      if (player) {
        player.connected = false;
        player.lastSeen  = Date.now();
        broadcastState();
        broadcast({ type: 'message', message: `${player.name} 断线` });
      }
    });
  });

  server.addEventListener('error', () => {
    clients.delete(playerId);
  });

  // 仅注册一次定时清理
  if (!cleanupScheduled) {
    cleanupScheduled = true;
    setInterval(cleanupStale, 60_000);
  }

  return new Response(null, { status: 101, webSocket: client });
}

// ═══════════════════════════════════════════════
// §11  主 Fetch 入口
// ═══════════════════════════════════════════════

export default {
  async fetch(request) {
    const url = new URL(request.url);

    // CORS 预检
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin':  '*',
          'Access-Control-Allow-Methods': 'GET, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Upgrade',
        },
      });
    }

    // WebSocket 升级
    if (request.headers.get('Upgrade') === 'websocket') {
      return upgradeWebSocket(request);
    }

    // 健康检查 / 调试
    if (url.pathname === '/status') {
      return new Response(
        JSON.stringify({
          status:      'ok',
          players:     players.length,
          connected:   players.filter(p => p.connected).length,
          stage:       gameState.stage,
          pot:         gameState.pot,
        }),
        { headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } }
      );
    }

    return new Response('Texas Hold\'em Worker is running', { status: 200 });
  },
};
