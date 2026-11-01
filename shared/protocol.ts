// Contrat partagé entre le serveur et le client : vues de table, réglages, constantes de la partie.
import type { Cell } from './shapes';

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 8;

/** Le terrain : l'émission donnait environ 100 cases par joueur (30 × 30 à neuf). On garde cette place. */
export function boardSize(players: number): number {
  return 12 + 2 * players;
}

export const START_SEEDS = 3;
export const START_COUPONS = 1;
/** Un bon permet de prendre l'une des cinq plaques qui suivent. */
export const COUPON_REACH = 5;
/** La prime du plus grand carré, partagée s'il y a égalité et perdue si elle ne se divise pas. */
export const SQUARE_PRIZE = 3;

/** Ce que rapporte un carré de k de côté : un 5 × 5 ne change rien, chaque case de côté vaut une graine. */
export function squareReward(k: number): number {
  return k - 5;
}

export const ROUND_OPTIONS = [6, 9] as const;
export type RoundCount = (typeof ROUND_OPTIONS)[number];
/** Temps pour chaque geste, en secondes (0 : sans limite). L'émission donnait deux minutes. */
export const THINK_OPTIONS = [0, 45, 90, 120] as const;
export type ThinkTime = (typeof THINK_OPTIONS)[number];

export interface Settings {
  think: ThinkTime;
  rounds: RoundCount;
}

export const AVATARS = ['escargot', 'abeille', 'herisson', 'coccinelle', 'lapin', 'papillon', 'grenouille', 'ecureuil', 'canard', 'chenille', 'poule', 'mouton'] as const;
export const EMOTES = ['🌱', '😈', '😱', '🙏', '🔥', '🫡'] as const;
export const TAUNTS = ['Joli coup', 'Pas là !', 'On s’arrange ?', 'Je te bloque', 'Merci !', 'Voleur !'] as const;

export type PlayerStatus = 'lobby' | 'playing' | 'spectator';

export interface PlayerView {
  id: string;
  name: string;
  avatar: string;
  /** Sa variété de gazon : la même du salon à la fin de la partie (-1 pour un spectateur). */
  color: number;
  isBot: boolean;
  isHost: boolean;
  connected: boolean;
  autopilot: boolean;
  status: PlayerStatus;
  /** Parties gagnées à cette table. */
  wins: number;
}

export type SpecialKind = 'coupon' | 'seed' | 'stone' | 'steal';
export interface Special {
  x: number;
  y: number;
  kind: SpecialKind;
}

/** base : la première touffe. tile : une plaque. plug : une motte achetée. special : une case spéciale entourée. */
export type TileKind = 'base' | 'tile' | 'plug' | 'special';
export interface PlacedTile {
  id: number;
  owner: string;
  kind: TileKind;
  cells: Cell[];
}

export interface QueueTile {
  /** Unique dans la partie. */
  id: number;
  /** Indice dans SHAPES. */
  shape: number;
}

/**
 * place : le joueur plante une plaque.
 * steal : il vient d'entourer un arrachage et choisit la plaque à prendre.
 * stealPlace : il replante chez lui la plaque arrachée.
 * stone : il vient d'entourer une pierre et la pose où il veut.
 * buy : après la dernière manche, chacun à son tour peut acheter des mottes.
 */
export type Stage = 'place' | 'steal' | 'stealPlace' | 'stone' | 'buy' | 'over';

export type EventType = 'place' | 'plug' | 'discard' | 'stealTake' | 'stealPlace' | 'stealLost' | 'stoneSet' | 'stoneOff' | 'skip' | 'buyCoupon' | 'giveCoupon';

/** Ce qui vient de se passer : le client s'en sert pour les animations, les sons et le bandeau. */
export interface GameEvent {
  n: number;
  type: EventType;
  player: string;
  tileId?: number;
  /** Celui qui perd sa plaque, ou celui qui reçoit le bon. */
  other?: string;
  /** La place de la plaque dans la file (0 : celle du tour). */
  k?: number;
  /** Comment l'échange a été payé. */
  paid?: 'coupon' | 'seed';
  activated?: SpecialKind[];
  /** Les cases concernées : la plaque arrachée, la pierre posée ou retirée. */
  cells?: Cell[];
  why?: 'choice' | 'time' | 'stuck';
}

export interface GameView {
  size: number;
  rounds: number;
  round: number;
  order: string[];
  stage: Stage;
  /** À qui c'est le tour. */
  turn: string | null;
  /** Numéro de l'état : une action envoyée pour un état déjà passé est refusée. */
  seq: number;
  /** Fin du chrono du geste en cours (0 : sans limite). */
  endsAt: number;
  /** Toute la file, visible comme autour de la vraie table. */
  queue: QueueTile[];
  tiles: PlacedTile[];
  stones: Cell[];
  /** Les cases spéciales encore en jeu. */
  specials: Special[];
  seeds: Record<string, number>;
  coupons: Record<string, number>;
  /** La plaque arrachée qu'il reste à replanter. */
  stolen: Cell[] | null;
  events: GameEvent[];
}

export interface FinalPlayer {
  id: string;
  name: string;
  avatar: string;
  color: number;
  /** Son plus grand carré : k de côté, x et y de son coin. */
  square: { k: number; x: number; y: number };
  /** Ses graines avant les comptes. */
  before: number;
  reward: number;
  prize: number;
  total: number;
  place: number;
  winner: boolean;
  wins: number;
}

export interface FinalView {
  size: number;
  rounds: number;
  tiles: PlacedTile[];
  stones: Cell[];
  specials: Special[];
  players: FinalPlayer[];
}

export interface RoomView {
  code: string;
  phase: 'lobby' | 'playing' | 'finished';
  me: string;
  hostId: string;
  settings: Settings;
  players: PlayerView[];
  game: GameView | null;
  final: FinalView | null;
  serverNow: number;
}

export type Ack<T = unknown> = (res: { ok: boolean; error?: string; data?: T }) => void;

function isInt(x: unknown): x is number {
  return typeof x === 'number' && Number.isInteger(x);
}

/** Une case reçue du réseau (le moteur vérifie qu'elle est sur le terrain). */
export function parseCell(raw: unknown): Cell | null {
  if (!Array.isArray(raw) || raw.length !== 2 || !isInt(raw[0]) || !isInt(raw[1])) return null;
  return [raw[0], raw[1]];
}

/** Des cases reçues du réseau, sans doublon. */
export function parseCells(raw: unknown): Cell[] | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > 16) return null;
  const cells: Cell[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const c = parseCell(item);
    if (!c) return null;
    const key = `${c[0]},${c[1]}`;
    if (seen.has(key)) return null;
    seen.add(key);
    cells.push(c);
  }
  return cells;
}
