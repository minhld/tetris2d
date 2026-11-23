export const ROWS = 20;
export const COLS = 10;
export const DURATIONS = [5, 10, 15, 20, 30];

export const SHAPES = [
  [[1, 1]],
  [[1, 1, 1]],
  [[1, 0], [1, 1]],
  [[1, 1], [1, 1]],
  [[0, 1, 0], [1, 1, 1]],
  [[1, 0, 0], [1, 1, 1]],
  [[1, 1, 1, 1]],
  [[0, 1, 0], [1, 1, 1], [0, 1, 0]],
];

const emptyRow = () => Array(COLS).fill(null);
const spawn = (kind) => ({
  kind, shape: SHAPES[kind], x: Math.floor((COLS - SHAPES[kind][0].length) / 2), y: 0,
});

function draw(bag) {
  if (!bag.length) {
    bag = SHAPES.map((_, kind) => kind);
    for (let i = bag.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [bag[i], bag[j]] = [bag[j], bag[i]];
    }
  }
  return [bag[0], bag.slice(1)];
}

export function newGame(mode = 'simple', minutes = 5) {
  const [first, rest] = draw([]);
  const [next, bag] = draw(rest);
  return {
    board: Array.from({ length: ROWS }, emptyRow),
    piece: spawn(first), next, bag, score: 0, mode, minutes,
    remaining: minutes * 60_000, gravity: 0, pieceNumber: 0, end: null,
  };
}

export function cells(piece) {
  return piece.shape.flatMap((row, y) => row.flatMap((filled, x) =>
    filled ? [[piece.x + x, piece.y + y]] : []
  ));
}

function blocked(board, piece) {
  return cells(piece).some(([x, y]) =>
    x < 0 || x >= COLS || y < 0 || y >= ROWS || board[y][x] !== null
  );
}

export function landing(game) {
  let piece = game.piece;
  while (!blocked(game.board, { ...piece, y: piece.y + 1 })) {
    piece = { ...piece, y: piece.y + 1 };
  }
  return piece;
}

function lock(game, piece) {
  const board = game.board.map((row) => [...row]);
  for (const [x, y] of cells(piece)) board[y][x] = piece.kind;
  const kept = board.filter((row) => row.includes(null));
  const cleared = ROWS - kept.length;
  const updated = [...Array.from({ length: cleared }, emptyRow), ...kept];
  const incoming = spawn(game.next);
  const [next, bag] = draw(game.bag);
  return {
    ...game, board: updated, piece: incoming, score: game.score + cleared, next, bag,
    pieceNumber: game.pieceNumber + 1, gravity: 0,
    end: blocked(updated, incoming) ? 'Game over' : null,
  };
}

export function play(game, action) {
  if (game.end) return game;
  const { piece, board } = game;
  if (action === 'drop') return lock(game, landing(game));
  if (action === 'rotate') {
    const shape = piece.shape[0].map((_, x) => piece.shape.map((row) => row[x]).reverse());
    for (const [dx, dy] of [[0, 0], [-1, 0], [1, 0], [-2, 0], [2, 0], [0, -1]]) {
      const turned = { ...piece, shape, x: piece.x + dx, y: piece.y + dy };
      if (!blocked(board, turned)) return { ...game, piece: turned };
    }
    return game;
  }
  const moved = { ...piece, x: piece.x + (action === 'left' ? -1 : action === 'right' ? 1 : 0),
    y: piece.y + (action === 'down' ? 1 : 0) };
  if (!blocked(board, moved)) return { ...game, piece: moved };
  return action === 'down' ? lock(game, piece) : game;
}

export const level = (game) => game.mode === 'advanced' ? Math.floor(game.score / 100) + 1 : 1;

export function tick(game, elapsed) {
  if (game.end) return game;
  const remaining = game.mode === 'timed' ? Math.max(0, game.remaining - elapsed) : game.remaining;
  if (!remaining) return { ...game, remaining, end: 'Time is up' };
  const interval = Math.max(100, 650 * 0.84 ** (level(game) - 1));
  const gravity = game.gravity + elapsed;
  if (gravity < interval) return { ...game, remaining, gravity };
  return play({ ...game, remaining, gravity: gravity % interval }, 'down');
}

export function saveScore(records, game, date = new Date().toISOString()) {
  if (!game.score) return records;
  const scores = [...(records[game.mode] ?? []), { score: game.score, minutes: game.minutes, date }];
  scores.sort((a, b) => b.score - a.score);
  return { ...records, [game.mode]: scores.slice(0, 10) };
}
