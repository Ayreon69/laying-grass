// Le moteur de Laying Grass, sans réseau : la file de plaques, les poses, les cases spéciales et les comptes.
import { Board } from '../shared/board';
import { COUPON_REACH, SQUARE_PRIZE, START_COUPONS, START_SEEDS, boardSize, squareReward, type EventType, type GameEvent, type PlacedTile, type QueueTile, type SpecialKind, type Stage } from '../shared/protocol';
import { SHAPES, orientations, shapeKey, type Cell } from '../shared/shapes';

export function shuffle<T>(arr: readonly T[], rng: () => number = Math.random): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Les cases spéciales, selon le nombre de joueurs : autant de bons que de joueurs, et de quoi se battre. */
export function specialCounts(players: number): Record<SpecialKind, number> {
  return { coupon: players, seed: Math.ceil(players / 2), stone: Math.ceil(players / 2), steal: Math.ceil(players * 0.75) };
}

export interface Standing {
  id: string;
  square: { k: number; x: number; y: number };
  before: number;
  reward: number;
  prize: number;
  total: number;
  place: number;
}

export interface GameOptions {
  rounds?: number;
  rng?: () => number;
}

export class Game {
  readonly order: string[];
  readonly size: number;
  readonly rounds: number;
  readonly board: Board;
  readonly tiles = new Map<number, PlacedTile>();
  readonly seeds = new Map<string, number>();
  readonly coupons = new Map<string, number>();
  readonly events: GameEvent[] = [];
  queue: QueueTile[];
  round = 1;
  stage: Stage = 'place';
  seq = 0;
  /** La plaque arrachée qu'il reste à replanter. */
  stolen: Cell[] | null = null;
  private turnIndex = 0;
  private buying = false;
  private pending: ('steal' | 'stone')[] = [];
  private nextTile = 1;
  private nextEvent = 1;
  private readonly rooted = new Set<string>();

  constructor(order: string[], opts: GameOptions = {}) {
    const rng = opts.rng ?? Math.random;
    this.order = [...order];
    this.rounds = opts.rounds ?? 9;
    this.size = boardSize(order.length);
    this.board = new Board(this.size);
    this.queue = shuffle(SHAPES.map((_, i) => i), rng).map((shape, i) => ({ id: i + 1, shape }));
    for (const id of order) {
      this.seeds.set(id, START_SEEDS);
      this.coupons.set(id, START_COUPONS);
    }
    this.scatterSpecials(rng);
    this.skipIfStuck();
  }

  /** Les cases spéciales, bien réparties : pour chacune, on tire quelques cases et on garde la plus isolée. */
  private scatterSpecials(rng: () => number): void {
    const counts = specialCounts(this.order.length);
    const kinds = shuffle(Object.entries(counts).flatMap(([k, n]) => Array.from({ length: n }, () => k as SpecialKind)), rng);
    const placed: Cell[] = [];
    const span = this.size - 4;
    for (const kind of kinds) {
      let best: Cell = [2, 2];
      let bestD = -1;
      for (let t = 0; t < 24; t++) {
        const c: Cell = [2 + Math.floor(rng() * span), 2 + Math.floor(rng() * span)];
        const d = placed.length ? Math.min(...placed.map((p) => Math.max(Math.abs(p[0] - c[0]), Math.abs(p[1] - c[1])))) : this.size;
        if (d > bestD) {
          best = c;
          bestD = d;
        }
      }
      // Deux cases spéciales collées ne se laisseraient pas entourer : on saute celle-là.
      if (bestD < 2) continue;
      placed.push(best);
      this.board.special.set(this.board.index(best[0], best[1]), kind);
    }
  }

  get turn(): string | null {
    return this.stage === 'over' ? null : this.order[this.turnIndex];
  }

  /** Le rang du joueur, celui qu'on inscrit sur le terrain. */
  rank(id: string): number {
    return this.order.indexOf(id);
  }

  isRooted(id: string): boolean {
    return this.rooted.has(id);
  }

  /** La plaque que prendrait ce joueur s'il ne dépense rien. */
  get head(): QueueTile | undefined {
    return this.queue[0];
  }

  /** Les plaques atteignables : celle du tour, et les cinq suivantes avec un bon. */
  reachable(): QueueTile[] {
    return this.queue.slice(0, COUPON_REACH + 1);
  }

  canPayExchange(id: string): boolean {
    return (this.coupons.get(id) ?? 0) > 0 || (this.seeds.get(id) ?? 0) > 0;
  }

  private emit(type: EventType, player: string, extra: Partial<GameEvent> = {}): void {
    this.events.push({ n: this.nextEvent++, type, player, ...extra });
    if (this.events.length > 8) this.events.shift();
  }

  private addTile(owner: string, kind: PlacedTile['kind'], cells: Cell[]): PlacedTile {
    const tile: PlacedTile = { id: this.nextTile++, owner, kind, cells };
    this.tiles.set(tile.id, tile);
    this.board.setOwner(cells, this.rank(owner));
    // Une plaque qui recouvre une case spéciale la fait disparaître, sans effet.
    for (const [x, y] of cells) this.board.special.delete(this.board.index(x, y));
    return tile;
  }

  /** Après chaque pose : les cases entourées deviennent du gazon, et leur effet s'applique. */
  private settle(by: string): SpecialKind[] {
    const me = this.rank(by);
    const activated: SpecialKind[] = [];
    for (const s of this.board.surrounded(me)) {
      this.addTile(by, 'special', [[s.x, s.y]]);
      activated.push(s.kind);
      if (s.kind === 'coupon') this.coupons.set(by, (this.coupons.get(by) ?? 0) + 1);
      else if (s.kind === 'seed') this.seeds.set(by, (this.seeds.get(by) ?? 0) + 1);
      else this.pending.push(s.kind);
    }
    return activated;
  }

  /** Ce qui reste à faire après une pose : d'abord les effets, puis le tour suivant. */
  private proceed(): void {
    this.seq++;
    while (this.pending.length) {
      const effect = this.pending.shift()!;
      if (effect === 'steal' && !this.stealable(this.turn!).length) continue;
      if (effect === 'stone' && !this.stoneSpots().length) continue;
      this.stage = effect;
      return;
    }
    if (this.buying) {
      this.stage = 'buy';
      if (!this.mayBuy(this.turn!)) this.nextBuyer();
      return;
    }
    this.nextTurn();
  }

  private nextTurn(): void {
    this.turnIndex++;
    if (this.turnIndex >= this.order.length) {
      this.turnIndex = 0;
      this.round++;
    }
    if (this.round > this.rounds || !this.queue.length) {
      this.round = Math.min(this.round, this.rounds);
      this.startBuying();
      return;
    }
    this.stage = 'place';
    this.skipIfStuck();
  }

  /** Aucune plaque atteignable ne rentre, et rien à faire pour y remédier : la plaque du tour est perdue. */
  private skipIfStuck(): void {
    if (this.stage !== 'place') return;
    const id = this.turn!;
    if (!this.rooted.has(id)) return;
    const me = this.rank(id);
    const tiles = this.canPayExchange(id) ? this.reachable() : this.queue.slice(0, 1);
    if (tiles.some((t) => this.board.canPlace(SHAPES[t.shape], me))) return;
    if ((this.seeds.get(id) ?? 0) > 0 && this.board.stone.some((s) => s === 1)) return;
    this.dropHead(id, 'stuck');
  }

  private dropHead(id: string, why: GameEvent['why']): void {
    const head = this.queue.shift();
    this.emit('discard', id, { tileId: head?.id, why });
    this.seq++;
    this.nextTurn();
  }

  private startBuying(): void {
    this.buying = true;
    this.turnIndex = 0;
    this.stage = 'buy';
    this.seq++;
    if (!this.mayBuy(this.turn!)) this.nextBuyer();
  }

  /** Peut-il encore acheter une motte ? */
  mayBuy(id: string): boolean {
    if ((this.seeds.get(id) ?? 0) < 1 || !this.rooted.has(id)) return false;
    return this.board.canPlace([[0, 0]], this.rank(id));
  }

  private nextBuyer(): void {
    for (let i = this.turnIndex + 1; i < this.order.length; i++) {
      if (this.mayBuy(this.order[i])) {
        this.turnIndex = i;
        this.stage = 'buy';
        this.seq++;
        return;
      }
    }
    this.stage = 'over';
    this.seq++;
  }

  // ───────────────────────────── Gestes ─────────────────────────────

  /** Planter une plaque de la file : k vaut 0 pour celle du tour, 1 à 5 avec un bon (acheté d'office si besoin). */
  place(by: string, k: number, cells: Cell[], base?: Cell | null): string | undefined {
    if (this.stage !== 'place' || this.turn !== by) return "Ce n'est pas à toi de planter.";
    if (!Number.isInteger(k) || k < 0 || k > COUPON_REACH || k >= this.queue.length) return 'Cette plaque est hors de portée.';
    const chosen = this.queue[k];
    const shape = SHAPES[chosen.shape];
    if (cells.length !== shape.length || !orientations(shape).some((o) => shapeKey(o) === shapeKey(cells))) return "Ce n'est pas la forme de cette plaque.";
    let paid: GameEvent['paid'];
    if (k > 0) {
      if ((this.coupons.get(by) ?? 0) > 0) paid = 'coupon';
      else if ((this.seeds.get(by) ?? 0) > 0) paid = 'seed';
      else return "Il te faut un bon pour prendre cette plaque.";
    }
    const me = this.rank(by);
    const rooted = this.rooted.has(by);
    if (!rooted) {
      if (!base) return 'Choisis où planter ta première touffe.';
      const err = this.board.checkBase(base[0], base[1], me);
      if (err) return 'Ta première touffe ne peut pas aller là.';
      if (cells.some(([x, y]) => x === base[0] && y === base[1])) return 'La plaque recouvre ta première touffe.';
      const test = this.board.clone();
      test.setOwner([base], me);
      if (test.check(cells, me)) return 'Cette plaque doit toucher ta première touffe.';
      this.addTile(by, 'base', [base]);
      this.rooted.add(by);
    } else if (this.board.check(cells, me)) {
      return 'Cette plaque ne peut pas aller là.';
    }
    if (paid === 'coupon') this.coupons.set(by, this.coupons.get(by)! - 1);
    if (paid === 'seed') this.seeds.set(by, this.seeds.get(by)! - 1);
    // Les plaques sautées passent en bout de file.
    this.queue = [...this.queue.slice(k + 1), ...this.queue.slice(0, k)];
    const tile = this.addTile(by, 'tile', cells);
    const activated = this.settle(by);
    this.emit('place', by, { tileId: tile.id, k, paid, activated });
    this.proceed();
    return undefined;
  }

  /** Renoncer à la plaque du tour : elle quitte la partie. */
  discard(by: string, why: GameEvent['why'] = 'choice'): string | undefined {
    if (this.stage !== 'place' || this.turn !== by) return "Ce n'est pas à toi de jouer.";
    this.dropHead(by, why);
    return undefined;
  }

  /** Un bon contre une graine, à tout moment de la partie. */
  buyCoupon(by: string): string | undefined {
    if (!this.seeds.has(by)) return "Tu n'es pas à cette table.";
    if (this.stage === 'over' || this.buying) return 'Les bons ne servent plus à rien.';
    if (this.seeds.get(by)! < 1) return "Il te faut une graine pour acheter un bon.";
    this.seeds.set(by, this.seeds.get(by)! - 1);
    this.coupons.set(by, this.coupons.get(by)! + 1);
    this.emit('buyCoupon', by);
    return undefined;
  }

  /** Donner un bon à quelqu'un, à tout moment : c'est comme ça que naissent les alliances. */
  giveCoupon(by: string, to: string): string | undefined {
    if (!this.seeds.has(by) || !this.seeds.has(to) || by === to) return 'À qui veux-tu le donner ?';
    if (this.stage === 'over' || this.buying) return 'Les bons ne servent plus à rien.';
    if (this.coupons.get(by)! < 1) return "Tu n'as pas de bon à donner.";
    this.coupons.set(by, this.coupons.get(by)! - 1);
    this.coupons.set(to, this.coupons.get(to)! + 1);
    this.emit('giveCoupon', by, { other: to });
    return undefined;
  }

  /** Retirer une pierre pour une graine, pendant son tour. */
  removeStone(by: string, x: number, y: number): string | undefined {
    if ((this.stage !== 'place' && this.stage !== 'buy') || this.turn !== by) return 'On retire une pierre pendant son tour.';
    if (!this.board.inside(x, y) || !this.board.stone[this.board.index(x, y)]) return "Il n'y a pas de pierre ici.";
    if (this.seeds.get(by)! < 1) return 'Il te faut une graine pour retirer une pierre.';
    this.seeds.set(by, this.seeds.get(by)! - 1);
    this.board.stone[this.board.index(x, y)] = 0;
    this.emit('stoneOff', by, { cells: [[x, y]] });
    return undefined;
  }

  stoneSpots(): Cell[] {
    const out: Cell[] = [];
    const b = this.board;
    for (let y = 0; y < b.size; y++) {
      for (let x = 0; x < b.size; x++) {
        const i = b.index(x, y);
        if (b.owner[i] === -1 && !b.stone[i] && !b.special.has(i)) out.push([x, y]);
      }
    }
    return out;
  }

  placeStone(by: string, x: number, y: number): string | undefined {
    if (this.stage !== 'stone' || this.turn !== by) return "Ce n'est pas à toi de poser une pierre.";
    if (!this.board.inside(x, y)) return 'Hors du terrain.';
    const i = this.board.index(x, y);
    if (this.board.owner[i] !== -1 || this.board.stone[i] || this.board.special.has(i)) return 'La pierre va sur une case libre.';
    this.board.stone[i] = 1;
    this.emit('stoneSet', by, { cells: [[x, y]] });
    this.proceed();
    return undefined;
  }

  /** Les plaques qu'on peut arracher : celles des autres, sauf les premières touffes et les cases spéciales entourées. */
  stealable(by: string): PlacedTile[] {
    return [...this.tiles.values()].filter((t) => t.owner !== by && (t.kind === 'tile' || t.kind === 'plug'));
  }

  steal(by: string, tileId: number): string | undefined {
    if (this.stage !== 'steal' || this.turn !== by) return "Ce n'est pas à toi d'arracher.";
    const tile = this.tiles.get(tileId);
    if (!tile || tile.owner === by || (tile.kind !== 'tile' && tile.kind !== 'plug')) return 'Cette plaque ne peut pas être arrachée.';
    this.tiles.delete(tileId);
    this.board.setOwner(tile.cells, -1);
    this.emit('stealTake', by, { tileId, other: tile.owner, cells: tile.cells });
    this.seq++;
    if (!this.board.canPlace(tile.cells, this.rank(by))) {
      // Nulle part où la replanter : elle est perdue pour tout le monde.
      this.emit('stealLost', by, { cells: tile.cells });
      this.proceed();
      return undefined;
    }
    this.stolen = tile.cells;
    this.stage = 'stealPlace';
    return undefined;
  }

  placeStolen(by: string, cells: Cell[]): string | undefined {
    if (this.stage !== 'stealPlace' || this.turn !== by || !this.stolen) return "Tu n'as pas de plaque à replanter.";
    if (cells.length !== this.stolen.length || !orientations(this.stolen).some((o) => shapeKey(o) === shapeKey(cells))) return "Ce n'est pas la forme de cette plaque.";
    if (this.board.check(cells, this.rank(by))) return 'Cette plaque ne peut pas aller là.';
    this.stolen = null;
    const tile = this.addTile(by, 'tile', cells);
    const activated = this.settle(by);
    this.emit('stealPlace', by, { tileId: tile.id, activated });
    this.proceed();
    return undefined;
  }

  /** Renoncer à l'effet en cours : pas de pierre, pas d'arrachage, ou la plaque arrachée est perdue. */
  skipEffect(by: string, why: GameEvent['why'] = 'choice'): string | undefined {
    if (this.turn !== by || (this.stage !== 'steal' && this.stage !== 'stone' && this.stage !== 'stealPlace')) return 'Rien à passer.';
    if (this.stage === 'stealPlace') {
      this.emit('stealLost', by, { cells: this.stolen ?? [], why });
      this.stolen = null;
    } else this.emit('skip', by, { why });
    this.proceed();
    return undefined;
  }

  /** Après la dernière manche : une motte d'une case pour une graine. */
  buyPlug(by: string, x: number, y: number): string | undefined {
    if (this.stage !== 'buy' || this.turn !== by) return "Ce n'est pas à toi d'acheter.";
    if (this.seeds.get(by)! < 1) return "Tu n'as plus de graine.";
    if (this.board.check([[x, y]], this.rank(by))) return 'Cette motte ne peut pas aller là.';
    this.seeds.set(by, this.seeds.get(by)! - 1);
    const tile = this.addTile(by, 'plug', [[x, y]]);
    const activated = this.settle(by);
    this.emit('plug', by, { tileId: tile.id, activated });
    this.proceed();
    return undefined;
  }

  endBuy(by: string): string | undefined {
    if (this.stage !== 'buy' || this.turn !== by) return "Ce n'est pas à toi de finir.";
    this.nextBuyer();
    return undefined;
  }

  /** Le temps est écoulé : on applique ce que prévoit la règle. */
  timeout(): void {
    const id = this.turn;
    if (!id) return;
    if (this.stage === 'place') this.discard(id, 'time');
    else if (this.stage === 'buy') this.endBuy(id);
    else this.skipEffect(id, 'time');
  }

  // ───────────────────────────── Comptes ─────────────────────────────

  standings(): Standing[] {
    const rows = this.order.map((id) => {
      const square = this.board.bestSquare(this.rank(id));
      return { id, square, before: this.seeds.get(id) ?? 0, reward: squareReward(square.k), prize: 0, total: 0, place: 1 };
    });
    const top = Math.max(...rows.map((r) => r.square.k));
    const best = rows.filter((r) => r.square.k === top);
    // La prime se partage, mais elle ne se coupe pas : si elle ne se divise pas, personne ne la touche.
    const share = SQUARE_PRIZE % best.length === 0 ? SQUARE_PRIZE / best.length : 0;
    for (const r of best) r.prize = share;
    for (const r of rows) r.total = r.before + r.reward + r.prize;
    rows.sort((a, b) => b.total - a.total || b.square.k - a.square.k);
    rows.forEach((r, i) => {
      const prev = rows[i - 1];
      r.place = prev && prev.total === r.total && prev.square.k === r.square.k ? prev.place : i + 1;
    });
    return rows;
  }
}
