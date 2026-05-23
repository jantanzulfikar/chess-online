let socket = null;
const tokenStorageKey = 'caturwarsToken';
const victorySoundUrl = '/media/victory-sound.m4a';
const checkSoundUrl = '/media/check-sound.m4a';
let token = sessionStorage.getItem(tokenStorageKey) || '';
let me = null;
let myColor = 'spectator';
let state = null;
let selected = null;
let legalTargets = new Set();
let lastResultKey = '';
let lastPgn = '';
let audioContext = null;
let pendingPromotion = null;
let clockTimer = null;
let clockReceivedAt = 0;
let dragState = null;
let suppressNextClick = false;

const authView = document.querySelector('#authView');
const gameView = document.querySelector('#gameView');
const authForm = document.querySelector('#authForm');
const registerForm = document.querySelector('#registerForm');
const usernameInput = document.querySelector('#usernameInput');
const passwordInput = document.querySelector('#passwordInput');
const registerUsernameInput = document.querySelector('#registerUsernameInput');
const registerCountryInput = document.querySelector('#registerCountryInput');
const registerPasswordInput = document.querySelector('#registerPasswordInput');
const showRegisterBtn = document.querySelector('#showRegisterBtn');
const showLoginBtn = document.querySelector('#showLoginBtn');
const authError = document.querySelector('#authError');
const registerError = document.querySelector('#registerError');
const boardEl = document.querySelector('#board');
const roleBadge = document.querySelector('#roleBadge');
const profileName = document.querySelector('#profileName');
const profileElo = document.querySelector('#profileElo');
const logoutBtn = document.querySelector('#logoutBtn');
const findMatchBtn = document.querySelector('#findMatchBtn');
const cancelMatchBtn = document.querySelector('#cancelMatchBtn');
const resignBtn = document.querySelector('#resignBtn');
const queueText = document.querySelector('#queueText');
const turnText = document.querySelector('#turnText');
const gameText = document.querySelector('#gameText');
const whiteName = document.querySelector('#whiteName');
const blackName = document.querySelector('#blackName');
const whiteScore = document.querySelector('#whiteScore');
const blackScore = document.querySelector('#blackScore');
const whiteClock = document.querySelector('#whiteClock');
const blackClock = document.querySelector('#blackClock');
const whiteCard = document.querySelector('#whiteCard');
const blackCard = document.querySelector('#blackCard');
const whiteCaptured = document.querySelector('#whiteCaptured');
const blackCaptured = document.querySelector('#blackCaptured');
const lastMoveText = document.querySelector('#lastMoveText');
const moveList = document.querySelector('#moveList');
const leaderboardList = document.querySelector('#leaderboardList');
const roomLabel = document.querySelector('#roomLabel');
const matchOverlay = document.querySelector('#matchOverlay');
const overlayCancelBtn = document.querySelector('#overlayCancelBtn');
const promotionOverlay = document.querySelector('#promotionOverlay');
const resultOverlay = document.querySelector('#resultOverlay');
const resultKicker = document.querySelector('#resultKicker');
const resultTitle = document.querySelector('#resultTitle');
const resultText = document.querySelector('#resultText');
const resultCloseBtn = document.querySelector('#resultCloseBtn');
const duelStage = document.querySelector('#duelStage');
const loserKing = document.querySelector('#loserKing');
const bladePiece = document.querySelector('#bladePiece');
const rematchBox = document.querySelector('#rematchBox');
const rematchBtn = document.querySelector('#rematchBtn');
const rematchText = document.querySelector('#rematchText');
const chatStatus = document.querySelector('#chatStatus');
const chatList = document.querySelector('#chatList');
const chatForm = document.querySelector('#chatForm');
const chatInput = document.querySelector('#chatInput');

const pieces = {
  wp: '♙', wr: '♖', wn: '♘', wb: '♗', wq: '♕', wk: '♔',
  bp: '♟', br: '♜', bn: '♞', bb: '♝', bq: '♛', bk: '♚',
};
const capturedSymbols = {
  w: { p: '♙', r: '♖', n: '♘', b: '♗', q: '♕' },
  b: { p: '♟', r: '♜', n: '♞', b: '♝', q: '♛' },
};
const countries = {
  ID: { flag: '🇮🇩', name: 'Indonesia' },
  MY: { flag: '🇲🇾', name: 'Malaysia' },
  SG: { flag: '🇸🇬', name: 'Singapore' },
  PH: { flag: '🇵🇭', name: 'Philippines' },
  TH: { flag: '🇹🇭', name: 'Thailand' },
  VN: { flag: '🇻🇳', name: 'Vietnam' },
  US: { flag: '🇺🇸', name: 'United States' },
  JP: { flag: '🇯🇵', name: 'Japan' },
  KR: { flag: '🇰🇷', name: 'South Korea' },
  CN: { flag: '🇨🇳', name: 'China' },
  IN: { flag: '🇮🇳', name: 'India' },
  BR: { flag: '🇧🇷', name: 'Brazil' },
  GB: { flag: '🇬🇧', name: 'United Kingdom' },
  DE: { flag: '🇩🇪', name: 'Germany' },
  FR: { flag: '🇫🇷', name: 'France' },
  AU: { flag: '🇦🇺', name: 'Australia' },
};

async function api(path, body) {
  const response = await fetch(path, {
    method: body ? 'POST' : 'GET',
    headers: {
      'Content-Type': 'application/json',
      Authorization: token ? 'Bearer ' + token : '',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Request gagal');
  return data;
}

async function login() {
  authError.textContent = '';
  try {
    const payload = {
      username: usernameInput.value,
      password: passwordInput.value,
    };
    const data = await api('/api/login', payload);
    token = data.token;
    me = data.user;
    sessionStorage.setItem(tokenStorageKey, token);
    localStorage.removeItem(tokenStorageKey);
    connect();
  } catch (error) {
    authError.textContent = error.message;
  }
}

async function registerAccount() {
  registerError.textContent = '';
  try {
    const payload = {
      username: registerUsernameInput.value,
      country: registerCountryInput.value,
      password: registerPasswordInput.value,
    };
    const data = await api('/api/register', payload);
    token = data.token;
    me = data.user;
    sessionStorage.setItem(tokenStorageKey, token);
    localStorage.removeItem(tokenStorageKey);
    connect();
  } catch (error) {
    registerError.textContent = error.message;
  }
}

function showRegister() {
  authError.textContent = '';
  registerError.textContent = '';
  authForm.classList.add('hidden');
  registerForm.classList.remove('hidden');
  registerUsernameInput.focus();
}

function showLogin() {
  authError.textContent = '';
  registerError.textContent = '';
  registerForm.classList.add('hidden');
  authForm.classList.remove('hidden');
  usernameInput.focus();
}

function connect() {
  if (!token) {
    showAuth();
    return;
  }
  showGame();
  if (socket) socket.disconnect();

  socket = io({ auth: { token } });
  socket.on('connect_error', () => logout());
  socket.on('me', (user) => {
    me = user;
    renderProfile();
  });
  socket.on('role', ({ color, roomId }) => {
    matchOverlay.classList.add('hidden');
    myColor = color;
    roleBadge.textContent = color === 'w' ? 'Putih' : color === 'b' ? 'Hitam' : 'Spectator';
    roomLabel.textContent = roomId || 'no match';
  });
	  socket.on('state', (nextState) => {
    matchOverlay.classList.add('hidden');
    const moved = Boolean(state && nextState.pgn && nextState.pgn !== lastPgn);
    if (moved) playMoveSound();
    if (moved && nextState.isCheck && !nextState.result) playCheckSound();
    lastPgn = nextState.pgn || '';
    clockReceivedAt = Date.now();
	    state = nextState;
	    selected = null;
	    legalTargets.clear();
	    renderPanel();
	    renderBoard();
	    startClockTimer();
	    maybeShowResult(nextState);
	  });
  socket.on('leaderboard', renderLeaderboard);
  socket.on('queueSize', (size) => {
    queueText.textContent = size + (size === 1 ? ' player' : ' players');
  });
  socket.on('matchmaking', ({ queued }) => {
    gameText.textContent = queued ? 'Mencari lawan...' : 'Queue dibatalkan';
    matchOverlay.classList.toggle('hidden', !queued);
  });
  socket.on('invalidMove', () => {
    selected = null;
    legalTargets.clear();
    renderBoard();
  });
}

function showAuth() {
  authView.classList.remove('hidden');
  gameView.classList.add('hidden');
  resultOverlay.classList.add('hidden');
  showLogin();
}

function showGame() {
  authView.classList.add('hidden');
  gameView.classList.remove('hidden');
  registerForm.classList.add('hidden');
  authForm.classList.remove('hidden');
}

function logout() {
  sessionStorage.removeItem(tokenStorageKey);
  localStorage.removeItem(tokenStorageKey);
  token = '';
  me = null;
	  state = null;
	  lastResultKey = '';
	  lastPgn = '';
	  stopClockTimer();
  if (socket) socket.disconnect();
  socket = null;
  showAuth();
  roleBadge.textContent = 'Offline';
  profileName.textContent = '-';
	  profileElo.textContent = '-';
	  gameText.textContent = 'Login dulu';
	  turnText.textContent = '-';
	  lastMoveText.textContent = '-';
	  whiteClock.textContent = '10:00';
	  blackClock.textContent = '10:00';
	  whiteCard.classList.remove('activeClock', 'lowClock');
	  blackCard.classList.remove('activeClock', 'lowClock');
	  boardEl.innerHTML = '';
	  matchOverlay.classList.add('hidden');
	}

function renderProfile() {
  if (!me) return;
  profileName.innerHTML = playerBadge(me);
  profileElo.textContent = me.elo;
}

function rankTier(player) {
  const elo = player?.elo || 0;
  if (elo >= 1800) return { icon: '♛', title: 'Raja Arena', className: 'rankSovereign' };
  if (elo >= 1600) return { icon: '✦', title: 'Samurai Mat', className: 'rankSamurai' };
  if (elo >= 1400) return { icon: '♜', title: 'Benteng Elite', className: 'rankElite' };
  if (elo >= 1200) return { icon: '♞', title: 'Ksatria Taktik', className: 'rankKnight' };
  if (elo >= 1050) return { icon: '◆', title: 'Prajurit Naik', className: 'rankRising' };
  return { icon: '♟', title: 'Pion Rookie', className: 'rankRookie' };
}

function leaderboardMark(index) {
  if (index === 0) return { icon: '♛', label: 'Top 1', className: 'leaderOne' };
  if (index === 1) return { icon: '◆', label: 'Top 2', className: 'leaderTwo' };
  if (index === 2) return { icon: '✦', label: 'Top 3', className: 'leaderThree' };
  if (index < 10) return { icon: '♜', label: '#' + (index + 1), className: 'leaderTop' };
  return { icon: '♞', label: '#' + (index + 1), className: 'leaderBase' };
}

function playerBadge(player) {
  const tier = rankTier(player);
  return '<span class="rankName ' + tier.className + '"><span class="rankLogo">' + tier.icon + '</span><span><span class="countryFlag">' + countryFlag(player?.country) + '</span>' + player.username + '</span><small>' + tier.title + '</small></span>';
}

function squareName(row, col) {
  return ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'][col] + (8 - row);
}

function orientedBoard(board) {
  if (myColor !== 'b') return board;
  return [...board].reverse().map((row) => [...row].reverse());
}

function orientedSquare(row, col) {
  if (myColor !== 'b') return squareName(row, col);
  return squareName(7 - row, 7 - col);
}

function renderBoard() {
  boardEl.innerHTML = '';
  if (!state) return;
  boardEl.classList.toggle('whiteTurn', state.turn === 'w' && !state.result);
  boardEl.classList.toggle('blackTurn', state.turn === 'b' && !state.result);

  orientedBoard(state.board).forEach((row, rowIndex) => {
    row.forEach((piece, colIndex) => {
      const square = document.createElement('button');
      const name = orientedSquare(rowIndex, colIndex);
      square.type = 'button';
      square.dataset.square = name;
      square.className = 'square ' + ((rowIndex + colIndex) % 2 === 0 ? 'light' : 'dark');
	      if (selected === name) square.classList.add('selected');
	      if (legalTargets.has(name)) square.classList.add('legal');
	      if (state.lastMove?.from === name) square.classList.add('lastMove', 'lastMoveFrom');
	      if (state.lastMove?.to === name) square.classList.add('lastMove', 'lastMoveTo');
      if (piece && !state.result && piece.color === state.turn) square.classList.add('turnPiece');

      if (piece) {
        const pieceEl = document.createElement('span');
        pieceEl.className = 'piece ' + (piece.color === 'w' ? 'white' : 'black');
        if (piece.color === myColor && state.turn === myColor && !state.isGameOver) {
          pieceEl.classList.add('draggablePiece');
        }
        pieceEl.textContent = pieces[piece.color + piece.type];
        square.append(pieceEl);
      }

      square.addEventListener('click', () => handleSquare(name, piece));
      square.addEventListener('pointerdown', (event) => startPieceDrag(event, name, piece));
      boardEl.append(square);
    });
  });
}

function handleSquare(name, piece) {
  if (suppressNextClick) {
    suppressNextClick = false;
    return;
  }
  initAudio();
  if (!state || state.isGameOver || myColor === 'spectator') return;
  if (state.turn !== myColor) return;

  if (selected && legalTargets.has(name)) {
    attemptMove(selected, name);
    return;
  }

  if (piece && piece.color === myColor) {
    selected = name;
    legalTargets = legalMovesFrom(name);
  } else {
    selected = null;
    legalTargets.clear();
  }
  renderBoard();
}

function attemptMove(from, to) {
  const promotions = promotionChoicesFor(from, to);
  if (promotions.length > 0) {
    pendingPromotion = { from, to };
    showPromotionChoices(promotions);
    return;
  }
  socket.emit('move', { from, to });
  selected = null;
  legalTargets.clear();
  renderBoard();
}

function startPieceDrag(event, from, piece) {
  if (!state || state.isGameOver || myColor === 'spectator') return;
  if (state.turn !== myColor || !piece || piece.color !== myColor) return;
  if (event.button !== undefined && event.button !== 0) return;

  initAudio();
  selected = from;
  legalTargets = legalMovesFrom(from);
  renderBoard();

  const sourceSquare = boardEl.querySelector('[data-square="' + from + '"]');
  const pieceEl = sourceSquare?.querySelector('.piece');
  if (!sourceSquare || !pieceEl) return;

  const ghost = pieceEl.cloneNode(true);
  ghost.classList.add('dragGhost');
  document.body.append(ghost);

  dragState = {
    from,
    ghost,
    startX: event.clientX,
    startY: event.clientY,
    moved: false,
  };
  sourceSquare.classList.add('dragSource');
  moveDragGhost(event.clientX, event.clientY);
  event.preventDefault();
  window.addEventListener('pointermove', movePieceDrag);
  window.addEventListener('pointerup', endPieceDrag, { once: true });
}

function moveDragGhost(x, y) {
  if (!dragState) return;
  dragState.ghost.style.left = x + 'px';
  dragState.ghost.style.top = y + 'px';
}

function movePieceDrag(event) {
  if (!dragState) return;
  const distance = Math.hypot(event.clientX - dragState.startX, event.clientY - dragState.startY);
  if (distance > 4) dragState.moved = true;
  moveDragGhost(event.clientX, event.clientY);
}

function endPieceDrag(event) {
  if (!dragState) return;
  window.removeEventListener('pointermove', movePieceDrag);
  const { from, ghost, moved } = dragState;
  ghost.remove();
  boardEl.querySelectorAll('.dragSource').forEach((square) => square.classList.remove('dragSource'));
  dragState = null;

  if (!moved) return;
  suppressNextClick = true;

  const target = document.elementFromPoint(event.clientX, event.clientY)?.closest('.square');
  const to = target?.dataset.square;
  if (to && legalTargets.has(to)) {
    attemptMove(from, to);
    return;
  }

  selected = null;
  legalTargets.clear();
  renderBoard();
}

function legalMovesFrom(from) {
  const targets = new Set();
  for (const move of state.legalMoves || []) {
    if (move.from === from) targets.add(move.to);
  }
  return targets;
}

function promotionChoicesFor(from, to) {
  return (state.legalMoves || [])
    .filter((move) => move.from === from && move.to === to && move.promotion)
    .map((move) => move.promotion);
}

function showPromotionChoices(choices) {
  promotionOverlay.classList.remove('hidden');
  document.querySelectorAll('.promotionChoices button').forEach((button) => {
    button.hidden = !choices.includes(button.dataset.piece);
  });
}

function choosePromotion(piece) {
  if (!pendingPromotion) return;
  socket.emit('move', { ...pendingPromotion, promotion: piece });
  pendingPromotion = null;
  selected = null;
  legalTargets.clear();
  promotionOverlay.classList.add('hidden');
  renderBoard();
}

function renderPanel() {
	  if (!state) return;
	  roomLabel.textContent = state.id;
	  const turnName = state.turn === 'w' ? 'Putih' : 'Hitam';
	  turnText.textContent = state.result ? '-' : turnName + ' jalan';
	  lastMoveText.textContent = state.lastMove ? state.lastMove.san + ' (' + state.lastMove.from + '-' + state.lastMove.to + ')' : '-';
	
	  whiteName.innerHTML = playerBadge(state.players.w);
	  blackName.innerHTML = playerBadge(state.players.b);
	  whiteScore.textContent = playerMeta(state.players.w);
	  blackScore.textContent = playerMeta(state.players.b);
	  renderCapturedPieces();
	  renderClocks();
	
	  if (state.result) {
	    gameText.textContent = state.result.text;
    if (state.result.players) {
      if (me && state.result.players.w.id === me.id) me = state.result.players.w;
      if (me && state.result.players.b.id === me.id) me = state.result.players.b;
      renderProfile();
    }
	  } else if (state.isCheck) {
	    gameText.textContent = 'Check - ' + turnName + ' harus jalan';
	  } else {
	    gameText.textContent = turnName + ' jalan';
	  }

  moveList.innerHTML = '';
  for (const token of state.history || []) {
    const li = document.createElement('li');
    li.textContent = token;
    moveList.append(li);
  }
  renderChat();
  renderRematch();
}

function renderChat() {
  chatStatus.textContent = state?.id || 'no match';
  chatList.innerHTML = '';
  for (const message of state?.chat || []) {
    const row = document.createElement('div');
    row.className = 'chatMessage ' + (message.userId === me?.id ? 'mine' : 'theirs');
    const name = document.createElement('strong');
    name.textContent = countryFlag(message.country) + ' ' + (message.color === 'w' ? 'Putih' : message.color === 'b' ? 'Hitam' : 'Player') + ' - ' + message.username + ' / ' + countryName(message.country);
    const text = document.createElement('p');
    text.textContent = message.text;
    row.append(name, text);
    chatList.append(row);
  }
  chatList.scrollTop = chatList.scrollHeight;
}

function playerMeta(player) {
  return countryFlag(player?.country) + ' ' + countryName(player?.country) + ' - ' + player.elo + ' ELO';
}

function countryFlag(code) {
  return countries[code]?.flag || '🌐';
}

function countryName(code) {
  return countries[code]?.name || 'Unknown';
}

function renderCapturedPieces() {
  renderCapturedFor(whiteCaptured, 'w');
  renderCapturedFor(blackCaptured, 'b');
}

function renderCapturedFor(element, color) {
  const captured = state?.captured?.[color] || [];
  element.classList.toggle('empty', captured.length === 0);
  if (captured.length === 0) {
    element.textContent = 'Belum makan bidak';
    return;
  }
  const enemyColor = color === 'w' ? 'b' : 'w';
  element.textContent = captured.map((piece) => capturedSymbols[enemyColor][piece] || '').join(' ');
}

function renderRematch() {
  const show = Boolean(state?.result && myColor !== 'spectator');
  rematchBox.classList.toggle('hidden', !show);
  if (!show) {
    rematchText.textContent = 'Tunggu game selesai';
    rematchBtn.disabled = false;
    return;
  }
  const requested = state.rematchRequests || [];
  const mine = requested.includes(me?.id);
  rematchBtn.disabled = mine;
  if (mine && requested.length < 2) {
    rematchText.textContent = 'Menunggu lawan accept rematch';
  } else if (requested.length > 0) {
    rematchText.textContent = requested.length + '/2 player siap rematch';
  } else {
    rematchText.textContent = 'Ajak lawan main ulang';
  }
}

function formatClock(ms) {
	  const safeMs = Math.max(0, Math.ceil(ms || 0));
	  const totalSeconds = Math.ceil(safeMs / 1000);
	  const minutes = Math.floor(totalSeconds / 60);
	  const seconds = totalSeconds % 60;
	  return String(minutes) + ':' + String(seconds).padStart(2, '0');
	}

function visibleClocks() {
	  if (!state?.clocks) return { w: 10 * 60 * 1000, b: 10 * 60 * 1000 };
	  const clocks = { ...state.clocks };
	  if (!state.result && !state.isGameOver && clockReceivedAt) {
	    const elapsed = Date.now() - clockReceivedAt;
	    clocks[state.turn] = Math.max(0, clocks[state.turn] - elapsed);
	  }
	  return clocks;
	}

function renderClocks() {
	  const clocks = visibleClocks();
	  whiteClock.textContent = formatClock(clocks.w);
	  blackClock.textContent = formatClock(clocks.b);
	  whiteCard.classList.toggle('activeClock', Boolean(state && !state.result && state.turn === 'w'));
	  blackCard.classList.toggle('activeClock', Boolean(state && !state.result && state.turn === 'b'));
	  whiteCard.classList.toggle('lowClock', clocks.w <= 30 * 1000);
	  blackCard.classList.toggle('lowClock', clocks.b <= 30 * 1000);
	}

function startClockTimer() {
	  if (clockTimer) return;
	  clockTimer = setInterval(() => {
	    if (!state) return;
	    renderClocks();
	  }, 250);
	}

function stopClockTimer() {
	  if (!clockTimer) return;
	  clearInterval(clockTimer);
	  clockTimer = null;
		}

function renderLeaderboard(players) {
  leaderboardList.innerHTML = '';
  for (const [index, player] of players.slice(0, 5).entries()) {
    const mark = leaderboardMark(index);
    const tier = rankTier(player);
    const li = document.createElement('li');
    li.className = mark.className;
    li.innerHTML = '<div class="leaderMain"><span class="leaderLogo">' + mark.icon + '</span><div><strong>' + player.username + '</strong><span>' + mark.label + ' - ' + tier.title + '</span></div></div><b>' + player.elo + ' ELO</b><span>' + player.wins + 'W ' + player.losses + 'L ' + player.draws + 'D</span>';
    leaderboardList.append(li);
  }
}

function maybeShowResult(nextState) {
  if (!nextState.result) return;
  const key = nextState.id + ':' + nextState.result.type + ':' + nextState.result.winner;
  if (key === lastResultKey) return;
  lastResultKey = key;

  const mySide = nextState.players.w.id === me?.id ? 'w' : nextState.players.b.id === me?.id ? 'b' : null;
  const didWin = nextState.result.winner && nextState.result.winner === mySide;
  const didLose = nextState.result.winner && nextState.result.winner !== mySide;

  resultOverlay.classList.remove('victory', 'defeat', 'draw', 'hidden', 'play');
  resultOverlay.classList.add(didWin ? 'victory' : didLose ? 'defeat' : 'draw');
  resultOverlay.classList.remove('winner-white', 'winner-black', 'loser-white', 'loser-black');

  const winner = nextState.result.winner;
  const loser = winner === 'w' ? 'b' : winner === 'b' ? 'w' : null;
  if (winner && loser) {
    resultOverlay.classList.add(winner === 'w' ? 'winner-white' : 'winner-black');
    resultOverlay.classList.add(loser === 'w' ? 'loser-white' : 'loser-black');
    duelStage.classList.remove('hidden');
    loserKing.textContent = loser === 'w' ? '♔' : '♚';
    bladePiece.textContent = winner === 'w' ? '♕' : '♛';
  } else {
    duelStage.classList.add('hidden');
  }

  resultKicker.textContent = nextState.result.type === 'checkmate' ? 'Checkmate' : 'Game Over';
  resultTitle.textContent = didWin ? 'Menang' : didLose ? 'Kalah' : 'Seri';
  resultText.textContent = nextState.result.text;
  requestAnimationFrame(() => {
    resultOverlay.classList.add('play');
    if (winner && loser) playVictorySound();
  });
}

function initAudio() {
  if (!audioContext) {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (audioContext.state === 'suspended') audioContext.resume();
  return audioContext;
}

function playMoveSound() {
  const ctx = initAudio();
  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  const filter = ctx.createBiquadFilter();

  osc.type = 'triangle';
  osc.frequency.setValueAtTime(180, now);
  osc.frequency.exponentialRampToValueAtTime(92, now + 0.08);
  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(900, now);

  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.16, now + 0.008);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.12);

  osc.connect(filter);
  filter.connect(gain);
  gain.connect(ctx.destination);
  osc.start(now);
  osc.stop(now + 0.13);
}

function playSlashSound() {
  const ctx = initAudio();
  const now = ctx.currentTime;
  const duration = 0.74;
  const samples = Math.floor(ctx.sampleRate * duration);
  const buffer = ctx.createBuffer(1, samples, ctx.sampleRate);
  const data = buffer.getChannelData(0);

  for (let i = 0; i < samples; i++) {
    const t = i / samples;
    const attack = Math.min(1, t / 0.025);
    const decay = Math.pow(1 - t, 4.2);
    data[i] = (Math.random() * 2 - 1) * attack * decay;
  }

  const noise = ctx.createBufferSource();
  const highpass = ctx.createBiquadFilter();
  const sweep = ctx.createBiquadFilter();
  const gain = ctx.createGain();
  const ring = ctx.createOscillator();
  const ringGain = ctx.createGain();
  const clang = ctx.createOscillator();
  const clangGain = ctx.createGain();

  noise.buffer = buffer;
  highpass.type = 'highpass';
  highpass.frequency.setValueAtTime(1800, now);
  sweep.type = 'bandpass';
  sweep.Q.setValueAtTime(14, now);
  sweep.frequency.setValueAtTime(7800, now);
  sweep.frequency.exponentialRampToValueAtTime(1100, now + 0.34);

  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.7, now + 0.018);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.38);

  ring.type = 'sine';
  ring.frequency.setValueAtTime(2400, now + 0.02);
  ring.frequency.exponentialRampToValueAtTime(680, now + 0.3);
  ringGain.gain.setValueAtTime(0.0001, now);
  ringGain.gain.exponentialRampToValueAtTime(0.32, now + 0.035);
  ringGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.36);

  clang.type = 'triangle';
  clang.frequency.setValueAtTime(1760, now + 0.11);
  clang.frequency.exponentialRampToValueAtTime(980, now + 0.5);
  clangGain.gain.setValueAtTime(0.0001, now + 0.1);
  clangGain.gain.exponentialRampToValueAtTime(0.42, now + 0.13);
  clangGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.62);

  noise.connect(highpass);
  highpass.connect(sweep);
  sweep.connect(gain);
  gain.connect(ctx.destination);
  ring.connect(ringGain);
  ringGain.connect(ctx.destination);
  clang.connect(clangGain);
  clangGain.connect(ctx.destination);

  noise.start(now);
  noise.stop(now + duration);
  ring.start(now);
  ring.stop(now + 0.46);
  clang.start(now + 0.16);
  clang.stop(now + 0.64);
}

function playVictorySound() {
  const audio = new Audio(victorySoundUrl);
  audio.volume = 1;
  audio.currentTime = 0;
  audio.play().catch(() => playSlashSound());
}

function playCheckSound() {
  if ('speechSynthesis' in window) window.speechSynthesis.cancel();
  const audio = new Audio(checkSoundUrl);
  audio.volume = 1;
  audio.currentTime = 0;
  audio.play().catch(playCheckTone);
}

function playCheckTone() {
  const ctx = initAudio();
  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(520, now);
  osc.frequency.setValueAtTime(620, now + 0.12);
  osc.frequency.setValueAtTime(520, now + 0.24);
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.18, now + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.34);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(now);
  osc.stop(now + 0.36);
}

authForm.addEventListener('submit', (event) => {
  event.preventDefault();
  initAudio();
  login();
});

registerForm.addEventListener('submit', (event) => {
  event.preventDefault();
  initAudio();
  registerAccount();
});
showRegisterBtn.addEventListener('click', showRegister);
showLoginBtn.addEventListener('click', showLogin);
logoutBtn.addEventListener('click', logout);
findMatchBtn.addEventListener('click', () => {
  initAudio();
  if (socket) socket.emit('findMatch');
});
cancelMatchBtn.addEventListener('click', () => socket && socket.emit('cancelMatch'));
overlayCancelBtn.addEventListener('click', () => socket && socket.emit('cancelMatch'));
resignBtn.addEventListener('click', () => {
  initAudio();
  if (socket) socket.emit('resign');
});
rematchBtn.addEventListener('click', () => {
  initAudio();
  if (socket) socket.emit('rematch');
});
chatForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const message = chatInput.value.trim();
  if (!message || !socket) return;
  socket.emit('chatMessage', message);
  chatInput.value = '';
});
resultCloseBtn.addEventListener('click', () => resultOverlay.classList.add('hidden'));
document.querySelectorAll('.promotionChoices button').forEach((button) => {
  button.addEventListener('click', () => choosePromotion(button.dataset.piece));
});

if (token) {
  api('/api/me')
    .then((data) => {
      me = data.user;
      connect();
    })
    .catch(logout);
} else {
  logout();
}
