/**
 * main.js — 德州扑克前端逻辑
 *
 * 职责：
 *  - 管理 WebSocket 连接（含断线重连）
 *  - 渲染游戏状态（玩家列表、公共牌、手牌、底池）
 *  - 转发用户行动至 Worker
 *
 * ⚠️ 前端不含任何游戏规则逻辑，所有规则由 Worker 执行。
 */

'use strict';

// ═══════════════════════════════════════════════
// §1  配置
// ═══════════════════════════════════════════════

/**
 * Worker WebSocket 地址
 * 部署后替换为你的 Worker URL，例如：
 *   wss://texas-poker.your-name.workers.dev
 *
 * 本地调试（wrangler dev）时使用：
 *   ws://localhost:8787
 */
const WORKER_WS_URL = 'wss://poker.cc8170.top';

const RECONNECT_DELAY_MS   = 2000;   // 初始重连延迟
const RECONNECT_MAX_DELAY  = 30000;  // 最大重连延迟
const RECONNECT_BACKOFF    = 1.5;    // 退避倍数

// ═══════════════════════════════════════════════
// §2  玩家身份（持久化在 localStorage）
// ═══════════════════════════════════════════════

let playerId = localStorage.getItem('playerId');
if (!playerId) {
  playerId = crypto.randomUUID();
  localStorage.setItem('playerId', playerId);
}

let playerName = '';   // 登录后设置

// ═══════════════════════════════════════════════
// §3  DOM 引用
// ═══════════════════════════════════════════════

const loginScreen      = document.getElementById('login-screen');
const nameInput        = document.getElementById('name-input');
const btnEnter         = document.getElementById('btn-enter');
const connStatus       = document.getElementById('conn-status');
const stageLabel       = document.getElementById('stage-label');
const potLabel         = document.getElementById('pot-label');
const betLabel         = document.getElementById('bet-label');
const playerList       = document.getElementById('player-list');
const communityCards   = document.getElementById('community-cards');
const handCard0        = document.getElementById('hand-0');
const handCard1        = document.getElementById('hand-1');
const msgLog           = document.getElementById('msg-log');
const showdownOverlay  = document.getElementById('showdown-overlay');
const showdownResults  = document.getElementById('showdown-results');

const btnStart  = document.getElementById('btn-start');
const btnFold   = document.getElementById('btn-fold');
const btnCheck  = document.getElementById('btn-check');
const btnCall   = document.getElementById('btn-call');
const btnRaise  = document.getElementById('btn-raise');
const btnAllin  = document.getElementById('btn-allin');
const raiseInput = document.getElementById('raise-input');
const btnBorrow   = document.getElementById('btn-borrow');
const btnDissolve = document.getElementById('btn-dissolve');
const dissolveBar   = document.getElementById('dissolve-bar');
const dissolveCount = document.getElementById('dissolve-count');
const dissolveTotal = document.getElementById('dissolve-total');
const startVoteBar   = document.getElementById('start-vote-bar');
const startVoteCount = document.getElementById('start-count');
const startVoteTotal = document.getElementById('start-total');

// ═══════════════════════════════════════════════
// §4  WebSocket 管理
// ═══════════════════════════════════════════════

let ws             = null;
let reconnectDelay = RECONNECT_DELAY_MS;
let reconnectTimer = null;
let intentionalClose = false;

/** 建立 WebSocket 连接（playerId 通过 query 传入） */
function connect() {
  intentionalClose = false;
  const url = `${WORKER_WS_URL}?playerId=${encodeURIComponent(playerId)}`;
  ws = new WebSocket(url);

  setConnStatus('reconnecting', '🟡 连接中…');

  ws.addEventListener('open', () => {
    reconnectDelay = RECONNECT_DELAY_MS;   // 重置退避
    setConnStatus('connected', '🟢 已连接');

    // 发送 join（新玩家 or 重连）
    send({ type: 'join', playerId, name: playerName });
  });

  ws.addEventListener('message', evt => {
    try {
      handleServerMessage(JSON.parse(evt.data));
    } catch (e) {
      console.error('消息解析失败:', e);
    }
  });

  ws.addEventListener('close', () => {
    if (!intentionalClose) scheduleReconnect();
  });

  ws.addEventListener('error', () => {
    ws.close();
  });
}

function scheduleReconnect() {
  setConnStatus('disconnected', `🔴 断线，${Math.round(reconnectDelay / 1000)}s 后重连…`);
  clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(() => {
    setConnStatus('reconnecting', '🟡 重连中…');
    connect();
  }, reconnectDelay);
  reconnectDelay = Math.min(reconnectDelay * RECONNECT_BACKOFF, RECONNECT_MAX_DELAY);
}

function setConnStatus(cls, text) {
  connStatus.textContent = text;
  connStatus.className   = cls;
}

/** 安全发送消息 */
function send(msg) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

// ═══════════════════════════════════════════════
// §5  服务器消息处理
// ═══════════════════════════════════════════════

/** 当前游戏状态快照（用于渲染和按钮控制） */
let lastState = null;

function handleServerMessage(msg) {
  switch (msg.type) {

    case 'state':
      lastState = msg;
      renderState(msg);
      break;

    case 'showdown':
      renderShowdown(msg);
      break;

    case 'dissolve':
      alert(msg.message || '房间已解散！');
      // 清除本地 playerId，回到初始状态
      localStorage.removeItem('playerId');
      location.reload();
      break;

    case 'message':
      appendLog(msg.message, 'system');
      break;

    case 'error':
      appendLog('⚠ ' + msg.message, 'error');
      break;

    default:
      console.warn('未知消息类型:', msg.type);
  }
}

// ═══════════════════════════════════════════════
// §6  渲染
// ═══════════════════════════════════════════════

const STAGE_NAMES = {
  waiting:  '等待开始',
  preflop:  '翻牌前',
  flop:     '翻牌',
  turn:     '转牌',
  river:    '河牌',
  showdown: '摊牌',
};

/** 渲染完整游戏状态 */
function renderState(state) {
  stageLabel.textContent = STAGE_NAMES[state.stage] ?? state.stage;
  potLabel.textContent   = state.pot;
  betLabel.textContent   = state.currentBet;
  renderPlayerList(state);
  renderCommunityCards(state.community);
  renderHandCardsFixed(state.selfHand);   // 每次从 DOM 重新查找节点，避免引用失效
  updateButtons(state);
}

// ─────────────────────────────────────────────
// 玩家列表
// ─────────────────────────────────────────────
function renderPlayerList(state) {
  playerList.innerHTML = '';
  state.players.forEach((p, i) => {
    const isCurrentTurn = i === state.currentPlayerIndex && state.stage !== 'waiting' && state.stage !== 'showdown';
    const isSelf        = p.id === state.selfId;

    const row = document.createElement('div');
    row.className = [
      'player-row',
      isCurrentTurn ? 'active-turn' : '',
      p.folded       ? 'folded-player' : '',
      isSelf         ? 'self' : '',
    ].filter(Boolean).join(' ');

    // 头像首字母
    const avatar = document.createElement('div');
    avatar.className   = 'player-avatar';
    avatar.textContent = p.name.charAt(0).toUpperCase();

    // 信息区
    const info = document.createElement('div');
    info.className = 'player-info';

    const nameLine = document.createElement('div');
    nameLine.className   = 'player-name';
    nameLine.textContent = p.name + (isSelf ? ' (我)' : '') + (p.connected ? '' : ' 📴');

    const chipsLine = document.createElement('div');
    chipsLine.className   = 'player-chips';
    chipsLine.textContent = `💰 ${p.chips}`;

    if (p.bet > 0) {
      const betLine = document.createElement('div');
      betLine.className   = 'player-bet';
      betLine.textContent = `下注: ${p.bet}`;
      info.appendChild(betLine);
    }
    if (p.debt > 0) {
      const debtLine = document.createElement('div');
      debtLine.className   = 'player-debt';
      debtLine.textContent = `欠款: ${p.debt}`;
      info.appendChild(debtLine);
    }

    info.prepend(nameLine, chipsLine);

    // 徽章区
    const badges = document.createElement('div');
    badges.style.cssText = 'display:flex;flex-direction:column;gap:2px;align-items:flex-end';

    if (p.isDealer) badges.appendChild(makeBadge('庄', 'badge-D'));
    if (p.isSB)     badges.appendChild(makeBadge('小盲', 'badge-SB'));
    if (p.isBB)     badges.appendChild(makeBadge('大盲', 'badge-BB'));
    if (!p.connected && !p.folded) badges.appendChild(makeBadge('离线', 'badge-off'));
    if (p.allIn)    badges.appendChild(makeBadge('全押', 'badge-ai'));
    if (p.folded)   badges.appendChild(makeBadge('弃牌', 'badge-off'));
    if (p.votedDissolve) badges.appendChild(makeBadge('解散✔', 'badge-dissolve'));
    if (p.votedStart)    badges.appendChild(makeBadge('准备✔', 'badge-SB'));

    row.appendChild(avatar);
    row.appendChild(info);
    row.appendChild(badges);
    playerList.appendChild(row);
  });
}

function makeBadge(text, cls) {
  const b = document.createElement('span');
  b.className   = `badge ${cls}`;
  b.textContent = text;
  return b;
}

// ─────────────────────────────────────────────
// 公共牌
// ─────────────────────────────────────────────
const SUIT_SYMBOLS = { H: '♥', D: '♦', C: '♣', S: '♠' };
const SUIT_CLASSES = { H: 'hearts', D: 'diamonds', C: 'clubs', S: 'spades' };

function makeCardElement(cardStr) {
  const rank = cardStr.slice(0, -1);  // '2'–'A'
  const suit = cardStr.slice(-1);     // H/D/C/S
  const displayRank = rank === 'T' ? '10' : rank;

  const el = document.createElement('div');
  el.className = `card ${SUIT_CLASSES[suit] ?? ''}`;
  el.innerHTML =
    `<div class="rank">${displayRank}</div>` +
    `<div class="suit">${SUIT_SYMBOLS[suit] ?? suit}</div>`;
  return el;
}

function renderCommunityCards(community) {
  // 保持 5 个槽位
  const slots = communityCards.querySelectorAll('[data-slot]');
  slots.forEach((slot, i) => {
    if (community[i]) {
      const card = makeCardElement(community[i]);
      card.dataset.slot = i;
      communityCards.replaceChild(card, slot);
    } else {
      // 确保是占位符
      if (!slot.classList.contains('placeholder')) {
        const ph = document.createElement('div');
        ph.className   = 'card placeholder';
        ph.dataset.slot = i;
        communityCards.replaceChild(ph, slot);
      }
    }
  });
}

// ─────────────────────────────────────────────
// 手牌
// ─────────────────────────────────────────────
function renderHandCards(hand) {
  const slots = [handCard0, handCard1];
  slots.forEach((slot, i) => {
    const container = slot.parentElement;
    if (hand && hand[i]) {
      const card = makeCardElement(hand[i]);
      card.id = slot.id;                     // 保持 id 方便后续替换
      container.replaceChild(card, slot);
      // 更新引用（下次替换用新节点）
      /* 不更新引用，因为 replaceChild 之后旧引用失效 */
    } else {
      if (!slot.classList.contains('placeholder')) {
        const ph = document.createElement('div');
        ph.className = 'card placeholder';
        ph.id        = slot.id;
        container.replaceChild(ph, slot);
      }
    }
  });
  // 重新绑定引用
  // （每次 renderState 时 DOM 可能已被替换，直接 querySelector 是安全的）
}

// ─────────────────────────────────────────────
// 按钮状态控制
// ─────────────────────────────────────────────
function updateButtons(state) {
  const inGame      = state.stage !== 'waiting' && state.stage !== 'showdown';
  const selfIdx     = state.players.findIndex(p => p.id === state.selfId);
  const isMyTurn    = inGame && selfIdx === state.currentPlayerIndex;
  const selfPlayer  = state.players[selfIdx];
  const selfFolded  = selfPlayer?.folded ?? true;
  const selfAllIn   = selfPlayer?.allIn ?? true;
  const canAct      = isMyTurn && !selfFolded && !selfAllIn;

  // Start Game：待机阶段可投票，按投票状态切换文字
  const selfStart = state.players.find(p => p.id === state.selfId);
  if (state.stage === 'waiting') {
    btnStart.disabled = false;
    if (selfStart?.votedStart) {
      btnStart.textContent = '撤回开始';
      btnStart.classList.add('voted');
    } else {
      btnStart.textContent = '🎮 开始游戏';
      btnStart.classList.remove('voted');
    }
  } else {
    btnStart.disabled = true;
    btnStart.textContent = '🎮 开始游戏';
    btnStart.classList.remove('voted');
  }

  // 开始投票进度条
  if (state.startVotes > 0 && state.stage === 'waiting') {
    startVoteBar.classList.add('visible');
    startVoteCount.textContent = state.startVotes;
    startVoteTotal.textContent = state.startTotal;
  } else {
    startVoteBar.classList.remove('visible');
  }

  // 借筹码：仅待机阶段可用
  btnBorrow.disabled = state.stage !== 'waiting';

  // 解散房间按钮状态
  const selfPlayer2 = state.players.find(p => p.id === state.selfId);
  if (selfPlayer2?.votedDissolve) {
    btnDissolve.textContent = '撤回解散';
    btnDissolve.classList.add('voted');
  } else {
    btnDissolve.textContent = '🚪 解散房间';
    btnDissolve.classList.remove('voted');
  }

  // 解散投票进度条
  if (state.dissolveVotes > 0) {
    dissolveBar.classList.add('visible');
    dissolveCount.textContent = state.dissolveVotes;
    dissolveTotal.textContent = state.dissolveTotal;
  } else {
    dissolveBar.classList.remove('visible');
  }

  // 行动按钮
  btnFold.disabled  = !canAct;
  btnAllin.disabled = !canAct;

  // Check：只有当前注 ≤ 自己已下注时才能过牌
  const canCheck = canAct && (selfPlayer?.bet ?? 0) >= state.currentBet;
  btnCheck.disabled = !canCheck;

  // Call：有注可跟
  const canCall = canAct && (selfPlayer?.bet ?? 0) < state.currentBet;
  btnCall.disabled = !canCall;
  if (canCall) {
    const callAmt = Math.min(state.currentBet - (selfPlayer?.bet ?? 0), selfPlayer?.chips ?? 0);
    btnCall.textContent = `跟注 (${callAmt})`;
  } else {
    btnCall.textContent = '跟注';
  }

  // Raise
  btnRaise.disabled  = !canAct;
  raiseInput.disabled = !canAct;
  if (canAct) {
    raiseInput.min   = state.currentBet * 2;
    raiseInput.value = raiseInput.value || state.currentBet * 2;
  }
}

// ═══════════════════════════════════════════════
// §7  摊牌界面
// ═══════════════════════════════════════════════

function renderShowdown(msg) {
  showdownResults.innerHTML = '';
  const winnerIds = new Set(msg.winners.map(w => w.id));

  msg.results.forEach(r => {
    const winInfo = msg.winners.find(w => w.id === r.id);
    const isWinner = winnerIds.has(r.id);

    const card = document.createElement('div');
    card.className = `sd-player ${isWinner ? 'winner' : ''}`;

    const handEl = document.createElement('div');
    handEl.className = 'sd-hand';
    (r.hand || []).forEach(c => {
      const small = makeCardElement(c);
      small.style.cssText = 'width:38px;height:54px;font-size:.7rem';
      handEl.appendChild(small);
    });

    card.innerHTML = `<div class="sd-name">${r.name}${isWinner ? ' 🏆' : ''}</div>`;
    card.appendChild(handEl);
    card.innerHTML += `<div class="sd-rank">${r.handName}</div>`;
    if (winInfo) {
      card.innerHTML += `<div class="sd-award">+${winInfo.amount}</div>`;
    }

    showdownResults.appendChild(card);
  });

  showdownOverlay.classList.add('visible');
  setTimeout(() => showdownOverlay.classList.remove('visible'), 5500);

  appendLog(`摊牌结果：${msg.winners.map(w => `${w.name}（${w.handName}）+${w.amount}`).join('，')}`, 'system');
}

// ═══════════════════════════════════════════════
// §8  消息日志
// ═══════════════════════════════════════════════

function appendLog(text, cls = '') {
  const line = document.createElement('div');
  line.className   = `log-line ${cls}`.trim();
  line.textContent = text;
  // column-reverse 布局：prepend 使最新消息在顶
  msgLog.prepend(line);
  // 保留最近 80 条
  while (msgLog.childElementCount > 80) msgLog.lastChild.remove();
}

// ═══════════════════════════════════════════════
// §9  用户交互
// ═══════════════════════════════════════════════

/* 登录 */
function doEnter() {
  const name = nameInput.value.trim();
  if (!name) { nameInput.focus(); return; }
  playerName = name;
  loginScreen.style.display = 'none';
  connect();
}

btnEnter.addEventListener('click', doEnter);
nameInput.addEventListener('keydown', e => { if (e.key === 'Enter') doEnter(); });

/* 开始游戏 */
btnStart.addEventListener('click', () => {
  send({ type: 'start_game' });
});

/* 弃牌 */
btnFold.addEventListener('click', () => {
  send({ type: 'action', action: 'fold' });
});

/* 过牌 */
btnCheck.addEventListener('click', () => {
  send({ type: 'action', action: 'check' });
});

/* 跟注 */
btnCall.addEventListener('click', () => {
  send({ type: 'action', action: 'call' });
});

/* 加注 */
btnRaise.addEventListener('click', () => {
  const amount = parseInt(raiseInput.value, 10);
  if (!amount || amount <= 0) {
    appendLog('⚠ 请输入有效的加注金额', 'error');
    return;
  }
  send({ type: 'action', action: 'raise', amount });
});

/* 全押 */
btnAllin.addEventListener('click', () => {
  send({ type: 'action', action: 'allin' });
});

/* 借筹码（每次 +1000，记入欠款） */
btnBorrow.addEventListener('click', () => {
  send({ type: 'borrow' });
});

/* 解散房间（投票 / 撤票） */
btnDissolve.addEventListener('click', () => {
  send({ type: 'dissolve_vote' });
});

/* 关闭摊牌覆盖层 */
showdownOverlay.addEventListener('click', () => {
  showdownOverlay.classList.remove('visible');
});

// ═══════════════════════════════════════════════
// §10  页面可见性变化时尝试重连
// ═══════════════════════════════════════════════
document.addEventListener('visibilitychange', () => {
  if (
    !document.hidden &&
    playerName &&
    ws &&
    ws.readyState !== WebSocket.OPEN &&
    ws.readyState !== WebSocket.CONNECTING
  ) {
    clearTimeout(reconnectTimer);
    connect();
  }
});

// ═══════════════════════════════════════════════
// §11  修复 renderHandCards 引用丢失问题
//       每次渲染前重新从 DOM 查找节点
// ═══════════════════════════════════════════════
function renderHandCardsFixed(hand) {
  const HAND_IDS = ['hand-0', 'hand-1'];
  HAND_IDS.forEach((id, i) => {
    const curr = document.getElementById(id);
    if (!curr) return;
    const container = curr.parentElement;
    if (hand && hand[i]) {
      const card = makeCardElement(hand[i]);
      card.id = id;
      container.replaceChild(card, curr);
    } else {
      if (!curr.classList.contains('placeholder')) {
        const ph = document.createElement('div');
        ph.className = 'card placeholder';
        ph.id        = id;
        container.replaceChild(ph, curr);
      }
    }
  });
}

// renderHandCardsFixed 已在上方 renderState 中调用，此处无重复定义
