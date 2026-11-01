// Test de bout en bout sur le serveur compilé : 3 humains (socket.io) + 2 bots jouent une partie complète,
// un spectateur arrive en cours de route, un joueur se déconnecte puis revient ; puis une revanche à 8, la table pleine.
// Les règles sont réécrites ici, sans le code du moteur : à chaque état reçu, on revérifie le terrain et les comptes.
// Usage : npm run build && npm run e2e
import { spawn } from 'node:child_process';
import { io } from 'socket.io-client';

const PORT = 3900 + Math.floor(Math.random() * 90);
const URL = `http://localhost:${PORT}`;
const server = spawn(process.execPath, ['dist/server/index.mjs'], {
  env: { ...process.env, PORT: String(PORT), LG_FAST: '1' },
  stdio: ['ignore', 'pipe', 'inherit'],
});
const fail = (msg) => {
  console.error(`✗ ${msg}`);
  server.kill();
  process.exit(1);
};
setTimeout(() => fail('délai dépassé (3 min)'), 180_000).unref();

await new Promise((resolve) => server.stdout.on('data', (d) => String(d).includes('prêt') && resolve()));

const stats = { states: 0, placed: 0, coupons: 0, seeds: 0, refused: 0, late: 0, steals: 0, stones: 0, plugs: 0, bought: 0, given: 0, removed: 0, stuck: 0, activated: 0 };
const SIDES = [[1, 0], [-1, 0], [0, 1], [0, -1]];

function client(name, { player = true, avatar = 'escargot' } = {}) {
  const socket = io(URL, { transports: ['websocket'], forceNew: true });
  const c = { name, socket, view: null, avatar, player, session: null };
  socket.on('state', (v) => {
    c.view = v;
    audit(c, v);
    if (c.player) play(c);
  });
  c.call = (event, payload = {}) => new Promise((res) => socket.emit(event, payload, res));
  return c;
}

function grid(g) {
  const owner = new Map();
  for (const t of g.tiles) for (const [x, y] of t.cells) owner.set(`${x},${y}`, t.owner);
  return owner;
}

/** Le terrain doit toujours respecter les règles, et rien de privé ne doit circuler. */
function audit(c, v) {
  stats.states++;
  const json = JSON.stringify(v);
  for (const word of ['"token":', '"skills":', '"sockets":', '"pending":', '"skill":']) if (json.includes(word)) fail(`la vue contient ${word}`);
  const g = v.game;
  if (v.phase !== 'playing' || !g) return;
  if (g.size !== 12 + 2 * g.order.length) fail(`terrain faux : ${g.size} pour ${g.order.length} joueurs`);
  if (g.round < 1 || g.round > g.rounds) fail(`manche ${g.round}/${g.rounds}`);
  const owner = new Map();
  const stones = new Set(g.stones.map(([x, y]) => `${x},${y}`));
  for (const t of g.tiles) {
    for (const [x, y] of t.cells) {
      if (x < 0 || y < 0 || x >= g.size || y >= g.size) fail(`plaque hors du terrain : ${x},${y}`);
      if (owner.has(`${x},${y}`)) fail(`deux plaques l'une sur l'autre en ${x},${y}`);
      if (stones.has(`${x},${y}`)) fail(`une plaque sur une pierre en ${x},${y}`);
      owner.set(`${x},${y}`, t.owner);
    }
  }
  for (const [key, who] of owner) {
    const [x, y] = key.split(',').map(Number);
    for (const [dx, dy] of SIDES) {
      const o = owner.get(`${x + dx},${y + dy}`);
      if (o && o !== who) fail(`deux gazons se touchent en ${x},${y}`);
    }
  }
  for (const s of g.specials) if (owner.has(`${s.x},${s.y}`)) fail('une case spéciale sur du gazon');
  const ids = new Set(g.queue.map((t) => t.id));
  if (ids.size !== g.queue.length) fail('une plaque en double dans la file');
  for (const id of g.order) {
    if (!(g.seeds[id] >= 0) || !(g.coupons[id] >= 0)) fail('des graines ou des bons négatifs');
    const bases = g.tiles.filter((t) => t.owner === id && t.kind === 'base').length;
    if (bases > 1) fail('deux premières touffes');
  }
  if (!g.order.includes(g.turn)) fail('le tour de personne');
  if ((g.stage === 'stealPlace') !== !!g.stolen) fail('plaque arrachée incohérente');
  for (const e of g.events) {
    if (e.why === 'stuck') stats.stuck++;
    if (e.activated?.length) stats.activated++;
  }
}

/** Toutes les orientations d'une forme, recalculées ici. */
function orient(cells) {
  const norm = (cs) => {
    const mx = Math.min(...cs.map((c) => c[0]));
    const my = Math.min(...cs.map((c) => c[1]));
    return cs.map(([x, y]) => [x - mx, y - my]).sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  };
  const seen = new Map();
  let cur = norm(cells);
  for (let f = 0; f < 2; f++) {
    for (let r = 0; r < 4; r++) {
      seen.set(JSON.stringify(cur), cur);
      cur = norm(cur.map(([x, y]) => [-y, x]));
    }
    cur = norm(cur.map(([x, y]) => [-x, y]));
  }
  return [...seen.values()];
}

/** Les poses permises, d'après les règles : sur le terrain, sans chevaucher, sans pierre, contre soi, jamais contre un autre. */
function legal(g, me, shape) {
  const owner = grid(g);
  const stones = new Set(g.stones.map(([x, y]) => `${x},${y}`));
  const ok = (x, y) => {
    if (x < 0 || y < 0 || x >= g.size || y >= g.size) return false;
    if (owner.has(`${x},${y}`) || stones.has(`${x},${y}`)) return false;
    return SIDES.every(([dx, dy]) => {
      const o = owner.get(`${x + dx},${y + dy}`);
      return !o || o === me;
    });
  };
  const out = [];
  for (const o of orient(shape)) {
    for (let oy = 0; oy < g.size; oy++) {
      for (let ox = 0; ox < g.size; ox++) {
        const cells = o.map(([x, y]) => [ox + x, oy + y]);
        if (!cells.every(([x, y]) => ok(x, y))) continue;
        if (cells.some(([x, y]) => SIDES.some(([dx, dy]) => owner.get(`${x + dx},${y + dy}`) === me))) out.push(cells);
      }
    }
  }
  return out;
}

const busy = new Set();
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

/** Les formes des plaques : la file n'en donne que l'indice, on compile donc `shared/shapes.ts` pour les retrouver. */
const shapesByIndex = await loadShapes();
async function loadShapes() {
  const { build } = await import('esbuild');
  const out = await build({ entryPoints: ['shared/shapes.ts'], bundle: true, write: false, format: 'esm', platform: 'node' });
  const url = `data:text/javascript;base64,${Buffer.from(out.outputFiles[0].text).toString('base64')}`;
  return (await import(url)).SHAPES;
}

/** Vise les cases spéciales : on veut voir tous leurs effets. */
function pickSpot(g, spots) {
  const specials = g.specials;
  let best = spots[0];
  let bestV = -Infinity;
  for (const cells of spots.slice(0, 400)) {
    let v = Math.random();
    for (const [x, y] of cells) {
      for (const s of specials) {
        if (s.x === x && s.y === y) v -= 2;
        else if (Math.abs(s.x - x) + Math.abs(s.y - y) === 1) v += 3;
      }
    }
    if (v > bestV) {
      bestV = v;
      best = cells;
    }
  }
  return best;
}

/** Un joueur moyen, qui tente aussi des coups interdits. */
function play(c) {
  const v = c.view;
  const g = v?.game;
  if (!v || v.phase !== 'playing' || !g || g.turn !== v.me) return;
  const me = v.me;
  const seq = g.seq;
  const key = (what) => `${c.name}:${what}:${seq}`;
  // Le coup de ce numéro est parti : un état plus ancien arrivé entre-temps ne doit plus rien déclencher.
  if (busy.has(key('moved'))) return;
  const shownAt = Date.now();
  const send = (key, event, payload, expectOk = true) => {
    if (busy.has(key)) return;
    busy.add(key);
    c.socket.emit(event, payload, (res) => {
      if (!res?.ok) stats.refused++;
      if (res?.ok === expectOk) return;
      // Ici, chaque humain n'a que 1,5 s : un coup peut arriver après la fin de son temps. Seul ce cas est permis.
      if (expectOk && g.endsAt && Date.now() - shownAt > 400 && /entre-temps|ton tour|son tour/.test(res?.error ?? '')) {
        stats.late++;
        return;
      }
      fail(`${c.name} : ${event} ${JSON.stringify(payload)} → ${JSON.stringify(res)}`);
    });
  };
  /** Un coup qui fait avancer la partie : plus rien à ce numéro après lui. */
  const move = (what, event, payload) => {
    send(key(what), event, payload);
    busy.add(key('moved'));
  };
  const rooted = g.tiles.some((t) => t.owner === me && t.kind === 'base');

  if (g.stage === 'place') {
    if (!rooted) {
      const owner = grid(g);
      const free = (x, y) => x > 2 && y > 2 && x < g.size - 3 && y < g.size - 3 && !owner.has(`${x},${y}`) && SIDES.every(([dx, dy]) => !owner.has(`${x + dx},${y + dy}`));
      for (let tries = 0; tries < 200; tries++) {
        const x = Math.floor(Math.random() * g.size);
        const y = Math.floor(Math.random() * g.size);
        if (!free(x, y) || g.specials.some((s) => s.x === x && s.y === y)) continue;
        const shape = shapesByIndex[g.queue[0].shape];
        const withBase = { ...g, tiles: [...g.tiles, { owner: me, kind: 'base', cells: [[x, y]] }] };
        const spots = legal(withBase, me, shape);
        if (!spots.length) continue;
        send(key('nobase'), 'game:place', { k: 0, cells: spots[0], seq }, false);
        stats.placed++;
        return move('first', 'game:place', { k: 0, cells: pick(spots), base: [x, y], seq });
      }
      return move('discard', 'game:discard', { seq });
    }
    // Quelques coups interdits, à chaque occasion.
    if (Math.random() < 0.15) send(key('stale'), 'game:discard', { seq: seq - 1 }, false);
    if (Math.random() < 0.15) send(key('edge'), 'game:place', { k: 0, cells: [[g.size, 0]], seq }, false);
    if (Math.random() < 0.15) send(key('junk'), 'game:place', { k: 0, cells: 'n’importe quoi', seq }, false);
    if (Math.random() < 0.15) send(key('far'), 'game:place', { k: 9, cells: [[0, 0]], seq }, false);
    // Ces gestes-là ne changent pas le numéro de l'état : on attend de voir le nouvel état avant de continuer.
    if (g.stones.length && g.seeds[me] > 0 && !busy.has(key('remove')) && Math.random() < 0.5) {
      stats.removed++;
      return send(key('remove'), 'game:removeStone', { cell: g.stones[0] });
    }
    if (g.seeds[me] > 1 && !busy.has(key('buy')) && Math.random() < 0.08) {
      stats.bought++;
      return send(key('buy'), 'game:buyCoupon');
    }
    if (g.coupons[me] > 0 && !busy.has(key('give')) && Math.random() < 0.08) {
      stats.given++;
      return send(key('give'), 'game:giveCoupon', { to: pick(g.order.filter((id) => id !== me)) });
    }
    // Parfois, un bon ou une graine pour une plaque plus loin.
    const reach = g.coupons[me] + g.seeds[me] > 0 && Math.random() < 0.3 ? 1 + Math.floor(Math.random() * 5) : 0;
    const k = Math.min(reach, g.queue.length - 1);
    const spots = legal(g, me, shapesByIndex[g.queue[k].shape]);
    if (!spots.length) return move('discard', 'game:discard', { seq });
    stats.placed++;
    if (k) g.coupons[me] > 0 ? stats.coupons++ : stats.seeds++;
    return move('place', 'game:place', { k, cells: pickSpot(g, spots), seq });
  }

  if (g.stage === 'steal') {
    const mine = g.tiles.find((t) => t.owner === me);
    if (mine) send(key('stealMine'), 'game:steal', { tileId: mine.id, seq }, false);
    const base = g.tiles.find((t) => t.owner !== me && t.kind === 'base');
    if (base) send(key('stealBase'), 'game:steal', { tileId: base.id, seq }, false);
    const targets = g.tiles.filter((t) => t.owner !== me && (t.kind === 'tile' || t.kind === 'plug'));
    if (!targets.length) fail('un arrachage sans plaque à arracher');
    stats.steals++;
    return move('steal', 'game:steal', { tileId: pick(targets).id, seq });
  }

  if (g.stage === 'stealPlace') {
    const spots = legal(g, me, g.stolen);
    if (!spots.length) fail('une plaque arrachée qui ne se replante nulle part');
    return move('stolen', 'game:stolen', { cells: pick(spots), seq });
  }

  if (g.stage === 'stone') {
    const owner = grid(g);
    const stones = new Set(g.stones.map(([x, y]) => `${x},${y}`));
    const specials = new Set(g.specials.map((s) => `${s.x},${s.y}`));
    if (g.tiles[0]) send(key('stoneOn'), 'game:stone', { cell: g.tiles[0].cells[0], seq }, false);
    for (let tries = 0; tries < 500; tries++) {
      const x = Math.floor(Math.random() * g.size);
      const y = Math.floor(Math.random() * g.size);
      if (owner.has(`${x},${y}`) || stones.has(`${x},${y}`) || specials.has(`${x},${y}`)) continue;
      stats.stones++;
      return move('stone', 'game:stone', { cell: [x, y], seq });
    }
    return move('skip', 'game:skip', { seq });
  }

  if (g.stage === 'buy') {
    if (Math.random() < 0.5) return move('endBuy', 'game:endBuy', { seq });
    const spots = legal(g, me, [[0, 0]]);
    if (!spots.length) return move('endBuy', 'game:endBuy', { seq });
    stats.plugs++;
    return move('plug', 'game:plug', { cell: pick(spots)[0], seq });
  }
}

const waitPhase = (c, phase) =>
  new Promise((resolve) => {
    const check = setInterval(() => {
      if (c.view?.phase === phase) {
        clearInterval(check);
        resolve();
      }
    }, 50);
  });

/** Le plus grand carré d'un joueur, recalculé à la main sur le terrain final. */
function bestSquare(final, id) {
  const mine = new Set();
  for (const t of final.tiles) if (t.owner === id) for (const [x, y] of t.cells) mine.add(`${x},${y}`);
  let best = 0;
  for (let y = 0; y < final.size; y++) {
    for (let x = 0; x < final.size; x++) {
      let k = best + 1;
      while (x + k <= final.size && y + k <= final.size) {
        let full = true;
        for (let cy = y; cy < y + k && full; cy++) for (let cx = x; cx < x + k && full; cx++) if (!mine.has(`${cx},${cy}`)) full = false;
        if (!full) break;
        best = k;
        k++;
      }
    }
  }
  return best;
}

function checkFinal(final, players, rounds) {
  if (!final || final.players.length !== players) fail(`table finale incomplète (${final?.players.length})`);
  if (final.rounds !== rounds) fail(`${final.rounds} manches au lieu de ${rounds}`);
  const top = Math.max(...final.players.map((p) => p.square.k));
  const best = final.players.filter((p) => p.square.k === top);
  const share = 3 % best.length === 0 ? 3 / best.length : 0;
  for (const p of final.players) {
    if (bestSquare(final, p.id) !== p.square.k) fail(`${p.name} : carré de ${p.square.k} annoncé, ${bestSquare(final, p.id)} sur le terrain`);
    if (p.reward !== p.square.k - 5) fail(`${p.name} : prime de carré fausse`);
    if (p.prize !== (p.square.k === top ? share : 0)) fail(`${p.name} : prime de plus grand carré fausse`);
    if (p.total !== p.before + p.reward + p.prize) fail(`${p.name} : total faux`);
    if (p.color < 0) fail(`${p.name} : pas de couleur`);
  }
  for (let i = 1; i < final.players.length; i++) if (final.players[i].total > final.players[i - 1].total) fail('classement mal rangé');
  if (!final.players[0].winner || final.players.filter((p) => p.winner).some((p) => p.place !== 1)) fail('gagnant mal marqué');
  if (new Set(final.players.map((p) => p.color)).size !== players) fail('deux joueurs de la même couleur');
  return final.players[0];
}

// ── Partie 1 : 3 humains + 2 bots ──
const host = client('Ana');
await new Promise((r) => host.socket.on('connect', r));

const created = await host.call('room:create', { name: 'Ana', avatar: 'escargot', bots: 2 });
if (!created.ok) fail(`création : ${created.error}`);
const code = created.data.code;
const bob = client('Bob');
const chloe = client('Chloé');
await Promise.all([bob, chloe].map((c) => new Promise((r) => c.socket.on('connect', r))));
for (const c of [bob, chloe]) {
  const res = await c.call('room:join', { code, name: c.name, avatar: 'abeille' });
  if (!res.ok) fail(`arrivée de ${c.name} : ${res.error}`);
  c.session = res.data;
}
await new Promise((r) => setTimeout(r, 100));
const colorsLobby = new Map(host.view.players.map((p) => [p.id, p.color]));
if (new Set(colorsLobby.values()).size !== 5) fail('deux joueurs ont la même variété');
if (!(await host.call('room:settings', { think: 45, rounds: 6 })).ok) fail('réglages refusés');
await host.call('room:settings', { think: 44, rounds: 7 });
await new Promise((r) => setTimeout(r, 100));
if (host.view.settings.think !== 45 || host.view.settings.rounds !== 6) fail('un réglage hors liste a été accepté');
if ((await bob.call('room:settings', { think: 0 })).ok) fail('un invité a changé les réglages');
if ((await bob.call('game:start')).ok) fail('un invité a lancé la partie');
const start = await host.call('game:start');
if (!start.ok) fail(`lancement : ${start.error}`);
await new Promise((r) => setTimeout(r, 50));
if (host.view.game?.rounds !== 6) fail('le réglage des manches n’est pas appliqué');
for (const p of host.view.players) if (colorsLobby.get(p.id) !== p.color) fail('une variété a changé entre le salon et la partie');

// Un spectateur arrive en cours de partie : il voit la table et ne joue pas.
await new Promise((r) => setTimeout(r, 300));
const watcher = client('Dora', { player: false, avatar: 'lapin' });
await new Promise((r) => watcher.socket.on('connect', r));
const joined = await watcher.call('room:join', { code, name: 'Dora', avatar: 'lapin' });
if (!joined.ok) fail(`spectateur : ${joined.error}`);
watcher.session = joined.data;
await new Promise((r) => setTimeout(r, 100));
if (watcher.view.players.find((p) => p.name === 'Dora')?.status !== 'spectator') fail('la retardataire devrait regarder');
if ((await watcher.call('game:discard', {})).ok) fail('le spectateur a joué');
if ((await watcher.call('game:buyCoupon')).ok) fail('le spectateur a acheté un bon');
if ((await watcher.call('game:giveCoupon', { to: host.view.me })).ok) fail('le spectateur a donné un bon');

// Bob se déconnecte un moment, puis revient avec sa session.
await new Promise((r) => setTimeout(r, 400));
bob.socket.disconnect();
await new Promise((r) => setTimeout(r, 900));
bob.socket.connect();
await new Promise((r) => bob.socket.on('connect', r));
const back = await bob.call('room:join', { code, playerId: bob.session.playerId, token: bob.session.token, resumeOnly: true });
if (!back.ok) fail(`retour de Bob : ${back.error}`);
const intruder = await chloe.call('room:join', { code, playerId: bob.session.playerId, token: 'faux', resumeOnly: true });
if (intruder.ok) fail('une session volée a été acceptée');

await waitPhase(host, 'finished');
const w1 = checkFinal(host.view.final, 5, 6);
if (!host.view.players.some((p) => p.wins === 1)) fail('la victoire n’est pas comptée');

// ── Partie 2 : revanche à 8, la table pleine (Dora s'assoit, deux bots de plus) ──
if ((await bob.call('game:restart')).ok) fail('un invité a relancé la partie');
if (!(await host.call('game:restart')).ok) fail('revanche refusée');
await new Promise((r) => setTimeout(r, 150));
if (host.view.phase !== 'lobby') fail('la revanche ne ramène pas au salon');
// Les numéros d'état repartent de zéro : on oublie les coups déjà envoyés.
busy.clear();
watcher.player = true;
for (let i = 0; i < 2; i++) if (!(await host.call('room:addBot')).ok) fail('ajout de bot refusé');
// L'accusé de réception arrive avant le nouvel état : on laisse le temps à la vue de suivre.
await new Promise((r) => setTimeout(r, 150));
const seatedNow = host.view.players.filter((p) => p.status !== 'spectator').length;
if (seatedNow !== 8) fail(`8 joueurs attendus au salon, ${seatedNow} trouvés`);
if (new Set(host.view.players.map((p) => p.color)).size !== 8) fail('à 8, deux joueurs ont la même variété');
if ((await host.call('room:addBot')).ok) fail('un neuvième joueur a été accepté');
if (!(await host.call('room:settings', { think: 0, rounds: 9 })).ok) fail('réglage sans limite refusé');
if (!(await host.call('game:start')).ok) fail('lancement de la revanche refusé');
await new Promise((r) => setTimeout(r, 50));
if (host.view.game.size !== 28) fail(`terrain de 28 attendu à 8, ${host.view.game.size} trouvé`);

await waitPhase(host, 'finished');
const w2 = checkFinal(host.view.final, 8, 9);

console.log(`✓ partie 1 (5 joueurs, 6 manches) : ${w1.name} gagne avec ${w1.total} graines et un carré de ${w1.square.k}.`);
console.log(`✓ partie 2 (8 joueurs, 9 manches, sans limite) : ${w2.name} gagne avec ${w2.total} graines et un carré de ${w2.square.k}.`);
console.log(
  `  Humains : ${stats.placed} plaques posées (${stats.coupons} avec un bon, ${stats.seeds} avec une graine), ${stats.steals} arrachages, ${stats.stones} pierres posées, ${stats.removed} retirées, ${stats.plugs} mottes, ${stats.bought} bons achetés, ${stats.given} donnés, ${stats.refused - stats.late} coups interdits refusés, ${stats.late} arrivés trop tard, ${stats.states} états vérifiés.`,
);
for (const c of [host, bob, chloe, watcher]) c.socket.close();
server.kill();
process.exit(0);
