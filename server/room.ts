// Une table de Laying Grass : salon, partie, minuteries, bots, pilote automatique et vue de chacun.
import crypto from 'node:crypto';
import {
  AVATARS,
  MAX_PLAYERS,
  MIN_PLAYERS,
  ROUND_OPTIONS,
  THINK_OPTIONS,
  parseCell,
  parseCells,
  type FinalView,
  type GameView,
  type PlayerStatus,
  type RoomView,
  type RoundCount,
  type Settings,
  type ThinkTime,
} from '../shared/protocol';
import type { Cell } from '../shared/shapes';
import { AUTOPILOT, applyAction, decide, randomSkill, type Skill } from './bots';
import { Game, shuffle } from './game';

const BOT_NAMES = ['Sécateur', 'Binette', 'Arrosoir', 'Brouette', 'Tondeuse', 'Râteau', 'Plantoir', 'Serfouette', 'Compost', 'Motoculteur'];
const MAX_MEMBERS = 16;
/** Délai laissé à un joueur déconnecté avant que le pilote automatique ne prenne le relais. */
const GRACE_MS = 20_000;
/** Mode accéléré pour les tests locaux (LG_FAST=1) : bots et chronos quasi instantanés. */
const FAST = process.env.LG_FAST === '1';
/** En mode accéléré, un humain n'a qu'un instant pour jouer : on atteint vite la fin. */
const FAST_THINK_MS = 1_500;
/** Le client pose à la toute dernière seconde : on lui laisse le temps d'arriver. */
const TIME_GRACE_MS = 800;

export interface Player {
  id: string;
  token: string;
  name: string;
  avatar: string;
  color: number;
  isBot: boolean;
  sockets: Set<string>;
  connected: boolean;
  disconnectedAt: number;
  left: boolean;
  status: PlayerStatus;
}

function uid(): string {
  return crypto.randomBytes(9).toString('base64url');
}

export class Room {
  readonly code: string;
  hostId = '';
  phase: 'lobby' | 'playing' | 'finished' = 'lobby';
  settings: Settings = { think: 90, rounds: 9 };
  players: Player[] = [];
  game: Game | null = null;
  final: FinalView | null = null;
  wins = new Map<string, number>();
  skills = new Map<string, Skill>();
  stageStartedAt = 0;
  stageEndsAt = 0;
  botAt = 0;
  lastActive = Date.now();
  onChange: () => void = () => {};
  onEmote: (playerId: string, text: string) => void = () => {};

  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(code: string) {
    this.code = code;
  }

  // ───────────────────────────── Membres ─────────────────────────────

  get(id: string | undefined): Player | undefined {
    return id ? this.players.find((p) => p.id === id) : undefined;
  }

  findByToken(playerId: unknown, token: unknown): Player | undefined {
    if (typeof playerId !== 'string' || typeof token !== 'string') return undefined;
    const p = this.get(playerId);
    return p && !p.isBot && p.token === token ? p : undefined;
  }

  get seated(): Player[] {
    return this.players.filter((p) => p.status !== 'spectator');
  }

  get humansOnline(): number {
    return this.players.filter((p) => !p.isBot && p.connected).length;
  }

  touch(): void {
    this.lastActive = Date.now();
  }

  private uniqueName(name: string): string {
    const taken = new Set(this.players.map((p) => p.name.toLowerCase()));
    if (!taken.has(name.toLowerCase())) return name;
    for (let i = 2; i < 99; i++) {
      const candidate = `${name.slice(0, 13)} ${i}`;
      if (!taken.has(candidate.toLowerCase())) return candidate;
    }
    return name;
  }

  /** La première variété de gazon qu'aucun joueur assis n'a prise. */
  private freeColor(): number {
    const used = new Set(this.seated.map((p) => p.color));
    for (let i = 0; i < MAX_PLAYERS; i++) if (!used.has(i)) return i;
    return -1;
  }

  private makePlayer(name: string, avatar: string, isBot: boolean, status: PlayerStatus): Player {
    return {
      id: uid(),
      token: uid() + uid(),
      name: this.uniqueName(name),
      avatar,
      color: status === 'spectator' ? -1 : this.freeColor(),
      isBot,
      sockets: new Set(),
      connected: isBot,
      disconnectedAt: Date.now(),
      left: false,
      status,
    };
  }

  addHuman(name: string, avatar: string): Player | string {
    if (this.players.length >= MAX_MEMBERS) return 'Cette table est pleine.';
    if (this.phase === 'lobby' && this.seated.length >= MAX_PLAYERS) return `La table est complète (${MAX_PLAYERS} joueurs maximum).`;
    const p = this.makePlayer(name, avatar, false, this.phase === 'lobby' ? 'lobby' : 'spectator');
    this.players.push(p);
    if (!this.hostId) this.hostId = p.id;
    return p;
  }

  addBot(by: string): string | undefined {
    if (by !== this.hostId) return "Seul l'hôte peut ajouter des bots.";
    if (this.phase !== 'lobby') return 'On ajoute des bots dans le salon.';
    if (this.seated.length >= MAX_PLAYERS) return `La table est complète (${MAX_PLAYERS} joueurs maximum).`;
    const used = new Set(this.players.map((p) => p.name));
    const name = BOT_NAMES.find((n) => !used.has(n)) ?? `Bot ${this.players.length + 1}`;
    const usedAvatars = new Set(this.players.map((p) => p.avatar));
    const free = AVATARS.filter((a) => !usedAvatars.has(a));
    const pool = free.length ? free : AVATARS;
    this.players.push(this.makePlayer(name, pool[crypto.randomInt(pool.length)], true, 'lobby'));
    return undefined;
  }

  kick(by: string, target: string): { sockets: string[] } | string {
    if (by !== this.hostId) return "Seul l'hôte peut retirer un joueur.";
    if (this.phase !== 'lobby') return 'On ne peut retirer un joueur que dans le salon.';
    const p = this.get(target);
    if (!p || p.id === by) return 'Joueur introuvable.';
    this.players = this.players.filter((x) => x.id !== p.id);
    return { sockets: [...p.sockets] };
  }

  leave(id: string): void {
    const p = this.get(id);
    if (!p) return;
    p.sockets.clear();
    p.connected = false;
    p.disconnectedAt = Date.now();
    // En partie, sa place reste à la table : le pilote automatique joue pour lui.
    if (this.phase === 'lobby' || p.status === 'spectator') this.players = this.players.filter((x) => x.id !== id);
    else p.left = true;
    if (this.hostId === id) this.transferHost();
  }

  private transferHost(): void {
    const next = this.players.find((p) => !p.isBot && !p.left && p.connected) ?? this.players.find((p) => !p.isBot && !p.left);
    this.hostId = next?.id ?? '';
  }

  connect(p: Player, socketId: string): void {
    p.sockets.add(socketId);
    p.connected = true;
    p.left = false;
    if (!this.hostId || !this.get(this.hostId) || this.get(this.hostId)?.left) this.hostId = p.id;
  }

  disconnect(id: string | undefined, socketId: string): void {
    const p = this.get(id);
    if (!p) return;
    p.sockets.delete(socketId);
    if (p.sockets.size === 0) {
      p.connected = false;
      p.disconnectedAt = Date.now();
    }
  }

  isAuto(p: Player): boolean {
    return p.isBot || p.left || (!p.connected && Date.now() - p.disconnectedAt >= GRACE_MS);
  }

  updateSettings(by: string, payload: Record<string, unknown>): string | undefined {
    if (by !== this.hostId) return "Seul l'hôte peut changer les réglages.";
    if (this.phase !== 'lobby') return 'Les réglages se changent dans le salon.';
    if ((THINK_OPTIONS as readonly unknown[]).includes(payload.think)) this.settings.think = payload.think as ThinkTime;
    if ((ROUND_OPTIONS as readonly unknown[]).includes(payload.rounds)) this.settings.rounds = payload.rounds as RoundCount;
    return undefined;
  }

  // ───────────────────────────── Partie ─────────────────────────────

  start(by: string): string | undefined {
    if (by !== this.hostId) return "Seul l'hôte peut lancer la partie.";
    if (this.phase !== 'lobby') return 'La partie est déjà lancée.';
    const seated = this.seated;
    if (seated.length < MIN_PLAYERS) return `Il faut au moins ${MIN_PLAYERS} joueurs (ajoute un bot si besoin).`;
    for (const p of seated) p.status = 'playing';
    const order = shuffle(seated.map((p) => p.id));
    const spectators = this.players.filter((p) => p.status === 'spectator');
    this.players = [...order.map((id) => this.get(id)!), ...spectators];
    this.game = new Game(order, { rounds: this.settings.rounds });
    this.skills.clear();
    for (const p of this.players) if (p.isBot && p.status === 'playing') this.skills.set(p.id, randomSkill());
    this.phase = 'playing';
    this.final = null;
    this.armStage();
    return undefined;
  }

  restart(by: string): string | undefined {
    if (by !== this.hostId) return "Seul l'hôte peut relancer une partie.";
    if (this.phase === 'lobby') return undefined;
    this.clearTimer();
    this.players = this.players.filter((p) => !p.left);
    let seats = 0;
    for (const p of this.players) {
      p.status = seats < MAX_PLAYERS ? 'lobby' : 'spectator';
      if (p.status === 'lobby') seats++;
      else p.color = -1;
    }
    for (const p of this.players) if (p.status === 'lobby' && p.color < 0) p.color = this.freeColor();
    this.phase = 'lobby';
    this.game = null;
    this.final = null;
    this.skills.clear();
    return undefined;
  }

  endEarly(by: string): string | undefined {
    if (by !== this.hostId) return "Seul l'hôte peut arrêter la partie.";
    if (this.phase !== 'playing') return undefined;
    return this.restart(by);
  }

  /** Plus aucun humain présent : les bots jouent vite. */
  private onlyBots(): boolean {
    return !!this.game && this.game.order.every((id) => {
      const p = this.get(id);
      return !p || this.isAuto(p);
    });
  }

  private botDelay(): number {
    if (FAST) return 15;
    if (this.onlyBots()) return 300;
    const g = this.game!;
    if (g.stage === 'place') return 1600 + Math.random() * 1600;
    if (g.stage === 'buy') return 900 + Math.random() * 800;
    return 1200 + Math.random() * 1000;
  }

  /** Le geste qui commence : chrono de l'humain, ou temps de réflexion du bot. */
  private armStage(): void {
    const g = this.game;
    if (!g || g.stage === 'over') return;
    const now = Date.now();
    this.stageStartedAt = now;
    const think = this.settings.think * 1000;
    this.stageEndsAt = FAST ? now + FAST_THINK_MS : think ? now + think : 0;
    this.botAt = now + this.botDelay();
  }

  private check(seq: unknown): string | undefined {
    if (this.phase !== 'playing' || !this.game) return "Aucune partie n'est en cours.";
    if (seq !== undefined && seq !== this.game.seq) return 'Le terrain a changé entre-temps.';
    return undefined;
  }

  /** Un geste qui passe la main : s'il est accepté, on prépare le suivant. */
  private act(seq: unknown, gesture: (g: Game) => string | undefined): string | undefined {
    const err = this.check(seq);
    if (err) return err;
    const g = this.game!;
    const before = g.seq;
    const refused = gesture(g);
    if (refused) return refused;
    if (g.seq !== before) this.afterAction();
    return undefined;
  }

  place(by: string, payload: Record<string, unknown>): string | undefined {
    const cells = parseCells(payload.cells);
    if (!cells) return 'Cette pose est illisible.';
    const base = payload.base === undefined || payload.base === null ? null : parseCell(payload.base);
    if (payload.base && !base) return 'Cette touffe est illisible.';
    return this.act(payload.seq, (g) => g.place(by, Number(payload.k), cells, base));
  }

  discard(by: string, seq: unknown): string | undefined {
    return this.act(seq, (g) => g.discard(by));
  }

  steal(by: string, tileId: unknown, seq: unknown): string | undefined {
    return this.act(seq, (g) => g.steal(by, Number(tileId)));
  }

  placeStolen(by: string, rawCells: unknown, seq: unknown): string | undefined {
    const cells = parseCells(rawCells);
    if (!cells) return 'Cette pose est illisible.';
    return this.act(seq, (g) => g.placeStolen(by, cells));
  }

  placeStone(by: string, raw: unknown, seq: unknown): string | undefined {
    const c = parseCell(raw);
    if (!c) return 'Cette case est illisible.';
    return this.act(seq, (g) => g.placeStone(by, c[0], c[1]));
  }

  skipEffect(by: string, seq: unknown): string | undefined {
    return this.act(seq, (g) => g.skipEffect(by));
  }

  buyPlug(by: string, raw: unknown, seq: unknown): string | undefined {
    const c = parseCell(raw);
    if (!c) return 'Cette case est illisible.';
    return this.act(seq, (g) => g.buyPlug(by, c[0], c[1]));
  }

  endBuy(by: string, seq: unknown): string | undefined {
    return this.act(seq, (g) => g.endBuy(by));
  }

  // Ces gestes-là ne passent pas la main : le chrono continue de tourner.

  removeStone(by: string, raw: unknown): string | undefined {
    const c = parseCell(raw);
    if (!c) return 'Cette case est illisible.';
    const err = this.check(undefined);
    return err ?? this.game!.removeStone(by, c[0], c[1]);
  }

  buyCoupon(by: string): string | undefined {
    const err = this.check(undefined);
    return err ?? this.game!.buyCoupon(by);
  }

  giveCoupon(by: string, to: unknown): string | undefined {
    const err = this.check(undefined);
    return err ?? this.game!.giveCoupon(by, String(to ?? ''));
  }

  private afterAction(): void {
    const g = this.game!;
    this.botReacts();
    if (g.stage === 'over') this.finishGame();
    else this.armStage();
  }

  /** De temps en temps, un bot réagit à ce qui vient de se passer. */
  private botReacts(): void {
    if (FAST) return;
    const e = this.game?.events.at(-1);
    if (!e) return;
    const say = (id: string, chance: number, words: string[]) => {
      if (!this.get(id)?.isBot || Math.random() > chance) return;
      setTimeout(() => this.onEmote(id, pickOne(words)), 700 + Math.random() * 900);
    };
    if (e.type === 'stealTake') {
      say(e.player, 0.35, ['😈', 'Merci !']);
      if (e.other) say(e.other, 0.5, ['Voleur !', '😱']);
    } else if (e.type === 'stoneSet') say(e.player, 0.3, ['😈', 'Je te bloque']);
    else if (e.type === 'giveCoupon' && e.other) say(e.other, 0.6, ['Merci !', '🙏']);
    else if (e.type === 'place' && e.activated?.length) say(e.player, 0.25, ['🌱', '🔥']);
  }

  private finishGame(): void {
    const g = this.game;
    if (!g) return;
    const standings = g.standings();
    for (const s of standings) if (s.place === 1) this.wins.set(s.id, (this.wins.get(s.id) ?? 0) + 1);
    this.final = {
      size: g.size,
      rounds: g.rounds,
      tiles: [...g.tiles.values()],
      stones: stonesOf(g),
      specials: specialsOf(g),
      players: standings.map((s) => {
        const p = this.get(s.id);
        return {
          id: s.id,
          name: p?.name ?? '?',
          avatar: p?.avatar ?? AVATARS[0],
          color: p?.color ?? 0,
          square: s.square,
          before: s.before,
          reward: s.reward,
          prize: s.prize,
          total: s.total,
          place: s.place,
          winner: s.place === 1,
          wins: this.wins.get(s.id) ?? 0,
        };
      }),
    };
    this.phase = 'finished';
    this.clearTimer();
  }

  // ───────────────────────────── Minuteries & pilote automatique ─────────────────────────────

  private clearTimer(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  /** À appeler après chaque changement : planifie la prochaine échéance puis diffuse l'état. */
  commit(): void {
    this.reschedule();
    this.onChange();
  }

  /** Quand agir pour celui dont c'est le tour : bot → délai naturel, absent → fin du délai de grâce, sinon fin du chrono. */
  private nextDue(): number {
    const g = this.game!;
    if (g.stage === 'over') return Date.now();
    const p = this.get(g.turn ?? undefined);
    const limit = this.stageEndsAt > 0 ? this.stageEndsAt + TIME_GRACE_MS : Infinity;
    if (!p) return Date.now();
    if (p.isBot) return this.botAt;
    if (this.isAuto(p)) return Math.max(this.stageStartedAt + 1500, p.left ? 0 : p.disconnectedAt + GRACE_MS);
    if (!p.connected) return Math.min(limit, p.disconnectedAt + GRACE_MS);
    return limit;
  }

  private reschedule(): void {
    this.clearTimer();
    const g = this.game;
    if (this.phase !== 'playing' || !g) return;
    const due = this.nextDue();
    if (!Number.isFinite(due)) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      try {
        this.tick();
      } catch (e) {
        console.error(`[room ${this.code}]`, e);
      }
      this.commit();
    }, Math.max(0, Math.min(due - Date.now(), 2_147_000_000)));
  }

  tick(): void {
    const g = this.game;
    if (this.phase !== 'playing' || !g) return;
    if (g.stage === 'over') {
      this.finishGame();
      return;
    }
    const id = g.turn;
    if (!id || Date.now() < this.nextDue()) return;
    const p = this.get(id);
    // Un humain encore là, mais à court de temps : la règle s'applique.
    if (p && !this.isAuto(p)) {
      g.timeout();
      this.afterAction();
      return;
    }
    this.autoPlay(id);
  }

  /** Le bot joue ; le pilote automatique d'un absent fait de même, en plus prudent. */
  autoPlay(id: string): void {
    const g = this.game!;
    const before = g.seq;
    const refused = applyAction(g, id, decide(g, id, this.skills.get(id) ?? AUTOPILOT));
    if (refused) {
      // Filet de sécurité : la partie ne doit jamais se bloquer.
      console.error(`[room ${this.code}] geste refusé : ${refused}`);
      g.timeout();
    }
    if (g.seq !== before) this.afterAction();
  }

  dispose(): void {
    this.clearTimer();
  }

  // ───────────────────────────── Vue ─────────────────────────────

  /** Tout est sur la table : chacun voit le même terrain et la même file. */
  private gameView(g: Game): GameView {
    const turn = this.get(g.turn ?? undefined);
    return {
      size: g.size,
      rounds: g.rounds,
      round: g.round,
      order: [...g.order],
      stage: g.stage,
      turn: g.turn,
      seq: g.seq,
      endsAt: turn && !turn.isBot ? this.stageEndsAt : 0,
      queue: g.queue,
      tiles: [...g.tiles.values()],
      stones: stonesOf(g),
      specials: specialsOf(g),
      seeds: Object.fromEntries(g.seeds),
      coupons: Object.fromEntries(g.coupons),
      stolen: g.stolen,
      events: g.events,
    };
  }

  viewFor(viewerId: string): RoomView {
    const g = this.phase === 'playing' ? this.game : null;
    return {
      code: this.code,
      phase: this.phase,
      me: viewerId,
      hostId: this.hostId,
      settings: { ...this.settings },
      players: this.players.map((p) => ({
        id: p.id,
        name: p.name,
        avatar: p.avatar,
        color: p.color,
        isBot: p.isBot,
        isHost: p.id === this.hostId,
        connected: p.isBot || p.connected,
        autopilot: !p.isBot && p.status === 'playing' && this.isAuto(p),
        status: p.status,
        wins: this.wins.get(p.id) ?? 0,
      })),
      game: g ? this.gameView(g) : null,
      final: this.final,
      serverNow: Date.now(),
    };
  }
}

function stonesOf(g: Game): Cell[] {
  const out: Cell[] = [];
  g.board.stone.forEach((s, i) => {
    if (s) out.push([i % g.size, Math.floor(i / g.size)]);
  });
  return out;
}

function specialsOf(g: Game): GameView['specials'] {
  return [...g.board.special].map(([i, kind]) => ({ x: i % g.size, y: Math.floor(i / g.size), kind }));
}

function pickOne<T>(arr: T[]): T {
  return arr[crypto.randomInt(arr.length)];
}
