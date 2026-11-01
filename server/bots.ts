// Les jardiniers bots : ils visent un carré possible, le remplissent sans laisser de trous, et gênent celui qui mène.
// Tout ce qu'ils voient est sur la table : leur faiblesse vient d'un coup d'œil imparfait, pas d'informations cachées.
import type { Board } from '../shared/board';
import type { SpecialKind } from '../shared/protocol';
import { SHAPES, type Cell } from '../shared/shapes';
import type { Game } from './game';

export interface Skill {
  /** Le flou du coup d'œil. */
  noise: number;
  /** Le gain qu'il exige pour dépenser un bon. */
  couponGain: number;
  /** Son goût pour gêner les autres. */
  aggression: number;
}

const PROFILES: Skill[] = [
  { noise: 0.6, couponGain: 2.2, aggression: 0.9 },
  { noise: 1.4, couponGain: 3, aggression: 0.6 },
  { noise: 2.4, couponGain: 4, aggression: 0.4 },
];

export const AUTOPILOT: Skill = { noise: 1, couponGain: 3.5, aggression: 0 };

export function randomSkill(): Skill {
  return PROFILES[Math.floor(Math.random() * PROFILES.length)];
}

export type BotAction =
  | { type: 'place'; k: number; cells: Cell[]; base?: Cell }
  | { type: 'discard' }
  | { type: 'steal'; tileId: number }
  | { type: 'stolen'; cells: Cell[] }
  | { type: 'stone'; x: number; y: number }
  | { type: 'skip' }
  | { type: 'plug'; x: number; y: number }
  | { type: 'endBuy' };

interface Target {
  k: number;
  x: number;
  y: number;
  own: number;
  score: number;
}

/** Sommes par rectangle, pour tester vite chaque fenêtre carrée. */
function prefix(b: Board, test: (i: number, x: number, y: number) => boolean): Int32Array {
  const n = b.size;
  const s = new Int32Array((n + 1) * (n + 1));
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const v = test(b.index(x, y), x, y) ? 1 : 0;
      s[(y + 1) * (n + 1) + x + 1] = v + s[y * (n + 1) + x + 1] + s[(y + 1) * (n + 1) + x] - s[y * (n + 1) + x];
    }
  }
  return s;
}

function sum(s: Int32Array, n: number, x: number, y: number, k: number): number {
  const w = n + 1;
  return s[(y + k) * w + x + k] - s[y * w + x + k] - s[(y + k) * w + x] + s[y * w + x];
}

/** Les meilleurs carrés encore possibles pour ce joueur, selon ce qu'il peut encore planter. */
function targets(b: Board, me: number, budget: number, limit: number): Target[] {
  const n = b.size;
  const own = prefix(b, (i) => b.owner[i] === me);
  const bad = prefix(b, (i, x, y) => b.owner[i] !== me && !b.free(x, y, me));
  const all: Target[] = [];
  for (let k = 2; k <= Math.min(n, 11); k++) {
    for (let y = 0; y <= n - k; y++) {
      for (let x = 0; x <= n - k; x++) {
        if (sum(bad, n, x, y, k)) continue;
        const mine = sum(own, n, x, y, k);
        if (!mine) continue;
        const missing = k * k - mine;
        if (missing > budget) continue;
        all.push({ k, x, y, own: mine, score: k * 9 + (mine / (k * k)) * 7 });
      }
    }
  }
  all.sort((p, q) => q.score - p.score);
  return all.slice(0, limit);
}

const inWindow = (t: Target, x: number, y: number) => x >= t.x && y >= t.y && x < t.x + t.k && y < t.y + t.k;

const SPECIAL_VALUE: Record<SpecialKind, number> = { coupon: 3.5, seed: 5, stone: 2.5, steal: 5 };

function neighbours(x: number, y: number): Cell[] {
  return [
    [x + 1, y],
    [x - 1, y],
    [x, y + 1],
    [x, y - 1],
  ];
}

interface Context {
  b: Board;
  me: number;
  mine: Target[];
  /** Le carré que vise chaque adversaire. */
  rivals: Target[];
  skill: Skill;
}

/** La valeur d'une pose : ce qu'elle apporte au carré visé, les trous qu'elle laisse, les cases spéciales et les autres qu'elle gêne. */
function evaluate(ctx: Context, cells: readonly Cell[]): number {
  const { b, me, mine, rivals, skill } = ctx;
  const added = new Set(cells.map(([x, y]) => b.index(x, y)));
  const isOwn = (x: number, y: number) => b.inside(x, y) && (b.owner[b.index(x, y)] === me || added.has(b.index(x, y)));
  let value = -6;
  for (const t of mine) {
    let inside = 0;
    for (const [x, y] of cells) if (inWindow(t, x, y)) inside++;
    if (!inside && mine.length > 1) continue;
    const outside = cells.length - inside;
    let holes = 0;
    for (const [x, y] of cells) {
      for (const [nx, ny] of neighbours(x, y)) {
        if (!b.inside(nx, ny) || !inWindow(t, nx, ny) || isOwn(nx, ny)) continue;
        // Une case vide du carré entourée de toutes parts ne se remplira qu'avec une motte.
        const around = neighbours(nx, ny).filter(([ax, ay]) => !b.inside(ax, ay) || isOwn(ax, ay) || !inWindow(t, ax, ay)).length;
        if (around >= 4) holes += 2;
        else if (around === 3) holes += 0.5;
      }
    }
    const v = t.score + inside * 3.2 - outside * 2.4 - holes * 2;
    if (v > value) value = v;
  }
  // Les cases spéciales : celles qu'elle entoure, et celles qu'elle commence à entourer.
  for (const [i, kind] of b.special) {
    const x = i % b.size;
    const y = Math.floor(i / b.size);
    if (added.has(i)) {
      value -= 1.2;
      continue;
    }
    const around = neighbours(x, y).filter(([ax, ay]) => isOwn(ax, ay)).length;
    if (around === 4) value += SPECIAL_VALUE[kind];
    else if (around >= 2 && neighbours(x, y).some(([ax, ay]) => b.inside(ax, ay) && added.has(b.index(ax, ay)))) value += SPECIAL_VALUE[kind] * 0.12 * around;
  }
  // Gêner : planter dans le carré visé par un autre, ou juste à côté, le lui interdit.
  if (skill.aggression > 0) {
    let blocked = 0;
    for (const r of rivals) {
      const hit = cells.some(([x, y]) => inWindow(r, x, y) || neighbours(x, y).some(([nx, ny]) => inWindow(r, nx, ny) && b.owner[b.index(nx, ny)] === -1));
      if (hit) blocked += r.own / (r.k * r.k);
    }
    value += blocked * 5 * skill.aggression;
  }
  return value + Math.random() * skill.noise;
}

function budgetOf(g: Game, id: string): number {
  const turns = Math.max(1, g.rounds - g.round + (g.order.indexOf(id) >= g.order.indexOf(g.turn ?? id) ? 1 : 0));
  return turns * 4.2 + Math.min(g.seeds.get(id) ?? 0, 2);
}

function contextFor(g: Game, id: string, skill: Skill, board?: Board): Context {
  const b = board ?? g.board;
  const me = g.rank(id);
  const rivals: Target[] = [];
  if (skill.aggression > 0) {
    for (const other of g.order) {
      if (other === id || !g.isRooted(other)) continue;
      const best = targets(b, g.rank(other), budgetOf(g, other), 1)[0];
      if (best && best.own >= 9) rivals.push(best);
    }
  }
  return { b, me, mine: targets(b, me, budgetOf(g, id), 6), rivals, skill };
}

/** Le meilleur endroit pour commencer : de la place autour de soi, loin des autres, et quelques cases utiles pas loin. */
function chooseBase(g: Game, id: string, skill: Skill): Cell {
  const b = g.board;
  const me = g.rank(id);
  let best: Cell = [Math.floor(b.size / 2), Math.floor(b.size / 2)];
  let bestV = -Infinity;
  const free = prefix(b, (_i, x, y) => b.free(x, y, me));
  const n = b.size;
  for (let y = 1; y < n - 1; y++) {
    for (let x = 1; x < n - 1; x++) {
      if (b.checkBase(x, y, me) || b.special.has(b.index(x, y))) continue;
      const span = 7;
      const x0 = Math.max(0, Math.min(n - span, x - 3));
      const y0 = Math.max(0, Math.min(n - span, y - 3));
      let v = sum(free, n, x0, y0, span);
      for (const [i, kind] of b.special) {
        const d = Math.abs((i % n) - x) + Math.abs(Math.floor(i / n) - y);
        if (d <= 4) v += SPECIAL_VALUE[kind] * 0.5;
      }
      v += Math.random() * skill.noise * 3;
      if (v > bestV) {
        bestV = v;
        best = [x, y];
      }
    }
  }
  return best;
}

function decidePlace(g: Game, id: string, skill: Skill): BotAction {
  const me = g.rank(id);
  let board = g.board;
  let base: Cell | undefined;
  if (!g.isRooted(id)) {
    base = chooseBase(g, id, skill);
    board = g.board.clone();
    board.setOwner([base], me);
  }
  const ctx = contextFor(g, id, skill, board);
  const coupons = g.coupons.get(id) ?? 0;
  const seeds = g.seeds.get(id) ?? 0;
  const reach = g.reachable();
  const options = coupons + seeds > 0 ? reach : reach.slice(0, 1);
  let head: { cells: Cell[]; v: number } | null = null;
  let other: { k: number; cells: Cell[]; v: number } | null = null;
  options.forEach((tile, k) => {
    for (const { cells } of board.placements(SHAPES[tile.shape], me)) {
      if (base && cells.some(([x, y]) => x === base![0] && y === base![1])) continue;
      const v = evaluate(ctx, cells);
      if (k === 0) {
        if (!head || v > head.v) head = { cells, v };
      } else if (!other || v > other.v) other = { k, cells, v };
    }
  });
  const a = head as { cells: Cell[]; v: number } | null;
  const c = other as { k: number; cells: Cell[]; v: number } | null;
  if (!a && !c) return { type: 'discard' };
  if (!c) return { type: 'place', k: 0, cells: a!.cells, base };
  // Un bon se dépense pour un vrai gain. Payer avec une graine demande un gain encore plus net.
  const needed = coupons > 0 ? skill.couponGain : skill.couponGain + 3.5;
  if (!a || c.v - a.v >= needed) return { type: 'place', k: c.k, cells: c.cells, base };
  return { type: 'place', k: 0, cells: a.cells, base };
}

/** Celui qui mène : le plus grand carré, puis le plus de cases. */
function leader(g: Game, id: string): string | null {
  let best: string | null = null;
  let bestV = -1;
  for (const other of g.order) {
    if (other === id) continue;
    const r = g.rank(other);
    const k = g.board.bestSquare(r).k;
    let count = 0;
    for (const o of g.board.owner) if (o === r) count++;
    const v = k * 100 + count;
    if (v > bestV) {
      bestV = v;
      best = other;
    }
  }
  return best;
}

function decideSteal(g: Game, id: string, skill: Skill): BotAction {
  const tiles = g.stealable(id);
  if (!tiles.length) return { type: 'skip' };
  const top = leader(g, id);
  let best = tiles[0];
  let bestV = -Infinity;
  for (const t of tiles) {
    const sq = g.board.bestSquare(g.rank(t.owner));
    const inSquare = t.cells.filter(([x, y]) => x >= sq.x && y >= sq.y && x < sq.x + sq.k && y < sq.y + sq.k).length;
    const v = inSquare * 3 + t.cells.length + (t.owner === top ? 4 * (0.5 + skill.aggression) : 0) + Math.random() * skill.noise;
    if (v > bestV) {
      bestV = v;
      best = t;
    }
  }
  return { type: 'steal', tileId: best.id };
}

function decideStolen(g: Game, id: string, skill: Skill): BotAction {
  if (!g.stolen) return { type: 'skip' };
  const ctx = contextFor(g, id, skill);
  let best: Cell[] | null = null;
  let bestV = -Infinity;
  for (const { cells } of g.board.placements(g.stolen, g.rank(id))) {
    const v = evaluate(ctx, cells);
    if (v > bestV) {
      bestV = v;
      best = cells;
    }
  }
  return best ? { type: 'stolen', cells: best } : { type: 'skip' };
}

/** La pierre va au milieu du carré de celui qui mène, là où elle coûte le plus cher. */
function decideStone(g: Game, id: string, skill: Skill): BotAction {
  const spots = g.stoneSpots();
  if (!spots.length) return { type: 'skip' };
  const top = leader(g, id);
  const target = top ? targets(g.board, g.rank(top), budgetOf(g, top), 1)[0] : undefined;
  const mine = targets(g.board, g.rank(id), budgetOf(g, id), 1)[0];
  let best = spots[Math.floor(Math.random() * spots.length)];
  let bestV = -Infinity;
  for (const [x, y] of spots) {
    if (mine && inWindow(mine, x, y)) continue;
    let v = Math.random() * skill.noise;
    if (target && inWindow(target, x, y)) {
      const cx = target.x + target.k / 2;
      const cy = target.y + target.k / 2;
      v += 12 - Math.abs(x + 0.5 - cx) - Math.abs(y + 0.5 - cy);
    }
    if (v > bestV) {
      bestV = v;
      best = [x, y];
    }
  }
  return { type: 'stone', x: best[0], y: best[1] };
}

/** La dernière chance : une motte qui agrandit le carré, si elle rapporte au moins ce qu'elle coûte. */
function decideBuy(g: Game, id: string): BotAction {
  const b = g.board;
  const me = g.rank(id);
  const seeds = g.seeds.get(id) ?? 0;
  const cur = b.bestSquare(me).k;
  const others = Math.max(0, ...g.order.filter((o) => o !== id).map((o) => b.bestSquare(g.rank(o)).k));
  const own = prefix(b, (i) => b.owner[i] === me);
  const bad = prefix(b, (i, x, y) => b.owner[i] !== me && !b.free(x, y, me));
  let best: { x: number; y: number } | null = null;
  let bestNet = 0;
  for (let k = cur + 1; k <= Math.min(b.size, cur + seeds); k++) {
    for (let y = 0; y <= b.size - k; y++) {
      for (let x = 0; x <= b.size - k; x++) {
        if (sum(bad, b.size, x, y, k)) continue;
        const missing = k * k - sum(own, b.size, x, y, k);
        if (missing < 1 || missing > seeds) continue;
        const net = k - cur - missing + (k > others ? 3 : 0) - (cur > others ? 3 : 0);
        if (net < bestNet || (net === bestNet && best)) continue;
        // On commence par une case qui touche déjà le gazon.
        for (let cy = y; cy < y + k; cy++) {
          for (let cx = x; cx < x + k; cx++) {
            if (b.owner[b.index(cx, cy)] !== me && b.check([[cx, cy]], me) === null) {
              best = { x: cx, y: cy };
              bestNet = net;
              cy = y + k;
              break;
            }
          }
        }
      }
    }
  }
  return best ? { type: 'plug', x: best.x, y: best.y } : { type: 'endBuy' };
}

export function decide(g: Game, id: string, skill: Skill): BotAction {
  switch (g.stage) {
    case 'place':
      return decidePlace(g, id, skill);
    case 'steal':
      return decideSteal(g, id, skill);
    case 'stealPlace':
      return decideStolen(g, id, skill);
    case 'stone':
      return decideStone(g, id, skill);
    case 'buy':
      return decideBuy(g, id);
    default:
      return { type: 'skip' };
  }
}

/** Applique la décision d'un bot au moteur ; renvoie l'erreur éventuelle. */
export function applyAction(g: Game, id: string, a: BotAction): string | undefined {
  switch (a.type) {
    case 'place':
      return g.place(id, a.k, a.cells, a.base);
    case 'discard':
      return g.discard(id);
    case 'steal':
      return g.steal(id, a.tileId);
    case 'stolen':
      return g.placeStolen(id, a.cells);
    case 'stone':
      return g.placeStone(id, a.x, a.y);
    case 'skip':
      return g.skipEffect(id);
    case 'plug':
      return g.buyPlug(id, a.x, a.y);
    case 'endBuy':
      return g.endBuy(id);
  }
}
