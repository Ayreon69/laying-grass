// Ce que tient le joueur dont c'est le tour : la plaque choisie, son orientation, sa place, et si la pose est permise.
import { useCallback, useLayoutEffect, useMemo, useState } from 'react';
import { PLACE_ERRORS, boardFromView, type Board } from '../../../shared/board';
import { COUPON_REACH, type RoomView } from '../../../shared/protocol';
import { SHAPES, flip as flipShape, orientations, rotate as rotateShape, type Cell } from '../../../shared/shapes';
import { send } from '../net';
import { sfx } from './sound';
import { vibrate } from './util';

/**
 * none : rien à faire. base : choisir où planter sa première touffe. tile : poser une plaque de la file.
 * stolen : replanter la plaque arrachée. stone : poser une pierre. plug : acheter une motte.
 * steal : choisir la plaque à arracher. removeStone : choisir la pierre à retirer.
 */
export type Mode = 'none' | 'base' | 'tile' | 'stolen' | 'stone' | 'plug' | 'steal' | 'removeStone';

const SINGLE: Cell[] = [[0, 0]];

export const holdsGhost = (m: Mode) => m === 'base' || m === 'tile' || m === 'stolen' || m === 'stone' || m === 'plug';

function extent(cells: readonly Cell[]): [number, number] {
  return [Math.max(...cells.map((c) => c[0])) + 1, Math.max(...cells.map((c) => c[1])) + 1];
}

function refusal(mode: Mode, b: Board, cells: Cell[], rank: number): string | null {
  if (mode === 'base') {
    const err = b.checkBase(cells[0][0], cells[0][1], rank);
    return err && PLACE_ERRORS[err];
  }
  if (mode === 'stone') {
    const [x, y] = cells[0];
    if (!b.inside(x, y)) return PLACE_ERRORS.edge;
    const i = b.index(x, y);
    if (b.owner[i] !== -1) return PLACE_ERRORS.taken;
    if (b.stone[i]) return PLACE_ERRORS.stone;
    return b.special.has(i) ? 'La pierre ne va pas sur une case spéciale.' : null;
  }
  const err = b.check(cells, rank);
  return err && PLACE_ERRORS[err];
}

const at = (ori: readonly Cell[], pos: Cell): Cell[] => ori.map(([x, y]): Cell => [x + pos[0], y + pos[1]]);

/** La place permise la plus proche, en s'éloignant peu à peu du point visé. */
function nearest(mode: Mode, b: Board, ori: Cell[], from: Cell, rank: number, reach: number): Cell | null {
  const [w, h] = extent(ori);
  const maxX = b.size - w;
  const maxY = b.size - h;
  for (let r = 0; r <= reach; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const x = from[0] + dx;
        const y = from[1] + dy;
        if (x < 0 || y < 0 || x > maxX || y > maxY) continue;
        if (!refusal(mode, b, at(ori, [x, y]), rank)) return [x, y];
      }
    }
  }
  return null;
}

export function usePlanter(view: RoomView) {
  const g = view.game!;
  const me = view.me;
  const rank = g.order.indexOf(me);
  const myTurn = g.turn === me;
  const rooted = g.tiles.some((t) => t.owner === me && t.kind === 'base');
  const board = useMemo(() => boardFromView(g.size, g.tiles, g.order, g.stones, g.specials), [g]);

  const [k, setK] = useState(0);
  const [base, setBase] = useState<Cell | null>(null);
  const [ori, setOri] = useState<Cell[]>(SINGLE);
  const [pos, setPos] = useState<Cell>([0, 0]);
  const [stealId, setStealId] = useState<number | null>(null);
  const [removing, setRemoving] = useState(false);
  const [busy, setBusy] = useState(false);

  // Chaque geste accepté remet la main à zéro.
  const [seen, setSeen] = useState(g.seq);
  if (seen !== g.seq) {
    setSeen(g.seq);
    setK(0);
    setBase(null);
    setStealId(null);
    setRemoving(false);
    setBusy(false);
  }

  let mode: Mode = 'none';
  if (myTurn) {
    if (g.stage === 'place') mode = removing ? 'removeStone' : !rooted && !base ? 'base' : 'tile';
    else if (g.stage === 'steal') mode = 'steal';
    else if (g.stage === 'stealPlace') mode = 'stolen';
    else if (g.stage === 'stone') mode = 'stone';
    else if (g.stage === 'buy') mode = removing ? 'removeStone' : 'plug';
  }

  /** Le terrain tel que le voit la plaque : avec la touffe qu'on vient de choisir. */
  const work = useMemo(() => {
    if (!base) return board;
    const c = board.clone();
    c.setOwner([base], rank);
    return c;
  }, [board, base, rank]);

  const queueTile = g.queue[Math.min(k, Math.max(0, g.queue.length - 1))];
  const shape: Cell[] = mode === 'tile' && queueTile ? SHAPES[queueTile.shape] : mode === 'stolen' && g.stolen ? g.stolen : SINGLE;
  const shapeKeyNow = mode === 'tile' ? `q${queueTile?.id}` : mode === 'stolen' ? 'stolen' : 'one';

  const centroid = useCallback((): Cell => {
    let sx = 0;
    let sy = 0;
    let n = 0;
    work.owner.forEach((o, i) => {
      if (o !== rank) return;
      sx += i % work.size;
      sy += Math.floor(i / work.size);
      n++;
    });
    return n ? [Math.round(sx / n), Math.round(sy / n)] : [Math.floor(work.size / 2), Math.floor(work.size / 2)];
  }, [work, rank]);

  // Quand la main change, la plaque se met à la place permise la plus proche de ton gazon.
  useLayoutEffect(() => {
    if (!holdsGhost(mode)) return;
    const [cx, cy] = centroid();
    const options = orientations(shape);
    for (const o of options) {
      const [w, h] = extent(o);
      const found = nearest(mode, work, o, [cx - Math.floor(w / 2), cy - Math.floor(h / 2)], rank, work.size);
      if (found) {
        setOri(o);
        setPos(found);
        return;
      }
    }
    const o = options[0];
    const [w, h] = extent(o);
    setOri(o);
    setPos([Math.max(0, Math.min(work.size - w, cx - Math.floor(w / 2))), Math.max(0, Math.min(work.size - h, cy - Math.floor(h / 2)))]);
    // Elle ne se replace que si la plaque ou l'étape changent, pas quand le terrain bouge pendant qu'on la tient.
  }, [g.seq, mode, shapeKeyNow, base]); // eslint-disable-line react-hooks/exhaustive-deps

  const [w, h] = extent(ori);
  const clamp = useCallback(
    (p: Cell, o: readonly Cell[] = ori): Cell => {
      const [ow, oh] = extent(o);
      return [Math.max(0, Math.min(g.size - ow, p[0])), Math.max(0, Math.min(g.size - oh, p[1]))];
    },
    [g.size, ori],
  );

  // Un instant, la plaque peut être d'une autre forme que la main (le temps de l'effet ci-dessus) : on se fie à la forme courante.
  const consistent = ori.length === shape.length;
  const cells = useMemo(() => at(ori, pos), [ori, pos]);
  const error = holdsGhost(mode) && consistent ? refusal(mode, work, cells, rank) : null;
  const ok = holdsGhost(mode) && consistent && !error;

  const move = useCallback((p: Cell) => setPos(clamp(p)), [clamp]);

  /** Au lâcher, la plaque rejoint la place permise la plus proche du point visé, si elle est à portée. */
  const snap = useCallback(
    (reach = 3, from: Cell = pos) => {
      if (!holdsGhost(mode)) return;
      const start = clamp(from);
      setPos(nearest(mode, work, ori, start, rank, reach) ?? start);
    },
    [mode, work, ori, pos, rank, clamp],
  );

  const turn = useCallback(
    (next: Cell[]) => {
      // La plaque tourne autour de son centre.
      const [nw, nh] = extent(next);
      const p = clamp([Math.round(pos[0] + w / 2 - nw / 2), Math.round(pos[1] + h / 2 - nh / 2)], next);
      setOri(next);
      const found = nearest(mode, work, next, p, rank, 2);
      setPos(found ?? p);
      sfx.flop();
    },
    [clamp, pos, w, h, mode, work, rank],
  );
  const rotate = useCallback(() => turn(rotateShape(ori)), [turn, ori]);
  const flip = useCallback(() => turn(flipShape(ori)), [turn, ori]);

  const coupons = g.coupons[me] ?? 0;
  const seeds = g.seeds[me] ?? 0;
  const paysWith: 'coupon' | 'seed' | null = coupons > 0 ? 'coupon' : seeds > 0 ? 'seed' : null;
  const canReach = useCallback((i: number) => i === 0 || (i <= COUPON_REACH && i < g.queue.length && paysWith !== null), [g.queue.length, paysWith]);

  const choose = useCallback(
    (i: number) => {
      if (!canReach(i) || i === k) return;
      setK(i);
      sfx.tap();
    },
    [canReach, k],
  );

  /** La plaque choisie a-t-elle une place, dans une orientation ou une autre ? */
  const hasSpot = useMemo(() => (mode === 'tile' || mode === 'stolen' ? work.canPlace(shape, rank) : true), [mode, work, shape, rank]);

  const act = useCallback(
    async (event: string, payload: Record<string, unknown>) => {
      setBusy(true);
      const done = await send(event, { ...payload, seq: g.seq });
      if (!done) setBusy(false);
      return done;
    },
    [g.seq],
  );

  const confirm = useCallback(() => {
    if (busy) return;
    if (mode === 'steal') {
      if (stealId === null) return;
      sfx.rip();
      void act('game:steal', { tileId: stealId });
      return;
    }
    if (!ok) {
      sfx.nope();
      vibrate(30);
      return;
    }
    if (mode === 'base') {
      setBase(pos);
      sfx.plop();
      vibrate(15);
      return;
    }
    vibrate(20);
    if (mode === 'tile') void act('game:place', { k, cells, base });
    else if (mode === 'stolen') void act('game:stolen', { cells });
    else if (mode === 'stone') void act('game:stone', { cell: cells[0] });
    else if (mode === 'plug') void act('game:plug', { cell: cells[0] });
  }, [busy, mode, stealId, ok, act, pos, k, cells, base]);

  const discard = useCallback(() => void act('game:discard', {}), [act]);
  const skip = useCallback(() => void act('game:skip', {}), [act]);
  const endBuy = useCallback(() => void act('game:endBuy', {}), [act]);
  const unbase = useCallback(() => setBase(null), []);
  const pickSteal = useCallback((id: number) => {
    setStealId(id);
    sfx.tap();
  }, []);
  const removeStone = useCallback((cell: Cell) => {
    void send('game:removeStone', { cell });
    setRemoving(false);
  }, []);

  return {
    g,
    mode,
    myTurn,
    rank,
    rooted,
    board,
    work,
    base,
    k,
    ori,
    pos,
    cells,
    size: [w, h] as const,
    ok,
    error,
    busy,
    hasSpot,
    stealId,
    removing,
    coupons,
    seeds,
    paysWith,
    canReach,
    choose,
    move,
    snap,
    rotate,
    flip,
    confirm,
    discard,
    skip,
    endBuy,
    unbase,
    pickSteal,
    setRemoving,
    removeStone,
  };
}

export type Planter = ReturnType<typeof usePlanter>;
