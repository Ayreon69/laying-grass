// Simulation : des bots entre eux, pour juger leur niveau et leur vitesse (npx tsx test/sim.ts 40).
import { SHAPES, type Cell } from '../shared/shapes';
import { AUTOPILOT, applyAction, decide, randomSkill, type BotAction, type Skill } from '../server/bots';
import { Game } from '../server/game';

const N = Number(process.argv[2] ?? 40);

type Brain = 'bot' | 'auto' | 'naive';

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

/** Le jardinier du dimanche : il pose la plaque du tour n'importe où, ne dépense rien, et prend ce qui se présente. */
function naive(g: Game, id: string): BotAction {
  const me = g.rank(id);
  if (g.stage === 'place') {
    const head = g.head!;
    if (g.isRooted(id)) {
      const spots = g.board.placements(SHAPES[head.shape], me);
      return spots.length ? { type: 'place', k: 0, cells: pick(spots).cells } : { type: 'discard' };
    }
    const base: Cell = [2 + Math.floor(Math.random() * (g.size - 4)), 2 + Math.floor(Math.random() * (g.size - 4))];
    if (g.board.checkBase(base[0], base[1], me)) return { type: 'discard' };
    const test = g.board.clone();
    test.setOwner([base], me);
    const spots = test.placements(SHAPES[head.shape], me);
    return spots.length ? { type: 'place', k: 0, cells: pick(spots).cells, base } : { type: 'discard' };
  }
  if (g.stage === 'steal') return { type: 'steal', tileId: pick(g.stealable(id)).id };
  if (g.stage === 'stealPlace') {
    const spots = g.board.placements(g.stolen!, me);
    return spots.length ? { type: 'stolen', cells: pick(spots).cells } : { type: 'skip' };
  }
  if (g.stage === 'stone') {
    const [x, y] = pick(g.stoneSpots());
    return { type: 'stone', x, y };
  }
  return { type: 'endBuy' };
}

function play(order: string[], brain: (id: string) => Brain, rounds = 9): { game: Game; ms: number; worst: number; decisions: number } {
  const g = new Game(order, { rounds });
  const skills = new Map<string, Skill>(order.map((id) => [id, brain(id) === 'bot' ? randomSkill() : AUTOPILOT]));
  let ms = 0;
  let worst = 0;
  let decisions = 0;
  for (let guard = 0; guard < 3000 && g.stage !== 'over'; guard++) {
    const id = g.turn!;
    const t = performance.now();
    const action = brain(id) === 'naive' ? naive(g, id) : decide(g, id, skills.get(id)!);
    const spent = performance.now() - t;
    ms += spent;
    worst = Math.max(worst, spent);
    decisions++;
    const err = applyAction(g, id, action);
    if (err) throw new Error(`${err} : ${JSON.stringify(action)}`);
  }
  if (g.stage !== 'over') throw new Error('partie sans fin');
  return { game: g, ms, worst, decisions };
}

for (const n of [2, 3, 4, 5, 6, 8]) {
  const order = Array.from({ length: n }, (_, i) => `p${i}`);
  let ms = 0;
  let worst = 0;
  let decisions = 0;
  let squares = 0;
  let totals = 0;
  const sizes = new Map<number, number>();
  const spent = { coupons: 0, seeds: 0, plugs: 0, steals: 0, stones: 0 };
  const duel = { place: 0, first: 0, square: 0 };
  const auto = { place: 0, first: 0 };
  for (let k = 0; k < N; k++) {
    const r = play(order, () => 'bot');
    ms += r.ms;
    worst = Math.max(worst, r.worst);
    decisions += r.decisions;
    for (const s of r.game.standings()) {
      squares += s.square.k;
      totals += s.total;
      sizes.set(s.square.k, (sizes.get(s.square.k) ?? 0) + 1);
    }
    for (const t of r.game.tiles.values()) if (t.kind === 'plug') spent.plugs++;
    // p0 réfléchit, les autres posent au hasard : la réflexion doit payer.
    const d = play(order, (id) => (id === 'p0' ? 'bot' : 'naive')).game.standings().find((s) => s.id === 'p0')!;
    duel.place += d.place;
    duel.square += d.square.k;
    if (d.place === 1) duel.first++;
    const a = play(order, (id) => (id === 'p0' ? 'auto' : 'naive')).game.standings().find((s) => s.id === 'p0')!;
    auto.place += a.place;
    if (a.place === 1) auto.first++;
  }
  const seats = N * n;
  const dist = [...sizes.entries()].sort((a, b) => a[0] - b[0]).map(([k, c]) => `${k}:${Math.round((c / seats) * 100)}%`).join(' ');
  console.log(
    `${n} joueurs (${order.length * 9} plaques) : ${(ms / decisions).toFixed(1)} ms/geste, pire ${worst.toFixed(0)} ms. ` +
      `Carré moyen ${(squares / seats).toFixed(2)} (${dist}), ${(totals / seats).toFixed(1)} graines à la fin, ${(spent.plugs / seats).toFixed(1)} mottes par joueur. ` +
      `Bot contre ${n - 1} jardiniers au hasard : place ${(duel.place / N).toFixed(2)}, premier ${Math.round((duel.first / N) * 100)} %, carré ${(duel.square / N).toFixed(2)}. ` +
      `Pilote automatique : place ${(auto.place / N).toFixed(2)}, premier ${Math.round((auto.first / N) * 100)} %.`,
  );
}
