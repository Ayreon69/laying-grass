// Le terrain et ce qu'on a le droit d'y faire. Le serveur et le client utilisent les mêmes règles.
import type { Special, SpecialKind } from './protocol';
import { orientations, type Cell } from './shapes';

const SIDES: Cell[] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

export type PlaceError = 'edge' | 'taken' | 'stone' | 'neighbour' | 'detached';

export const PLACE_ERRORS: Record<PlaceError, string> = {
  edge: 'Elle sort du terrain.',
  taken: 'La place est prise.',
  stone: 'Une pierre gêne.',
  neighbour: 'Elle touche le gazon d’un autre.',
  detached: 'Elle doit toucher ton gazon.',
};

export interface Placement {
  cells: Cell[];
}

export class Board {
  readonly size: number;
  /** Le joueur (son rang) qui possède chaque case, -1 si elle est libre. */
  readonly owner: Int8Array;
  readonly stone: Uint8Array;
  readonly special = new Map<number, SpecialKind>();

  constructor(size: number) {
    this.size = size;
    this.owner = new Int8Array(size * size).fill(-1);
    this.stone = new Uint8Array(size * size);
  }

  clone(): Board {
    const b = new Board(this.size);
    b.owner.set(this.owner);
    b.stone.set(this.stone);
    for (const [k, v] of this.special) b.special.set(k, v);
    return b;
  }

  index(x: number, y: number): number {
    return y * this.size + x;
  }

  inside(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.size && y < this.size;
  }

  setOwner(cells: readonly Cell[], who: number): void {
    for (const [x, y] of cells) this.owner[this.index(x, y)] = who;
  }

  /** Touche-t-elle le gazon d'un autre par un côté ? (Par un coin, c'est permis.) */
  touchesEnemy(x: number, y: number, me: number): boolean {
    for (const [dx, dy] of SIDES) {
      const nx = x + dx;
      const ny = y + dy;
      if (!this.inside(nx, ny)) continue;
      const o = this.owner[this.index(nx, ny)];
      if (o !== -1 && o !== me) return true;
    }
    return false;
  }

  touchesOwn(x: number, y: number, me: number): boolean {
    for (const [dx, dy] of SIDES) {
      const nx = x + dx;
      const ny = y + dy;
      if (this.inside(nx, ny) && this.owner[this.index(nx, ny)] === me) return true;
    }
    return false;
  }

  /** La case est libre, sans pierre, et ne touche personne d'autre : le joueur peut y planter. */
  free(x: number, y: number, me: number): boolean {
    if (!this.inside(x, y)) return false;
    const i = this.index(x, y);
    return this.owner[i] === -1 && !this.stone[i] && !this.touchesEnemy(x, y, me);
  }

  /** Pourquoi cette pose est refusée (rien si elle est permise). */
  check(cells: readonly Cell[], me: number): PlaceError | null {
    let attached = false;
    for (const [x, y] of cells) if (!this.inside(x, y)) return 'edge';
    for (const [x, y] of cells) if (this.owner[this.index(x, y)] !== -1) return 'taken';
    for (const [x, y] of cells) if (this.stone[this.index(x, y)]) return 'stone';
    for (const [x, y] of cells) {
      if (this.touchesEnemy(x, y, me)) return 'neighbour';
      if (this.touchesOwn(x, y, me)) attached = true;
    }
    return attached ? null : 'detached';
  }

  /** Où poser la première touffe : n'importe quelle case libre qui ne touche personne. */
  checkBase(x: number, y: number, me: number): PlaceError | null {
    if (!this.inside(x, y)) return 'edge';
    const i = this.index(x, y);
    if (this.owner[i] !== -1) return 'taken';
    if (this.stone[i]) return 'stone';
    return this.touchesEnemy(x, y, me) ? 'neighbour' : null;
  }

  /** Toutes les poses permises pour cette forme, dans toutes ses orientations. */
  placements(shape: readonly Cell[], me: number): Placement[] {
    const out: Placement[] = [];
    const n = this.size;
    for (const o of orientations(shape)) {
      const w = Math.max(...o.map((c) => c[0])) + 1;
      const h = Math.max(...o.map((c) => c[1])) + 1;
      for (let oy = 0; oy <= n - h; oy++) {
        for (let ox = 0; ox <= n - w; ox++) {
          let ok = true;
          let attached = false;
          for (const [cx, cy] of o) {
            const x = ox + cx;
            const y = oy + cy;
            if (!this.free(x, y, me)) {
              ok = false;
              break;
            }
            if (!attached && this.touchesOwn(x, y, me)) attached = true;
          }
          if (ok && attached) out.push({ cells: o.map(([cx, cy]): Cell => [ox + cx, oy + cy]) });
        }
      }
    }
    return out;
  }

  canPlace(shape: readonly Cell[], me: number): boolean {
    const n = this.size;
    for (const o of orientations(shape)) {
      const w = Math.max(...o.map((c) => c[0])) + 1;
      const h = Math.max(...o.map((c) => c[1])) + 1;
      for (let oy = 0; oy <= n - h; oy++) {
        for (let ox = 0; ox <= n - w; ox++) {
          if (this.check(o.map(([cx, cy]): Cell => [ox + cx, oy + cy]), me) === null) return true;
        }
      }
    }
    return false;
  }

  /** Le plus grand carré d'un seul tenant, son côté et son coin. */
  bestSquare(me: number): { k: number; x: number; y: number } {
    const n = this.size;
    const dp = new Int16Array((n + 1) * (n + 1));
    let best = { k: 0, x: 0, y: 0 };
    for (let y = 1; y <= n; y++) {
      for (let x = 1; x <= n; x++) {
        if (this.owner[this.index(x - 1, y - 1)] !== me) continue;
        const v = 1 + Math.min(dp[(y - 1) * (n + 1) + x], dp[y * (n + 1) + x - 1], dp[(y - 1) * (n + 1) + x - 1]);
        dp[y * (n + 1) + x] = v;
        if (v > best.k) best = { k: v, x: x - v, y: y - v };
      }
    }
    return best;
  }

  /** Les cases spéciales qu'il vient d'entourer sur ses quatre côtés. */
  surrounded(me: number): { x: number; y: number; kind: SpecialKind }[] {
    const out: { x: number; y: number; kind: SpecialKind }[] = [];
    for (const [i, kind] of this.special) {
      const x = i % this.size;
      const y = Math.floor(i / this.size);
      if (SIDES.every(([dx, dy]) => this.inside(x + dx, y + dy) && this.owner[this.index(x + dx, y + dy)] === me)) out.push({ x, y, kind });
    }
    return out;
  }
}

/** Reconstruit le terrain à partir de ce que le client a reçu. */
export function boardFromView(size: number, tiles: readonly { owner: string; cells: Cell[] }[], order: readonly string[], stones: readonly Cell[], specials: readonly Special[]): Board {
  const b = new Board(size);
  for (const t of tiles) b.setOwner(t.cells, order.indexOf(t.owner));
  for (const [x, y] of stones) b.stone[b.index(x, y)] = 1;
  for (const s of specials) b.special.set(b.index(s.x, s.y), s.kind);
  return b;
}
