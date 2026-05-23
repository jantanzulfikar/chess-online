const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { Chess } = require('chess.js');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3030;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const START_ELO = 1000;
const K_FACTOR = 32;
const TIME_CONTROL_MS = 10 * 60 * 1000;
const COUNTRIES = new Set(['ID', 'MY', 'SG', 'PH', 'TH', 'VN', 'US', 'JP', 'KR', 'CN', 'IN', 'BR', 'GB', 'DE', 'FR', 'AU']);
const BOT_LEVELS = new Set(['easy', 'medium', 'hard']);
const PIECE_VALUES = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 };
const CENTER_SQUARES = new Set(['d4', 'e4', 'd5', 'e5']);
const NEAR_CENTER_SQUARES = new Set(['c3', 'd3', 'e3', 'f3', 'c4', 'f4', 'c5', 'f5', 'c6', 'd6', 'e6', 'f6']);

const rooms = new Map();
const queue = [];
const socketsByUser = new Map();

app.use(express.json());
app.use(express.static('public'));

function defaultDb() {
  return { users: {}, tokens: {} };
}

function loadDb() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, JSON.stringify(defaultDb(), null, 2));
  }
  return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
}

let db = loadDb();

function saveDb() {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

function publicUser(user) {
  return {
    id: user.id,
    username: user.username,
    country: user.country || 'Unknown',
    elo: user.elo,
    wins: user.wins,
    losses: user.losses,
    draws: user.draws,
    games: user.games,
  };
}

function normalizeUsername(username) {
  return String(username || '').trim().toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 18);
}

function normalizeCountry(country) {
  const code = String(country || '').trim().toUpperCase();
  return COUNTRIES.has(code) ? code : 'ID';
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.pbkdf2Sync(String(password), salt, 120000, 32, 'sha256').toString('hex');
  return { salt, hash };
}

function verifyPassword(password, user) {
  const candidate = hashPassword(password, user.salt).hash;
  return crypto.timingSafeEqual(Buffer.from(candidate, 'hex'), Buffer.from(user.passwordHash, 'hex'));
}

function tokenFor(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  db.tokens[token] = userId;
  saveDb();
  return token;
}

function userByToken(token) {
  const userId = db.tokens[String(token || '')];
  return userId ? db.users[userId] : null;
}

function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  const user = userByToken(token);
  if (!user) return res.status(401).json({ error: 'Login dulu' });
  req.user = user;
  next();
}

app.post('/api/register', (req, res) => {
  const username = normalizeUsername(req.body.username);
  const country = normalizeCountry(req.body.country);
  const password = String(req.body.password || '');

  if (username.length < 3) return res.status(400).json({ error: 'Username minimal 3 karakter' });
  if (password.length < 6) return res.status(400).json({ error: 'Password minimal 6 karakter' });
  if (Object.values(db.users).some((user) => user.username === username)) {
    return res.status(409).json({ error: 'Username sudah dipakai' });
  }

  const id = crypto.randomUUID();
  const { salt, hash } = hashPassword(password);
  db.users[id] = {
    id,
    username,
    country,
    salt,
    passwordHash: hash,
    elo: START_ELO,
    wins: 0,
    losses: 0,
    draws: 0,
    games: 0,
    createdAt: new Date().toISOString(),
  };
  const token = tokenFor(id);
  saveDb();
  res.json({ token, user: publicUser(db.users[id]) });
});

app.post('/api/login', (req, res) => {
  const username = normalizeUsername(req.body.username);
  const password = String(req.body.password || '');
  const user = Object.values(db.users).find((entry) => entry.username === username);
  if (!user || !verifyPassword(password, user)) return res.status(401).json({ error: 'Username atau password salah' });
  res.json({ token: tokenFor(user.id), user: publicUser(user) });
});

app.get('/api/me', requireAuth, (req, res) => {
  res.json({ user: publicUser(req.user) });
});

app.get('/api/leaderboard', (req, res) => {
  const players = Object.values(db.users)
    .map(publicUser)
    .sort((a, b) => b.elo - a.elo || b.wins - a.wins || a.username.localeCompare(b.username))
    .slice(0, 50);
  res.json({ players });
});

function expectedScore(a, b) {
  return 1 / (1 + Math.pow(10, (b - a) / 400));
}

function applyRating(whiteUser, blackUser, result) {
  const whiteExpected = expectedScore(whiteUser.elo, blackUser.elo);
  const blackExpected = expectedScore(blackUser.elo, whiteUser.elo);
  const whiteScore = result === 'w' ? 1 : result === 'b' ? 0 : 0.5;
  const blackScore = 1 - whiteScore;

  whiteUser.elo = Math.max(100, Math.round(whiteUser.elo + K_FACTOR * (whiteScore - whiteExpected)));
  blackUser.elo = Math.max(100, Math.round(blackUser.elo + K_FACTOR * (blackScore - blackExpected)));
  whiteUser.games += 1;
  blackUser.games += 1;

  if (result === 'w') {
    whiteUser.wins += 1;
    blackUser.losses += 1;
  } else if (result === 'b') {
    blackUser.wins += 1;
    whiteUser.losses += 1;
  } else {
    whiteUser.draws += 1;
    blackUser.draws += 1;
  }
  saveDb();
}

function createRoom(whiteSocket, blackSocket) {
  const id = 'match-' + crypto.randomUUID().slice(0, 8);
  const room = {
    id,
    game: new Chess(),
    players: {
      w: whiteSocket.id,
      b: blackSocket.id,
    },
    userIds: {
      w: whiteSocket.data.user.id,
      b: blackSocket.data.user.id,
    },
	    lastResult: null,
	    rated: false,
	    clocks: {
	      w: TIME_CONTROL_MS,
	      b: TIME_CONTROL_MS,
	    },
	    chat: [],
	    rematchRequests: [],
	    lastTickAt: Date.now(),
	    createdAt: Date.now(),
	  };
  rooms.set(id, room);

  for (const [color, socket] of [['w', whiteSocket], ['b', blackSocket]]) {
    leaveMatch(socket);
    socket.join(id);
    socket.data.roomId = id;
    socket.data.color = color;
    socket.emit('role', { color, roomId: id });
  }
  emitRoom(room);
}

function botProfile(level) {
  const names = {
    easy: ['Bot EZ', 850],
    medium: ['Bot Medium', 1150],
    hard: ['Bot Hard', 1450],
  };
  const [username, elo] = names[level] || names.easy;
  return {
    id: 'bot-' + level,
    username,
    country: 'JP',
    elo,
    wins: 0,
    losses: 0,
    draws: 0,
    games: 0,
  };
}

function createBotRoom(socket, level) {
  const safeLevel = BOT_LEVELS.has(level) ? level : 'easy';
  const id = 'bot-' + crypto.randomUUID().slice(0, 8);
  const room = {
    id,
    game: new Chess(),
    players: {
      w: socket.id,
      b: 'bot:' + safeLevel,
    },
    userIds: {
      w: socket.data.user.id,
      b: 'bot-' + safeLevel,
    },
    bot: {
      color: 'b',
      level: safeLevel,
      profile: botProfile(safeLevel),
    },
    lastResult: null,
    rated: false,
    clocks: {
      w: TIME_CONTROL_MS,
      b: TIME_CONTROL_MS,
    },
    chat: [{
      id: crypto.randomUUID().slice(0, 8),
      userId: 'bot-' + safeLevel,
      username: botProfile(safeLevel).username,
      country: 'JP',
      color: 'b',
      text: 'Siap. Pilih langkah terbaikmu.',
      createdAt: Date.now(),
    }],
    rematchRequests: [],
    lastTickAt: Date.now(),
    createdAt: Date.now(),
  };
  rooms.set(id, room);
  leaveMatch(socket);
  removeFromQueue(socket);
  socket.join(id);
  socket.data.roomId = id;
  socket.data.color = 'w';
  socket.emit('role', { color: 'w', roomId: id });
  emitRoom(room);
}

function publicRoom(room) {
	  const now = Date.now();
	  const white = participantUser(room, 'w');
	  const black = participantUser(room, 'b');
	  const clocks = currentClocks(room, now);
	  const history = room.game.history({ verbose: true });
	  const lastMove = history.at(-1) || null;
	  const captured = capturedPieces(history);
	  return {
	    id: room.id,
	    turn: room.game.turn(),
	    board: room.game.board(),
	    pgn: room.game.pgn(),
	    history: history.map((move) => move.san),
	    lastMove: lastMove ? {
	      from: lastMove.from,
	      to: lastMove.to,
	      san: lastMove.san,
	      color: lastMove.color,
	    } : null,
	    legalMoves: room.game.moves({ verbose: true }).map((move) => ({
	      from: move.from,
	      to: move.to,
      promotion: move.promotion || null,
	    })),
	    isCheck: room.game.inCheck(),
	    isGameOver: room.game.isGameOver() || Boolean(room.lastResult),
	    result: room.lastResult,
	    chat: room.chat || [],
	    rematchRequests: room.rematchRequests || [],
	    captured,
	    clocks,
	    clockUpdatedAt: now,
	    timeControlMs: TIME_CONTROL_MS,
	    players: {
	      w: publicUser(white),
	      b: publicUser(black),
    },
	  };
	}

function participantUser(room, color) {
  if (room.bot?.color === color) return room.bot.profile;
  return db.users[room.userIds[color]];
}

function capturedPieces(history) {
  const captured = { w: [], b: [] };
  for (const move of history) {
    if (!move.captured) continue;
    captured[move.color].push(move.captured);
  }
  return captured;
}

function currentClocks(room, now = Date.now()) {
	  const clocks = { ...room.clocks };
	  if (!room.lastResult && !room.game.isGameOver()) {
	    const active = room.game.turn();
	    clocks[active] = Math.max(0, clocks[active] - (now - room.lastTickAt));
	  }
	  return clocks;
	}

function updateClock(room, now = Date.now()) {
	  if (room.lastResult || room.game.isGameOver()) return false;
	  const active = room.game.turn();
	  room.clocks[active] = Math.max(0, room.clocks[active] - (now - room.lastTickAt));
	  room.lastTickAt = now;
	  if (room.clocks[active] > 0) return false;
	
	  const winner = active === 'w' ? 'b' : 'w';
	  room.lastResult = {
	    type: 'timeout',
	    winner,
	    text: (winner === 'w' ? 'Putih' : 'Hitam') + ' menang karena waktu lawan habis',
	  };
	  finalizeRoom(room);
	  return true;
	}

function resultFor(room) {
  const game = room.game;
  if (!game.isGameOver()) return null;

  if (game.isCheckmate()) {
    const loser = game.turn();
    const winner = loser === 'w' ? 'b' : 'w';
    return {
      type: 'checkmate',
      winner,
      text: (winner === 'w' ? 'Putih' : 'Hitam') + ' menang checkmate',
    };
  }

  if (game.isDraw()) return { type: 'draw', winner: null, text: 'Seri' };
  if (game.isStalemate()) return { type: 'stalemate', winner: null, text: 'Stalemate' };
  if (game.isThreefoldRepetition()) return { type: 'repetition', winner: null, text: 'Seri karena repetisi' };
  if (game.isInsufficientMaterial()) return { type: 'material', winner: null, text: 'Seri karena material kurang' };
  return { type: 'over', winner: null, text: 'Game selesai' };
}

function socketForUser(userId) {
  const socketId = socketsByUser.get(userId);
  return socketId ? io.sockets.sockets.get(socketId) : null;
}

function startRematch(room) {
  if (room.bot) {
    const humanColor = room.bot.color === 'w' ? 'b' : 'w';
    const humanSocket = socketForUser(room.userIds[humanColor]);
    if (!humanSocket) return false;
    createBotRoom(humanSocket, room.bot.level);
    return true;
  }
  const whiteSocket = socketForUser(room.userIds.w);
  const blackSocket = socketForUser(room.userIds.b);
  if (!whiteSocket || !blackSocket) return false;
  createRoom(blackSocket, whiteSocket);
  return true;
}

function finalizeRoom(room) {
  if (!room.lastResult || room.rated) return;
  if (room.bot) {
    room.rated = true;
    room.lastResult.players = {
      w: publicUser(participantUser(room, 'w')),
      b: publicUser(participantUser(room, 'b')),
    };
    return;
  }
  const white = db.users[room.userIds.w];
  const black = db.users[room.userIds.b];
  if (!white || !black) return;
  applyRating(white, black, room.lastResult.winner);
  room.rated = true;
  room.lastResult.players = {
    w: publicUser(white),
    b: publicUser(black),
  };
}

function emitRoom(room) {
  io.to(room.id).emit('state', publicRoom(room));
  io.emit('leaderboard', leaderboardPayload());
}

function emitOnlineCount() {
  const onlineUsers = new Set();
  for (const socket of io.sockets.sockets.values()) {
    if (socket.data.user?.id) onlineUsers.add(socket.data.user.id);
  }
  io.emit('onlineCount', onlineUsers.size);
}

function leaderboardPayload() {
  return Object.values(db.users)
    .map(publicUser)
    .sort((a, b) => b.elo - a.elo || b.wins - a.wins || a.username.localeCompare(b.username))
    .slice(0, 5);
}

function leaveMatch(socket) {
  if (!socket.data.roomId) return;
  const room = rooms.get(socket.data.roomId);
  if (room) socket.leave(room.id);
  if (room?.bot && room.userIds[socket.data.color] === socket.data.user?.id && !room.lastResult) {
    rooms.delete(room.id);
  }
  socket.data.roomId = null;
  socket.data.color = 'spectator';
}

function removeFromQueue(socket) {
  for (let index = queue.length - 1; index >= 0; index--) {
    if (queue[index] === socket.id) queue.splice(index, 1);
  }
}

function cleanQueue() {
  for (let index = queue.length - 1; index >= 0; index--) {
    const queued = io.sockets.sockets.get(queue[index]);
    if (!queued || !queued.data.user || queued.data.roomId) queue.splice(index, 1);
  }
}

function queueSocket(socket) {
  removeFromQueue(socket);
  cleanQueue();

  const opponentIndex = queue.findIndex((socketId) => {
    const opponent = io.sockets.sockets.get(socketId);
    return opponent && opponent.data.user && opponent.data.user.id !== socket.data.user.id;
  });

  if (opponentIndex === -1) {
    queue.push(socket.id);
    socket.emit('matchmaking', { queued: true });
    io.emit('queueSize', queue.length);
    return;
  }

  const opponentId = queue.splice(opponentIndex, 1)[0];
  const opponent = io.sockets.sockets.get(opponentId);
  if (!opponent) return queueSocket(socket);

  const socketWhite = Math.random() >= 0.5;
  createRoom(socketWhite ? socket : opponent, socketWhite ? opponent : socket);
  socket.emit('matchmaking', { queued: false });
  opponent.emit('matchmaking', { queued: false });
  io.emit('queueSize', queue.length);
}

function chooseBotMove(room) {
  const moves = room.game.moves({ verbose: true });
  if (moves.length === 0) return null;
  if (room.bot.level === 'easy') return chooseEasyMove(room, moves);
  const botColor = room.bot.color;
  const depth = room.bot.level === 'hard' ? 3 : 2;
  let bestScore = -Infinity;
  let bestMoves = [];
  for (const move of moves) {
    const game = new Chess(room.game.fen());
    game.move({ from: move.from, to: move.to, promotion: move.promotion || 'q' });
    const score = minimax(game, depth - 1, -Infinity, Infinity, botColor);
    if (score > bestScore) {
      bestScore = score;
      bestMoves = [move];
    } else if (score === bestScore) {
      bestMoves.push(move);
    }
  }
  return randomItem(bestMoves.slice(0, Math.max(1, Math.min(bestMoves.length, 3))));
}

function chooseEasyMove(room, moves) {
  const tactical = moves.filter((move) => move.captured || move.san.includes('+'));
  if (tactical.length && Math.random() < 0.45) return randomItem(tactical);
  return randomItem(moves);
}

function minimax(game, depth, alpha, beta, botColor) {
  if (depth === 0 || game.isGameOver()) return evaluateGameFor(game, botColor);
  const maximizing = game.turn() === botColor;
  const moves = orderMoves(game.moves({ verbose: true }));
  if (maximizing) {
    let value = -Infinity;
    for (const move of moves) {
      const next = new Chess(game.fen());
      next.move({ from: move.from, to: move.to, promotion: move.promotion || 'q' });
      value = Math.max(value, minimax(next, depth - 1, alpha, beta, botColor));
      alpha = Math.max(alpha, value);
      if (beta <= alpha) break;
    }
    return value;
  }

  let value = Infinity;
  for (const move of moves) {
    const next = new Chess(game.fen());
    next.move({ from: move.from, to: move.to, promotion: move.promotion || 'q' });
    value = Math.min(value, minimax(next, depth - 1, alpha, beta, botColor));
    beta = Math.min(beta, value);
    if (beta <= alpha) break;
  }
  return value;
}

function orderMoves(moves) {
  return [...moves].sort((a, b) => movePriority(b) - movePriority(a));
}

function movePriority(move) {
  let score = 0;
  if (move.san.includes('#')) score += 100000;
  if (move.san.includes('+')) score += 900;
  if (move.captured) score += (PIECE_VALUES[move.captured] || 0) * 3 - (PIECE_VALUES[move.piece] || 0);
  if (move.promotion) score += PIECE_VALUES[move.promotion] || 0;
  if (CENTER_SQUARES.has(move.to)) score += 45;
  if (NEAR_CENTER_SQUARES.has(move.to)) score += 20;
  return score;
}

function evaluateGameFor(game, color) {
  if (game.isCheckmate()) return game.turn() === color ? -100000 : 100000;
  if (game.isDraw()) return 0;
  let score = 0;
  for (const row of game.board()) {
    for (const piece of row) {
      if (!piece) continue;
      const value = PIECE_VALUES[piece.type] || 0;
      const square = piece.square || '';
      let positional = 0;
      if (CENTER_SQUARES.has(square)) positional += 18;
      if (NEAR_CENTER_SQUARES.has(square)) positional += 8;
      if (piece.type === 'p') positional += piece.color === 'w' ? (Number(square[1]) - 2) * 6 : (7 - Number(square[1])) * 6;
      score += piece.color === color ? value + positional : -(value + positional);
    }
  }
  const mobility = game.moves().length;
  score += game.turn() === color ? mobility * 2 : -mobility * 2;
  if (game.inCheck()) score += game.turn() === color ? -80 : 80;
  return score;
}

function randomItem(items) {
  return items[Math.floor(Math.random() * items.length)];
}

function maybeBotMove(room) {
  if (!room.bot || room.lastResult || room.game.isGameOver()) return;
  if (room.game.turn() !== room.bot.color) return;
  setTimeout(() => {
    if (!rooms.has(room.id) || room.lastResult || room.game.isGameOver()) return;
    if (room.game.turn() !== room.bot.color) return;
    if (updateClock(room)) {
      emitRoom(room);
      return;
    }
    const move = chooseBotMove(room);
    if (!move) return;
    room.game.move({ from: move.from, to: move.to, promotion: move.promotion || 'q' });
    room.lastTickAt = Date.now();
    room.lastResult = resultFor(room);
    finalizeRoom(room);
    emitRoom(room);
  }, 650);
}

function activeRoomForUser(userId) {
  for (const room of rooms.values()) {
    if (room.lastResult) continue;
    if (room.userIds.w === userId) return { room, color: 'w' };
    if (room.userIds.b === userId) return { room, color: 'b' };
  }
  return null;
}

function rejoinActiveRoom(socket) {
  const active = activeRoomForUser(socket.data.user.id);
  if (!active) return false;

  const { room, color } = active;
  const previousSocketId = room.players[color];
  const previousSocket = io.sockets.sockets.get(previousSocketId);
  if (previousSocket && previousSocket.id !== socket.id) {
    previousSocket.leave(room.id);
    previousSocket.data.roomId = null;
    previousSocket.data.color = 'spectator';
  }

  removeFromQueue(socket);
  room.players[color] = socket.id;
  socket.join(room.id);
  socket.data.roomId = room.id;
  socket.data.color = color;
  socket.emit('role', { color, roomId: room.id });
  socket.emit('state', publicRoom(room));
  return true;
}

io.use((socket, next) => {
  const user = userByToken(socket.handshake.auth?.token);
  if (!user) return next(new Error('unauthorized'));
  socket.data.user = user;
  next();
});

io.on('connection', (socket) => {
  socketsByUser.set(socket.data.user.id, socket.id);
  socket.emit('me', publicUser(socket.data.user));
  socket.emit('leaderboard', leaderboardPayload());
  socket.emit('queueSize', queue.length);
  emitOnlineCount();
  rejoinActiveRoom(socket);

  socket.on('findMatch', () => {
    leaveMatch(socket);
    queueSocket(socket);
  });

  socket.on('playBot', (level) => {
    createBotRoom(socket, String(level || 'easy'));
    io.emit('queueSize', queue.length);
  });

  socket.on('cancelMatch', () => {
    removeFromQueue(socket);
    socket.emit('matchmaking', { queued: false });
    io.emit('queueSize', queue.length);
  });

  socket.on('chatMessage', (message) => {
    const room = rooms.get(socket.data.roomId);
    if (!room) return;
    const text = String(message || '').trim().replace(/\s+/g, ' ').slice(0, 180);
    if (!text) return;
    const entry = {
      id: crypto.randomUUID().slice(0, 8),
      userId: socket.data.user.id,
      username: socket.data.user.username,
      country: socket.data.user.country || 'Unknown',
      color: socket.data.color,
      text,
      createdAt: Date.now(),
    };
    room.chat = [...(room.chat || []), entry].slice(-60);
    emitRoom(room);
  });

  socket.on('rematch', () => {
    const room = rooms.get(socket.data.roomId);
    if (!room || !room.lastResult) return;
    if (socket.data.color !== 'w' && socket.data.color !== 'b') return;
    const userId = socket.data.user.id;
    room.rematchRequests = Array.from(new Set([...(room.rematchRequests || []), userId]));
    const bothReady = room.rematchRequests.includes(room.userIds.w) && room.rematchRequests.includes(room.userIds.b);
    if (bothReady && startRematch(room)) return;
    emitRoom(room);
  });

	  socket.on('move', ({ from, to, promotion }) => {
	    const room = rooms.get(socket.data.roomId);
	    if (!room || room.lastResult || room.game.isGameOver()) return;

    const color = socket.data.color;
    if (color !== 'w' && color !== 'b') return;
	    if (room.players[color] !== socket.id) return;
	    if (room.game.turn() !== color) return;
	    if (updateClock(room)) {
	      emitRoom(room);
	      return;
	    }
	
	    try {
	      const move = room.game.move({ from, to, promotion: promotion || 'q' });
	      if (!move) return;
	      room.lastTickAt = Date.now();
	      room.lastResult = resultFor(room);
	      finalizeRoom(room);
	      emitRoom(room);
      maybeBotMove(room);
    } catch {
      socket.emit('invalidMove');
    }
	  });

  socket.on('resign', () => {
    const room = rooms.get(socket.data.roomId);
    if (!room || room.lastResult) return;
    const color = socket.data.color;
    if (color !== 'w' && color !== 'b') return;
    const winner = color === 'w' ? 'b' : 'w';
    room.lastResult = {
      type: 'resign',
      winner,
      text: (winner === 'w' ? 'Putih' : 'Hitam') + ' menang karena lawan resign',
    };
    finalizeRoom(room);
    emitRoom(room);
  });

  socket.on('disconnect', () => {
    removeFromQueue(socket);
    socketsByUser.delete(socket.data.user.id);
    io.emit('queueSize', queue.length);
    emitOnlineCount();
  });
	});

setInterval(() => {
	  for (const room of rooms.values()) {
	    if (updateClock(room)) emitRoom(room);
	  }
	}, 500);
	
	server.listen(PORT, () => {
  console.log('Chess Online running at http://localhost:' + PORT);
});
