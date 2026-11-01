// Tests du moteur : les plaques, les règles de pose, la file et les bons, les cases spéciales, les mottes, les comptes, des parties complètes.
import { describe, expect, it } from 'vitest';
import { Board } from '../shared/board';
import { boardSize, squareReward } from '../shared/protocol';
import { SHAPES, orientations, shapeKey, type Cell } from '../shared/shapes';
import { applyAction, decide, randomSkill } from '../server/bots';
import { Game, specialCounts } from '../server/game';

const ids = (n: number) => Array.from({ length: n }, (_, i) => `p${i}`);
const shapeIndex = (cells: Cell[]) => SHAPES.findIndex((s) => orientations(s).some((o) => shapeKey(o) === shapeKey(cells)));

const DOMINO: Cell[] = [[0, 0], [1, 0]];
const I3: Cell[] = [[0, 0], [1, 0], [2, 0]];
const L3: Cell[] = [[0, 0], [1, 0], [0, 1]];
const O4: Cell[] = [[0, 0], [1, 0], [0, 1], [1, 1]];

/** Une partie sans cases spéciales, dont on choisit la file. */
function setup(n: number, shapes: Cell[][] = [], rounds = 9): Game {
  const g = new Game(ids(n), { rounds });
  g.board.special.clear();
  const first = shapes.map((s, i) => ({ id: 1000 + i, shape: shapeIndex(s) }));
  g.queue = [...first, ...g.queue];
  return g;
}

const at = (cells: Cell[], x: number, y: number): Cell[] => cells.map(([cx, cy]) => [cx + x, cy + y]);

describe('les plaques', () => {
  it('sont 96, de 2 à 7 cases, 5 en moyenne', () => {
    expect(SHAPES).toHaveLength(96);
    const sizes = SHAPES.map((s) => s.length);
    expect(Math.min(...sizes)).toBe(2);
    expect(Math.max(...sizes)).toBe(7);
    expect(sizes.reduce((a, b) => a + b) / 96).toBeCloseTo(5.19, 1);
    expect(sizes.filter((n) => n === 5 || n === 6).length).toBeGreaterThan(48);
  });
  it('tiennent d’un seul tenant, sans trou', () => {
    for (const s of SHAPES) {
      const key = new Set(s.map(([x, y]) => `${x},${y}`));
      const seen = new Set<string>();
      const stack = [s[0]];
      while (stack.length) {
        const [x, y] = stack.pop()!;
        if (seen.has(`${x},${y}`) || !key.has(`${x},${y}`)) continue;
        seen.add(`${x},${y}`);
        stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
      }
      expect(seen.size).toBe(s.length);
    }
  });
  it('se tournent et se retournent', () => {
    expect(orientations(O4)).toHaveLength(1);
    expect(orientations(DOMINO)).toHaveLength(2);
    expect(orientations(L3)).toHaveLength(4);
    expect(orientations([[0, 0], [0, 1], [0, 2], [1, 2]])).toHaveLength(8);
  });
});

describe('le terrain', () => {
  it('trouve le plus grand carré', () => {
    const b = new Board(10);
    b.setOwner(at(O4, 2, 2), 0);
    expect(b.bestSquare(0)).toEqual({ k: 2, x: 2, y: 2 });
    b.setOwner([[4, 2], [4, 3], [4, 4], [3, 4], [2, 4]], 0);
    expect(b.bestSquare(0)).toEqual({ k: 3, x: 2, y: 2 });
    expect(b.bestSquare(1).k).toBe(0);
  });
  it('dit pourquoi une pose est refusée', () => {
    const b = new Board(10);
    b.setOwner([[5, 5]], 0);
    b.setOwner([[8, 8]], 1);
    b.stone[b.index(5, 7)] = 1;
    expect(b.check(at(DOMINO, 6, 5), 0)).toBeNull();
    expect(b.check(at(DOMINO, 9, 5), 0)).toBe('edge');
    expect(b.check(at(DOMINO, 4, 5), 0)).toBe('taken');
    expect(b.check([[5, 6], [5, 7]], 0)).toBe('stone');
    expect(b.check(at(DOMINO, 0, 0), 0)).toBe('detached');
    expect(b.check([[6, 5], [7, 5], [7, 6], [7, 7], [7, 8]], 0)).toBe('neighbour');
  });
  it('permet de toucher un autre par un coin, jamais par un côté', () => {
    const b = new Board(10);
    b.setOwner([[5, 5]], 0);
    b.setOwner([[7, 6]], 1);
    expect(b.check([[6, 5]], 0)).toBeNull();
    expect(b.check([[6, 6]], 0)).toBe('neighbour');
  });
});

describe('le début de partie', () => {
  it('adapte le terrain au nombre de joueurs', () => {
    expect(boardSize(2)).toBe(16);
    expect(boardSize(8)).toBe(28);
    expect(new Game(ids(5)).size).toBe(22);
  });
  it('donne 3 graines et 1 bon à chacun', () => {
    const g = new Game(ids(3));
    expect(g.seeds.get('p1')).toBe(3);
    expect(g.coupons.get('p1')).toBe(1);
    expect(g.queue).toHaveLength(96);
    expect(g.stage).toBe('place');
    expect(g.turn).toBe('p0');
  });
  it('répartit les cases spéciales, jamais collées ni au bord', () => {
    for (let n = 2; n <= 8; n++) {
      for (let t = 0; t < 20; t++) {
        const g = new Game(ids(n));
        const counts = specialCounts(n);
        const total = Object.values(counts).reduce((a, b) => a + b);
        const cells = [...g.board.special.keys()].map((i): Cell => [i % g.size, Math.floor(i / g.size)]);
        expect(cells.length).toBeLessThanOrEqual(total);
        expect(cells.length).toBeGreaterThanOrEqual(total - 1);
        for (const [x, y] of cells) {
          expect(x).toBeGreaterThanOrEqual(2);
          expect(y).toBeGreaterThanOrEqual(2);
          expect(x).toBeLessThan(g.size - 2);
          expect(y).toBeLessThan(g.size - 2);
        }
        for (let a = 0; a < cells.length; a++) {
          for (let b = a + 1; b < cells.length; b++) {
            expect(Math.max(Math.abs(cells[a][0] - cells[b][0]), Math.abs(cells[a][1] - cells[b][1]))).toBeGreaterThanOrEqual(2);
          }
        }
      }
    }
  });
  it('demande une première touffe, contre laquelle se pose la plaque', () => {
    const g = setup(2, [DOMINO]);
    expect(g.place('p0', 0, at(DOMINO, 4, 4))).toBeTruthy();
    expect(g.place('p0', 0, at(DOMINO, 4, 4), [4, 4])).toMatch(/recouvre/);
    expect(g.place('p0', 0, at(DOMINO, 8, 8), [4, 4])).toMatch(/toucher/);
    expect(g.place('p0', 0, at(DOMINO, 5, 4), [4, 4])).toBeUndefined();
    expect(g.isRooted('p0')).toBe(true);
    expect([...g.tiles.values()].map((t) => t.kind)).toEqual(['base', 'tile']);
    expect(g.turn).toBe('p1');
  });
  it('refuse le coup d’un autre, et une forme qui n’est pas la plaque', () => {
    const g = setup(2, [DOMINO]);
    expect(g.place('p1', 0, at(DOMINO, 5, 4), [4, 4])).toBeTruthy();
    expect(g.place('p0', 0, at(I3, 5, 4), [4, 4])).toMatch(/forme/);
    expect(g.place('p0', 0, [[5, 4], [7, 4]], [4, 4])).toMatch(/forme/);
  });
  it('accepte la plaque tournée et retournée', () => {
    const g = setup(2, [L3]);
    expect(g.place('p0', 0, [[5, 5], [5, 4], [6, 5]], [4, 4])).toBeUndefined();
  });
});

describe('la file et les bons', () => {
  it('avance d’une plaque à chaque tour, la même pour tout le monde', () => {
    const g = setup(2, [DOMINO, I3]);
    g.place('p0', 0, at(DOMINO, 1, 1), [0, 1]);
    expect(g.queue[0].id).toBe(1001);
    expect(g.place('p1', 0, at(I3, 8, 8), [7, 8])).toBeUndefined();
    expect(g.round).toBe(2);
    expect(g.turn).toBe('p0');
  });
  it('un bon prend l’une des cinq suivantes ; les plaques sautées repartent en bout de file', () => {
    const g = setup(2, [DOMINO, I3, L3, O4, DOMINO, I3, L3]);
    const ids0 = g.queue.slice(0, 7).map((t) => t.id);
    const total = g.queue.length;
    expect(g.place('p0', 6, at(L3, 1, 1), [0, 1])).toMatch(/portée/);
    expect(g.place('p0', 3, at(O4, 1, 1), [0, 1])).toBeUndefined();
    expect(g.coupons.get('p0')).toBe(0);
    expect(g.seeds.get('p0')).toBe(3);
    expect(g.queue).toHaveLength(total - 1);
    expect(g.queue[0].id).toBe(ids0[4]);
    expect(g.queue.slice(-3).map((t) => t.id)).toEqual(ids0.slice(0, 3));
    const e = g.events.at(-1)!;
    expect(e.paid).toBe('coupon');
    expect(e.k).toBe(3);
  });
  it('sans bon, l’échange coûte une graine', () => {
    const g = setup(2, [DOMINO, I3]);
    g.coupons.set('p0', 0);
    expect(g.place('p0', 1, at(I3, 1, 1), [0, 1])).toBeUndefined();
    expect(g.seeds.get('p0')).toBe(2);
    expect(g.events.at(-1)!.paid).toBe('seed');
  });
  it('sans bon ni graine, on prend la plaque du tour', () => {
    const g = setup(2, [DOMINO, I3]);
    g.coupons.set('p0', 0);
    g.seeds.set('p0', 0);
    expect(g.place('p0', 1, at(I3, 1, 1), [0, 1])).toMatch(/bon/);
  });
  it('se vendent contre une graine et se donnent à tout moment', () => {
    const g = setup(2);
    expect(g.buyCoupon('p1')).toBeUndefined();
    expect(g.seeds.get('p1')).toBe(2);
    expect(g.coupons.get('p1')).toBe(2);
    expect(g.giveCoupon('p1', 'p0')).toBeUndefined();
    expect(g.coupons.get('p0')).toBe(2);
    expect(g.coupons.get('p1')).toBe(1);
    expect(g.giveCoupon('p1', 'p1')).toBeTruthy();
    expect(g.giveCoupon('p1', 'inconnu')).toBeTruthy();
    expect(g.buyCoupon('inconnu')).toBeTruthy();
    g.coupons.set('p1', 0);
    expect(g.giveCoupon('p1', 'p0')).toBeTruthy();
  });
  it('renoncer fait disparaître la plaque du tour', () => {
    const g = setup(2, [DOMINO, I3]);
    expect(g.discard('p1')).toBeTruthy();
    expect(g.discard('p0')).toBeUndefined();
    expect(g.queue[0].id).toBe(1001);
    expect(g.turn).toBe('p1');
    expect(g.events.at(-1)).toMatchObject({ type: 'discard', why: 'choice' });
  });
  it('le temps écoulé fait perdre la plaque', () => {
    const g = setup(2, [DOMINO, I3]);
    g.timeout();
    expect(g.queue[0].id).toBe(1001);
    expect(g.events.at(-1)).toMatchObject({ type: 'discard', why: 'time' });
  });
  it('passe d’office le tour de qui n’a plus aucune place, et le signale', () => {
    const g = setup(2, [DOMINO]);
    g.place('p0', 0, at(DOMINO, 1, 0), [0, 0]);
    g.seeds.set('p0', 0);
    g.coupons.set('p0', 0);
    // p1 enferme p0 dans son coin avant le deuxième tour.
    g.board.setOwner([[0, 1], [1, 1], [2, 1], [3, 1], [3, 0]], 1);
    g.queue.unshift({ id: 2000, shape: shapeIndex(DOMINO) }, { id: 2001, shape: shapeIndex(I3) });
    g.place('p1', 0, [[5, 5], [6, 5]], [4, 5]);
    expect(g.turn).toBe('p1');
    expect(g.round).toBe(2);
    expect(g.events.at(-1)).toMatchObject({ type: 'discard', player: 'p0', why: 'stuck' });
  });
});

/** p0 a un C autour de (x, y) ; il lui reste la case à droite à remplir. */
function aroundSpecial(g: Game, x: number, y: number, kind: 'coupon' | 'seed' | 'stone' | 'steal'): void {
  g.board.special.set(g.board.index(x, y), kind);
  g.place('p0', 0, [[x - 1, y], [x - 1, y + 1]], [x - 1, y - 1]);
  g.place('p1', 0, at(DOMINO, 12, 12), [11, 12]);
  g.place('p0', 0, [[x, y - 1], [x + 1, y - 1]]);
  g.place('p1', 0, at(DOMINO, 12, 13), [11, 13]);
  g.place('p0', 0, [[x, y + 1], [x + 1, y + 1]]);
  g.place('p1', 0, at(DOMINO, 12, 14), [11, 14]);
}

describe('les cases spéciales', () => {
  const dominos = () => Array.from({ length: 9 }, () => DOMINO);

  it('activent leur effet une fois entourées sur les quatre côtés', () => {
    const g = setup(2, dominos());
    g.board.special.set(g.board.index(3, 3), 'coupon');
    g.place('p0', 0, [[2, 3], [2, 4]], [2, 2]);
    g.place('p1', 0, at(DOMINO, 12, 12), [11, 12]);
    g.place('p0', 0, [[3, 2], [4, 2]]);
    g.place('p1', 0, at(DOMINO, 12, 13), [11, 13]);
    g.place('p0', 0, [[3, 4], [4, 4]]);
    g.place('p1', 0, at(DOMINO, 12, 14), [11, 14]);
    expect(g.coupons.get('p0')).toBe(1);
    expect(g.place('p0', 0, [[4, 3], [5, 3]])).toBeUndefined();
    expect(g.coupons.get('p0')).toBe(2);
    expect(g.board.special.size).toBe(0);
    expect(g.board.owner[g.board.index(3, 3)]).toBe(0);
    expect([...g.tiles.values()].some((t) => t.kind === 'special')).toBe(true);
    expect(g.events.at(-1)!.activated).toEqual(['coupon']);
  });
  it('rapportent une graine', () => {
    const g = setup(2, dominos());
    aroundSpecial(g, 3, 3, 'seed');
    g.place('p0', 0, [[4, 3], [5, 3]]);
    expect(g.seeds.get('p0')).toBe(4);
  });
  it('disparaissent si une plaque les recouvre', () => {
    const g = setup(2, [DOMINO]);
    g.board.special.set(g.board.index(5, 4), 'seed');
    g.place('p0', 0, at(DOMINO, 5, 4), [4, 4]);
    expect(g.board.special.size).toBe(0);
    expect(g.seeds.get('p0')).toBe(3);
  });
  it('la pierre se pose sur une case libre, et ne s’y construit rien', () => {
    const g = setup(2, dominos());
    aroundSpecial(g, 3, 3, 'stone');
    g.place('p0', 0, [[4, 3], [5, 3]]);
    expect(g.stage).toBe('stone');
    expect(g.turn).toBe('p0');
    expect(g.placeStone('p1', 9, 9)).toBeTruthy();
    expect(g.placeStone('p0', 3, 3)).toBeTruthy();
    expect(g.placeStone('p0', 99, 0)).toBeTruthy();
    expect(g.placeStone('p0', 6, 3)).toBeUndefined();
    expect(g.stage).toBe('place');
    expect(g.turn).toBe('p1');
    expect(g.board.check([[6, 3]], 0)).toBe('stone');
  });
  it('la pierre se retire pour une graine, pendant son tour', () => {
    const g = setup(2, dominos());
    aroundSpecial(g, 3, 3, 'stone');
    g.place('p0', 0, [[4, 3], [5, 3]]);
    g.placeStone('p0', 6, 3);
    expect(g.removeStone('p0', 6, 3)).toBeTruthy();
    expect(g.removeStone('p1', 5, 5)).toBeTruthy();
    expect(g.removeStone('p1', 6, 3)).toBeUndefined();
    expect(g.seeds.get('p1')).toBe(2);
    expect(g.turn).toBe('p1');
    expect(g.board.stone[g.board.index(6, 3)]).toBe(0);
  });
  it('l’arrachage prend la plaque d’un autre, à replanter chez soi', () => {
    const g = setup(2, dominos());
    aroundSpecial(g, 3, 3, 'steal');
    const enemy = [...g.tiles.values()].find((t) => t.owner === 'p1' && t.kind === 'tile')!;
    const base = [...g.tiles.values()].find((t) => t.owner === 'p1' && t.kind === 'base')!;
    g.place('p0', 0, [[4, 3], [5, 3]]);
    expect(g.stage).toBe('steal');
    expect(g.steal('p0', base.id)).toBeTruthy();
    expect(g.steal('p1', enemy.id)).toBeTruthy();
    expect(g.steal('p0', enemy.id)).toBeUndefined();
    expect(g.stage).toBe('stealPlace');
    expect(g.tiles.has(enemy.id)).toBe(false);
    expect(g.board.owner[g.board.index(enemy.cells[0][0], enemy.cells[0][1])]).toBe(-1);
    expect(g.placeStolen('p0', [[9, 3], [10, 3]])).toBeTruthy();
    expect(g.placeStolen('p0', [[6, 3], [7, 3], [8, 3]])).toBeTruthy();
    expect(g.placeStolen('p0', [[6, 3], [7, 3]])).toBeUndefined();
    expect(g.stage).toBe('place');
    expect(g.turn).toBe('p1');
    expect(g.stolen).toBeNull();
    expect(g.board.owner[g.board.index(6, 3)]).toBe(0);
  });
  it('la plaque arrachée est perdue s’il n’y a nulle part où la mettre', () => {
    const g = setup(2, dominos());
    aroundSpecial(g, 3, 3, 'steal');
    const enemy = [...g.tiles.values()].find((t) => t.owner === 'p1' && t.kind === 'tile')!;
    g.place('p0', 0, [[4, 3], [5, 3]]);
    g.steal('p0', enemy.id);
    expect(g.skipEffect('p0')).toBeUndefined();
    expect(g.stolen).toBeNull();
    expect(g.stage).toBe('place');
    expect(g.events.at(-1)!.type).toBe('stealLost');
  });
  it('on peut renoncer à un effet, ou le perdre faute de temps', () => {
    const g = setup(2, dominos());
    aroundSpecial(g, 3, 3, 'stone');
    g.place('p0', 0, [[4, 3], [5, 3]]);
    g.timeout();
    expect(g.stage).toBe('place');
    expect(g.turn).toBe('p1');
    expect(g.events.at(-1)).toMatchObject({ type: 'skip', why: 'time' });
  });
  it('sans plaque à arracher, l’effet tombe tout seul', () => {
    const g = setup(2, dominos());
    g.board.special.set(g.board.index(3, 3), 'steal');
    g.discard('p0');
    g.discard('p1');
    g.place('p0', 0, [[2, 3], [2, 4]], [2, 2]);
    g.discard('p1');
    g.place('p0', 0, [[3, 2], [4, 2]]);
    g.discard('p1');
    g.place('p0', 0, [[3, 4], [4, 4]]);
    g.discard('p1');
    g.place('p0', 0, [[4, 3], [5, 3]]);
    expect(g.stage).toBe('place');
    expect(g.turn).toBe('p1');
  });
});

describe('les mottes et la fin', () => {
  /** Une partie d'une seule manche, jusqu'aux achats. */
  function buying(): Game {
    const g = setup(2, [DOMINO, DOMINO], 1);
    g.place('p0', 0, at(DOMINO, 1, 1), [0, 1]);
    g.place('p1', 0, at(DOMINO, 12, 12), [11, 12]);
    return g;
  }
  it('s’achètent après la dernière manche, dans l’ordre', () => {
    const g = buying();
    expect(g.stage).toBe('buy');
    expect(g.turn).toBe('p0');
    expect(g.buyPlug('p1', 13, 11)).toBeTruthy();
    expect(g.buyPlug('p0', 9, 9)).toBeTruthy();
    expect(g.buyPlug('p0', 1, 0)).toBeUndefined();
    expect(g.seeds.get('p0')).toBe(2);
    expect(g.turn).toBe('p0');
    expect(g.endBuy('p0')).toBeUndefined();
    expect(g.turn).toBe('p1');
  });
  it('passent à la suite quand il n’y a plus de graine', () => {
    const g = buying();
    g.seeds.set('p0', 1);
    g.buyPlug('p0', 1, 0);
    expect(g.turn).toBe('p1');
  });
  it('sautent qui n’a pas de graine', () => {
    const g = setup(2, [DOMINO, DOMINO], 1);
    g.seeds.set('p0', 0);
    g.place('p0', 0, at(DOMINO, 1, 1), [0, 1]);
    g.place('p1', 0, at(DOMINO, 12, 12), [11, 12]);
    expect(g.stage).toBe('buy');
    expect(g.turn).toBe('p1');
    g.endBuy('p1');
    expect(g.stage).toBe('over');
    expect(g.turn).toBeNull();
  });
  it('peuvent activer une case spéciale', () => {
    const g = setup(2, [DOMINO, DOMINO], 1);
    g.board.special.set(g.board.index(1, 2), 'seed');
    g.place('p0', 0, [[0, 2], [0, 3]], [0, 1]);
    g.place('p1', 0, at(DOMINO, 12, 12), [11, 12]);
    g.buyPlug('p0', 1, 1);
    g.buyPlug('p0', 2, 1);
    g.buyPlug('p0', 2, 2);
    expect(g.seeds.get('p0')).toBe(0);
    expect(g.turn).toBe('p1');
    const h = setup(2, [DOMINO, DOMINO], 1);
    h.board.special.set(h.board.index(1, 2), 'seed');
    h.seeds.set('p0', 5);
    h.place('p0', 0, [[0, 2], [0, 3]], [0, 1]);
    h.place('p1', 0, at(DOMINO, 12, 12), [11, 12]);
    h.buyPlug('p0', 1, 1);
    h.buyPlug('p0', 2, 1);
    h.buyPlug('p0', 2, 2);
    h.buyPlug('p0', 2, 3);
    h.buyPlug('p0', 1, 3);
    expect(h.seeds.get('p0')).toBe(1);
    expect(h.events.at(-1)!.activated).toEqual(['seed']);
  });
});

describe('les comptes', () => {
  function square(g: Game, id: string, x: number, y: number, k: number): void {
    const cells: Cell[] = [];
    for (let cy = y; cy < y + k; cy++) for (let cx = x; cx < x + k; cx++) cells.push([cx, cy]);
    g.board.setOwner(cells, g.rank(id));
  }
  it('un carré de 5 ne change rien, chaque case de côté vaut une graine', () => {
    expect([2, 3, 4, 5, 6, 7, 8].map(squareReward)).toEqual([-3, -2, -1, 0, 1, 2, 3]);
  });
  it('la prime va au plus grand carré', () => {
    const g = new Game(ids(3));
    g.board.special.clear();
    square(g, 'p0', 0, 0, 6);
    square(g, 'p1', 8, 0, 5);
    square(g, 'p2', 0, 8, 4);
    g.seeds.set('p0', 1);
    g.seeds.set('p1', 4);
    g.seeds.set('p2', 6);
    const s = g.standings();
    expect(s.map((r) => [r.id, r.reward, r.prize, r.total, r.place])).toEqual([
      ['p0', 1, 3, 5, 1],
      ['p2', -1, 0, 5, 2],
      ['p1', 0, 0, 4, 3],
    ]);
  });
  it('la prime se partage quand elle se divise', () => {
    const g = new Game(ids(4));
    g.board.special.clear();
    for (const [i, id] of ['p0', 'p1', 'p2'].entries()) square(g, id, i * 6, 0, 5);
    square(g, 'p3', 0, 8, 3);
    const s = g.standings();
    expect(s.filter((r) => r.square.k === 5).every((r) => r.prize === 1)).toBe(true);
    expect(s.find((r) => r.id === 'p3')!.prize).toBe(0);
  });
  it('et personne ne la touche quand elle ne se divise pas', () => {
    const g = new Game(ids(3));
    g.board.special.clear();
    square(g, 'p0', 0, 0, 5);
    square(g, 'p1', 8, 0, 5);
    square(g, 'p2', 0, 8, 3);
    expect(g.standings().every((r) => r.prize === 0)).toBe(true);
  });
  it('les égalités partagent la place', () => {
    const g = new Game(ids(2));
    g.board.special.clear();
    square(g, 'p0', 0, 0, 3);
    square(g, 'p1', 8, 8, 3);
    const s = g.standings();
    expect(s.map((r) => r.place)).toEqual([1, 1]);
  });
});

describe('des parties complètes', () => {
  /** Le terrain doit toujours être cohérent : pas de plaque à cheval, personne au contact d'un autre. */
  function audit(g: Game): void {
    const seen = new Map<string, string>();
    for (const t of g.tiles.values()) {
      for (const [x, y] of t.cells) {
        expect(g.board.inside(x, y)).toBe(true);
        expect(seen.has(`${x},${y}`)).toBe(false);
        seen.set(`${x},${y}`, t.owner);
        expect(g.board.owner[g.board.index(x, y)]).toBe(g.rank(t.owner));
        expect(g.board.stone[g.board.index(x, y)]).toBe(0);
      }
    }
    for (const [key, owner] of seen) {
      const [x, y] = key.split(',').map(Number);
      for (const [nx, ny] of [[x + 1, y], [x, y + 1]]) {
        const o = seen.get(`${nx},${ny}`);
        // Une case spéciale entourée ou une pierre ne change rien à cette règle.
        if (o) expect(o).toBe(owner);
      }
    }
    for (const id of g.order) {
      expect(g.seeds.get(id)).toBeGreaterThanOrEqual(0);
      expect(g.coupons.get(id)).toBeGreaterThanOrEqual(0);
    }
  }

  for (const n of [2, 3, 5, 8]) {
    it(`à ${n} joueurs, jusqu'au bout, sans geste refusé`, () => {
      for (let round = 0; round < 3; round++) {
        const g = new Game(ids(n), { rounds: round === 2 ? 6 : 9 });
        const skills = new Map(ids(n).map((id) => [id, randomSkill()]));
        for (let guard = 0; guard < 2000 && g.stage !== 'over'; guard++) {
          const id = g.turn!;
          const err = applyAction(g, id, decide(g, id, skills.get(id)!));
          expect(err).toBeUndefined();
          audit(g);
        }
        expect(g.stage).toBe('over');
        const s = g.standings();
        expect(s).toHaveLength(n);
        expect(s[0].place).toBe(1);
        for (const r of s) expect(r.total).toBe(r.before + r.reward + r.prize);
      }
    }, 60_000);
  }

  it('le temps écoulé à chaque geste finit quand même la partie', () => {
    const g = new Game(ids(4));
    for (let guard = 0; guard < 2000 && g.stage !== 'over'; guard++) g.timeout();
    expect(g.stage).toBe('over');
    expect(g.standings().every((r) => r.square.k === 0)).toBe(true);
  });
});
