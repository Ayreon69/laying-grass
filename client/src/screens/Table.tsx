// La table : le terrain au centre, les jardiniers au-dessus, la file de plaques et les gestes sous le pouce.
import confetti from 'canvas-confetti';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowLeft, BookOpen, Bot, Check, Flag, FlipHorizontal2, Hand, LogOut, MoreHorizontal, RotateCw, Search, Shovel, Smile, Sprout, Trash2, Volume2, VolumeX, WifiOff, X } from 'lucide-react';
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { COUPON_REACH, EMOTES, TAUNTS, type GameEvent, type PlayerView, type QueueTile, type RoomView, type SpecialKind } from '../../../shared/protocol';
import { SHAPES, type Cell } from '../../../shared/shapes';
import { Field, type Flash, type Ping } from '../components/Field';
import { Piece, SeedIcon, SpecialIcon, TicketIcon } from '../components/Icons';
import { Avatar, Button, Logo, Modal } from '../components/Ui';
import { holdsGhost, usePlanter, type Planter } from '../lib/planter';
import { sfx } from '../lib/sound';
import { eventLine, nameOf } from '../lib/text';
import { cls, reducedMotion, useTick, vibrate } from '../lib/util';
import { variety } from '../lib/varieties';
import { leaveRoom, send, socket } from '../net';
import { useStore, type Emote } from '../store';

/** La loupe montre 14 cases de côté. Elle est à portée sous 24 px par case, et s'ouvre d'elle-même pour poser sous 15 px. */
const ZOOM_CELLS = 14;
const ZOOM_OFFER_PX = 24;
const ZOOM_AUTO_PX = 15;

const MOUSE = typeof window !== 'undefined' && !!window.matchMedia?.('(hover: hover) and (pointer: fine)').matches;

export function clippings(el: Element | null, count = 70): void {
  if (!el || reducedMotion()) return;
  const r = el.getBoundingClientRect();
  void confetti({
    particleCount: count,
    spread: 80,
    startVelocity: 26,
    gravity: 0.7,
    origin: { x: (r.left + r.width / 2) / window.innerWidth, y: (r.top + r.height / 2) / window.innerHeight },
    colors: ['#57b947', '#8fd14f', '#2a7526', '#c7f5b4', '#e8b93e'],
    shapes: ['square'],
    scalar: 0.7,
    disableForReducedMotion: true,
  });
}

function TurnTimer({ endsAt, think }: { endsAt: number; think: number }) {
  const now = useTick(250);
  if (!endsAt) return null;
  const span = Math.max(1500, think * 1000);
  const left = Math.max(0, endsAt - now);
  const low = left < 10_000;
  return (
    <>
      {low && <b className="timer-left">{Math.ceil(left / 1000)} s</b>}
      <span className={cls('turn-timer', low && 'is-low')} role="timer" aria-label={`${Math.ceil(left / 1000)} secondes`}>
        <span style={{ width: `${Math.min(100, (left / span) * 100)}%` }} />
      </span>
    </>
  );
}

interface Flyer {
  id: number;
  tileId: number;
  cells: Cell[];
  color: number;
  from: { x: number; y: number };
  to: { x: number; y: number };
  unit: number;
}

/** Sons, vibrations, plaques qui volent : tout se déduit de l'état reçu. */
function useTableEffects(view: RoomView, svg: React.RefObject<SVGSVGElement>) {
  const g = view.game!;
  const last = useRef<number | null>(null);
  const turnKey = useRef<string | null>(null);
  const nextId = useRef(1);
  const [pings, setPings] = useState<Ping[]>([]);
  const [flash, setFlash] = useState<Flash | null>(null);
  const [flyers, setFlyers] = useState<Flyer[]>([]);
  const [fresh, setFresh] = useState<number | null>(null);

  useLayoutEffect(() => {
    const newest = g.events.at(-1)?.n ?? 0;
    if (last.current === null) {
      last.current = newest;
      if (g.round === 1 && !newest) sfx.start();
    } else if (newest !== last.current) {
      const seen = last.current;
      last.current = newest;
      for (const e of g.events) if (e.n > seen) handle(e);
    }
    // À toi : on le dit une fois, à chaque nouveau geste attendu.
    const key = g.turn === view.me && g.stage !== 'over' ? `${g.round}:${g.stage}:${g.turn}` : null;
    if (key && key !== turnKey.current) {
      window.setTimeout(() => sfx.turn(), 200);
      vibrate(25);
    }
    turnKey.current = key;

    function ping(cells: { x: number; y: number; kind: SpecialKind }[]) {
      if (!cells.length) return;
      const list = cells.map((c) => ({ ...c, id: nextId.current++ }));
      setPings((p) => [...p, ...list]);
      window.setTimeout(() => setPings((p) => p.filter((x) => !list.includes(x))), 1500);
    }

    function handle(e: GameEvent) {
      const mine = e.player === view.me;
      if (e.type === 'place' || e.type === 'stealPlace' || e.type === 'plug') {
        setFresh(e.tileId ?? null);
        const tile = g.tiles.find((t) => t.id === e.tileId);
        const flying = e.type === 'place' && !mine && !!tile && launch(e, tile.cells);
        window.setTimeout(() => sfx.plop(), flying ? 420 : 0);
        if (e.activated?.length) {
          const fresh = g.tiles.filter((t) => t.kind === 'special' && t.owner === e.player && t.id > (e.tileId ?? 0));
          const delay = flying ? 520 : 120;
          window.setTimeout(() => {
            ping(fresh.map((t, i) => ({ x: t.cells[0][0], y: t.cells[0][1], kind: e.activated![i] ?? 'seed' })));
            sfx.chime();
            if (mine) {
              vibrate([30, 40, 60]);
              clippings(svg.current, 50);
            }
          }, delay);
        }
      } else if (e.type === 'discard') {
        sfx.lost();
        if (mine && e.why && e.why !== 'choice') useStore.getState().showToast(eventLine(view, e), 'info');
      } else if (e.type === 'stealTake') {
        sfx.rip();
        if (e.cells) setFlash({ key: e.n, cells: e.cells });
        window.setTimeout(() => setFlash((f) => (f?.key === e.n ? null : f)), 1000);
        if (e.other === view.me) vibrate([60, 40, 120]);
      } else if (e.type === 'stoneSet' || e.type === 'stoneOff') {
        sfx.stone();
        if (e.cells && e.type === 'stoneSet') ping([{ x: e.cells[0][0], y: e.cells[0][1], kind: 'stone' }]);
      } else if (e.type === 'buyCoupon' || e.type === 'giveCoupon') {
        sfx.paper();
        if (e.other === view.me) vibrate(25);
      } else if (e.type === 'stealLost' || e.type === 'skip') {
        sfx.lost();
        if (mine && e.why && e.why !== 'choice') useStore.getState().showToast(eventLine(view, e), 'info');
      }
    }

    /** La plaque part de la file et va se poser sur le terrain. */
    function launch(e: GameEvent, cells: Cell[]): boolean {
      if (reducedMotion() || !svg.current) return false;
      const slot = document.querySelector(`[data-slot="${e.k ?? 0}"]`);
      if (!slot) return false;
      const box = svg.current.getBoundingClientRect();
      const unit = box.width / g.size;
      const s = slot.getBoundingClientRect();
      const minX = Math.min(...cells.map((c) => c[0]));
      const minY = Math.min(...cells.map((c) => c[1]));
      const flyer: Flyer = {
        id: nextId.current++,
        tileId: e.tileId!,
        cells: cells.map(([x, y]): Cell => [x - minX, y - minY]),
        color: view.players.find((p) => p.id === e.player)?.color ?? 0,
        from: { x: s.left + s.width / 2 - unit, y: s.top + s.height / 2 - unit },
        to: { x: box.left + minX * unit, y: box.top + minY * unit },
        unit,
      };
      setFlyers((f) => [...f, flyer]);
      return true;
    }
  });

  const landed = useCallback((id: number) => setFlyers((f) => f.filter((x) => x.id !== id)), []);
  return { pings, flash, flyers, fresh, landed };
}

function ReactionTray({ onClose }: { onClose: () => void }) {
  const emit = (emoji: string) => {
    socket.emit('emote', { emoji });
    onClose();
  };
  return (
    <motion.div className="reactions" role="menu" aria-label="Réactions" initial={{ y: -8, opacity: 0 }} animate={{ y: 0, opacity: 1 }}>
      <div className="reaction-emojis">
        {EMOTES.map((e) => (
          <button key={e} type="button" role="menuitem" onClick={() => emit(e)} aria-label={`Réaction ${e}`}>
            {e}
          </button>
        ))}
      </div>
      <div className="reaction-taunts">
        {TAUNTS.map((t) => (
          <button key={t} type="button" role="menuitem" onClick={() => emit(t)}>
            {t}
          </button>
        ))}
      </div>
    </motion.div>
  );
}

function Bubbles({ emotes }: { emotes: Emote[] }) {
  return (
    <AnimatePresence>
      {emotes.slice(-1).map((e) => (
        <motion.span key={e.id} className={cls('bubble', e.emoji.length > 3 && 'is-text')} initial={{ scale: 0.4, y: 6, opacity: 0 }} animate={{ scale: 1, y: 0, opacity: 1 }} exit={{ opacity: 0, y: -6 }}>
          {e.emoji}
        </motion.span>
      ))}
    </AnimatePresence>
  );
}

/** Un jardinier : son compagnon sur un carré de sa variété, ses graines et ses bons. */
function Chip({ view, p, emotes, onOpen }: { view: RoomView; p: PlayerView; emotes: Emote[]; onOpen: () => void }) {
  const g = view.game!;
  const v = variety(p.color);
  const isTurn = g.turn === p.id;
  return (
    <button type="button" className={cls('chip', isTurn && 'is-turn', p.id === view.me && 'is-me', !p.connected && 'is-off')} style={{ '--c': v.color, '--d': v.dark } as React.CSSProperties} onClick={onOpen} aria-label={`${p.name} : ${g.seeds[p.id]} graines, ${g.coupons[p.id]} bons`}>
      <span className="chip-sod">
        <Avatar avatar={p.avatar} />
        <Bubbles emotes={emotes} />
      </span>
      <span className="chip-name">{p.id === view.me ? 'Toi' : p.name}</span>
      <span className="chip-counts">
        <span>
          <SeedIcon size={13} />
          {g.seeds[p.id]}
        </span>
        <span>
          <TicketIcon size={11} />
          {g.coupons[p.id]}
        </span>
      </span>
      {p.autopilot ? (
        <span className="chip-state" title="Pilote automatique" aria-label="Pilote automatique">
          <Bot size={11} aria-hidden />
        </span>
      ) : !p.connected ? (
        <span className="chip-state" title="Absent" aria-label="Absent">
          <WifiOff size={11} aria-hidden />
        </span>
      ) : null}
    </button>
  );
}

function PlayerSheet({ view, id, onClose }: { view: RoomView; id: string | null; onClose: () => void }) {
  const g = view.game!;
  const p = view.players.find((x) => x.id === id);
  if (!p) return null;
  const v = variety(p.color);
  const seated = g.order.includes(view.me);
  const mineCoupons = g.coupons[view.me] ?? 0;
  const mineSeeds = g.seeds[view.me] ?? 0;
  const buying = g.stage === 'buy';
  return (
    <Modal open onClose={onClose} title={p.id === view.me ? 'Toi' : p.name}>
      <div className="sheet">
        <div className="sheet-who" style={{ '--c': v.color } as React.CSSProperties}>
          <span className="chip-sod is-big">
            <Avatar avatar={p.avatar} />
          </span>
          <span>
            <b>{p.name}</b>
            <small>
              {v.name}, <i>{v.latin}</i>
            </small>
          </span>
        </div>
        <p className="sheet-counts">
          <SeedIcon size={18} /> {g.seeds[p.id]} graine{g.seeds[p.id] > 1 ? 's' : ''}
          <TicketIcon size={16} /> {g.coupons[p.id]} bon{g.coupons[p.id] > 1 ? 's' : ''}
        </p>
        {seated && !buying && p.id === view.me && (
          <Button icon={<TicketIcon size={15} />} disabled={mineSeeds < 1} onClick={() => void send('game:buyCoupon')}>
            Acheter un bon pour une graine
          </Button>
        )}
        {seated && !buying && p.id !== view.me && (
          <Button
            icon={<TicketIcon size={15} />}
            disabled={mineCoupons < 1}
            onClick={() => {
              void send('game:giveCoupon', { to: p.id });
              onClose();
            }}
          >
            {mineCoupons < 1 ? 'Tu n’as pas de bon à donner' : `Donner un bon à ${p.name}`}
          </Button>
        )}
      </div>
    </Modal>
  );
}

/** La file, publique comme autour de la vraie table : la plaque du tour, les cinq qu'un bon peut prendre, puis toutes les autres. */
const QueueStrip = memo(function QueueStrip({ queue, selected, live, canReach, onChoose, cost, color }: { queue: QueueTile[]; selected: number; live: boolean; canReach: (i: number) => boolean; onChoose: (i: number) => void; cost: 'coupon' | 'seed' | null; color: number }) {
  const v = variety(color);
  const slot = (t: QueueTile, i: number) => {
    const near = i <= COUPON_REACH;
    const can = live && canReach(i);
    const on = live && i === selected;
    const cells = SHAPES[t.shape];
    const span = Math.max(Math.max(...cells.map((c) => c[0])), Math.max(...cells.map((c) => c[1]))) + 1;
    return (
      <button
        key={t.id}
        type="button"
        data-slot={i}
        className={cls('slot', i === 0 && 'is-head', near ? 'is-near' : 'is-far', on && 'is-on', can && 'is-live')}
        disabled={!can}
        onClick={() => onChoose(i)}
        aria-label={i === 0 ? 'La plaque du tour' : near ? `Plaque ${i + 1}, pour un bon` : `Plaque ${i + 1}`}
        aria-pressed={on}
      >
        <Piece cells={cells} unit={near ? Math.min(9, 44 / span) : Math.min(6, 30 / span)} fill={on ? v.color : near ? '#9fcf6a' : '#6d8a4f'} line={on ? v.dark : '#2c3a1c'} />
        {near && (
          <small className="slot-tag">
            {i === 0 ? (
              'Ce tour'
            ) : cost === 'seed' ? (
              <>
                <SeedIcon size={11} />1
              </>
            ) : (
              <>
                <TicketIcon size={9} />1
              </>
            )}
          </small>
        )}
      </button>
    );
  };
  return (
    <div className="queue" aria-label="La file de plaques">
      <div className="queue-near">{queue.slice(0, COUPON_REACH + 1).map(slot)}</div>
      <div className="queue-far">{queue.slice(COUPON_REACH + 1).map((t, i) => slot(t, i + COUPON_REACH + 1))}</div>
    </div>
  );
});

/** La consigne du moment, et ce qui vient de se passer. */
function Banner({ view, pl, zoomable, zoomed, onZoom }: { view: RoomView; pl: Planter; zoomable: boolean; zoomed: boolean; onZoom: () => void }) {
  const g = view.game!;
  const who = nameOf(view, g.turn);
  const last = g.events.at(-1);
  const lastLine = last ? eventLine(view, last) : null;
  let title: string;
  let sub: string | null = lastLine;
  let tone = '';
  switch (pl.mode) {
    case 'base':
      title = 'Plante ta première touffe';
      sub = `${MOUSE ? 'Clique sur' : 'Touche'} une case libre : ta plaque viendra contre.`;
      tone = 'is-mine';
      break;
    case 'tile':
      title = pl.base ? 'Pose ta plaque contre ta touffe' : 'À toi de planter';
      if (!pl.hasSpot) sub = 'Cette plaque n’a aucune place. Une autre de la file, peut-être ?';
      else if (pl.error) sub = pl.error;
      else if (g.round <= 2) sub = MOUSE ? 'Clique pour planter. Molette : tourner. Clic droit : retourner.' : 'Fais glisser la plaque. Touche-la pour la tourner.';
      tone = 'is-mine';
      break;
    case 'stolen':
      title = 'Replante la plaque arrachée';
      sub = pl.hasSpot ? (pl.error ?? 'Elle est à toi, si elle touche ton gazon.') : 'Elle n’a aucune place chez toi.';
      tone = 'is-mine';
      break;
    case 'steal':
      title = 'Arrachage ! Choisis une plaque';
      sub = pl.stealId === null ? 'Touche une plaque d’un autre. La première touffe ne s’arrache pas.' : 'Elle quitte ce gazon, et tu la replantes contre le tien.';
      tone = 'is-alert';
      break;
    case 'stone':
      title = 'Pierre ! Pose-la où elle gêne';
      sub = pl.error ?? 'Rien ne pousse dessus. La retirer coûte une graine.';
      tone = 'is-mine';
      break;
    case 'plug':
      title = 'Une motte pour une graine ?';
      sub = pl.error ?? 'Une case contre ton gazon. Les graines gardées comptent à la fin.';
      tone = 'is-mine';
      break;
    case 'removeStone':
      title = 'Touche la pierre à retirer';
      sub = 'Elle te coûte une graine.';
      tone = 'is-mine';
      break;
    default:
      if (g.stage === 'steal') title = `${who} arrache une plaque…`;
      else if (g.stage === 'stealPlace') title = `${who} replante sa prise…`;
      else if (g.stage === 'stone') title = `${who} pose une pierre…`;
      else if (g.stage === 'buy') title = `${who} achète ses mottes…`;
      else title = `${who} plante…`;
  }
  return (
    <div className={cls('banner', tone)} role="status" aria-live="polite">
      <div className="banner-body">
        <b className="banner-title">{title}</b>
        {sub && <span className={cls('banner-sub', pl.error && 'is-error')}>{sub}</span>}
      </div>
      <TurnTimer endsAt={g.endsAt} think={view.settings.think} />
      {zoomable && (
        <button type="button" className={cls('icon-btn', 'zoom-btn', zoomed && 'is-on')} aria-label={zoomed ? 'Voir tout le terrain' : 'Regarder de plus près'} aria-pressed={zoomed} onClick={onZoom}>
          <Search size={18} />
        </button>
      )}
    </div>
  );
}

function MoreMenu({ pl, onClose }: { pl: Planter; onClose: () => void }) {
  const [sure, setSure] = useState(false);
  const canRemove = pl.g.stones.length > 0 && pl.seeds > 0;
  return (
    <motion.div className="more-menu" role="menu" initial={{ y: 8, opacity: 0 }} animate={{ y: 0, opacity: 1 }}>
      {pl.mode === 'tile' && (
        <button
          type="button"
          role="menuitem"
          disabled={!canRemove}
          onClick={() => {
            pl.setRemoving(true);
            onClose();
          }}
        >
          <SpecialIcon kind="stone" size={18} /> Retirer une pierre, pour une graine
        </button>
      )}
      <button
        type="button"
        role="menuitem"
        className="is-danger"
        onClick={() => {
          if (!sure) {
            setSure(true);
            return;
          }
          if (pl.mode === 'stolen') pl.skip();
          else pl.discard();
          onClose();
        }}
      >
        <Trash2 size={18} aria-hidden /> {sure ? 'Confirmer : la plaque est perdue' : 'Renoncer à cette plaque'}
      </button>
    </motion.div>
  );
}

/** Les gestes : tourner, retourner, et le grand bouton qui plante. */
function Dock({ view, pl }: { view: RoomView; pl: Planter }) {
  const [more, setMore] = useState(false);
  const g = view.game!;
  const seated = g.order.includes(view.me);
  const seq = g.seq;
  useEffect(() => setMore(false), [seq]);

  if (pl.mode === 'none') {
    return (
      <div className="dock is-idle">
        <p className="dock-wait">{seated ? 'Patience : on te dira quand c’est ton tour.' : 'Tu regardes la partie : tu joueras à la prochaine.'}</p>
      </div>
    );
  }
  if (pl.mode === 'removeStone') {
    return (
      <div className="dock">
        <Button className="btn-wide" icon={<ArrowLeft size={18} />} onClick={() => pl.setRemoving(false)}>
          Revenir à ma plaque
        </Button>
      </div>
    );
  }
  if (pl.mode === 'steal') {
    return (
      <div className="dock">
        <Button className="dock-side" icon={<X size={18} />} disabled={pl.busy} onClick={pl.skip}>
          Passer
        </Button>
        <Button variant="primary" className="dock-go" icon={<Hand size={20} />} disabled={pl.stealId === null || pl.busy} onClick={pl.confirm}>
          {pl.stealId === null ? 'Choisis une plaque' : 'Arracher cette plaque'}
        </Button>
      </div>
    );
  }
  if (pl.mode === 'stone') {
    return (
      <div className="dock">
        <Button className="dock-side" icon={<X size={18} />} disabled={pl.busy} onClick={pl.skip}>
          Passer
        </Button>
        <Button variant="primary" className="dock-go" icon={<SpecialIcon kind="stone" size={20} />} disabled={!pl.ok || pl.busy} onClick={pl.confirm}>
          Poser la pierre ici
        </Button>
      </div>
    );
  }
  if (pl.mode === 'plug') {
    const canRemove = g.stones.length > 0 && pl.seeds > 0;
    return (
      <div className="dock">
        <Button className="dock-side" icon={<Check size={18} />} disabled={pl.busy} onClick={pl.endBuy}>
          J’ai fini
        </Button>
        {canRemove && (
          <button type="button" className="icon-btn dock-icon" aria-label="Retirer une pierre, pour une graine" onClick={() => pl.setRemoving(true)}>
            <SpecialIcon kind="stone" size={22} />
          </button>
        )}
        <Button variant="primary" className="dock-go" icon={<Sprout size={20} />} disabled={!pl.ok || pl.busy} onClick={pl.confirm}>
          Acheter · <SeedIcon size={15} /> 1
        </Button>
      </div>
    );
  }
  if (pl.mode === 'base') {
    return (
      <div className="dock">
        <Button variant="primary" className="dock-go" icon={<Sprout size={20} />} disabled={!pl.ok} onClick={pl.confirm}>
          Planter ma touffe ici
        </Button>
      </div>
    );
  }
  const single = pl.ori.length === 1;
  const paid = pl.mode === 'tile' && pl.k > 0 ? pl.paysWith : null;
  return (
    <div className="dock">
      {more && <MoreMenu pl={pl} onClose={() => setMore(false)} />}
      {pl.base ? (
        <button type="button" className="icon-btn dock-icon" aria-label="Déplacer ma touffe" onClick={pl.unbase}>
          <ArrowLeft size={22} />
        </button>
      ) : null}
      <button type="button" className="icon-btn dock-icon" aria-label="Tourner la plaque" disabled={single} onClick={pl.rotate}>
        <RotateCw size={22} />
      </button>
      <button type="button" className="icon-btn dock-icon" aria-label="Retourner la plaque" disabled={single} onClick={pl.flip}>
        <FlipHorizontal2 size={22} />
      </button>
      {!pl.base && (
        <button type="button" className={cls('icon-btn', 'dock-icon', more && 'is-on')} aria-label="Autres gestes" aria-expanded={more} onClick={() => setMore((x) => !x)}>
          <MoreHorizontal size={22} />
        </button>
      )}
      {!pl.hasSpot && (pl.mode === 'stolen' || pl.k === 0) ? (
        <Button variant="danger" className="dock-go" icon={<Trash2 size={20} />} disabled={pl.busy} onClick={pl.mode === 'stolen' ? pl.skip : pl.discard}>
          {pl.mode === 'stolen' ? 'Y renoncer' : 'Passer'}
        </Button>
      ) : (
        <Button variant="primary" className="dock-go" icon={pl.mode === 'stolen' ? <Shovel size={20} /> : <Sprout size={20} />} disabled={!pl.ok || pl.busy} onClick={pl.confirm}>
          {pl.mode === 'stolen' ? 'Replanter' : 'Planter'}
          {paid === 'coupon' && (
            <>
              {' · '}
              <TicketIcon size={13} /> 1
            </>
          )}
          {paid === 'seed' && (
            <>
              {' · '}
              <SeedIcon size={15} /> 1
            </>
          )}
        </Button>
      )}
    </div>
  );
}

export function Table({ view }: { view: RoomView }) {
  const prefs = useStore((s) => s.prefs);
  const setPrefs = useStore((s) => s.setPrefs);
  const setRulesOpen = useStore((s) => s.setRulesOpen);
  const emotes = useStore((s) => s.emotes);
  const [menu, setMenu] = useState(false);
  const [confirmStop, setConfirmStop] = useState(false);
  const [react, setReact] = useState(false);
  const [sheet, setSheet] = useState<string | null>(null);
  const g = view.game!;
  const svg = useRef<SVGSVGElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const pl = usePlanter(view);
  const { pings, flash, flyers, fresh, landed } = useTableEffects(view, svg);
  const isHost = view.hostId === view.me;
  const me = view.players.find((p) => p.id === view.me);
  const seatedPlayers = g.order.map((id) => view.players.find((p) => p.id === id)).filter((p): p is PlayerView => !!p);

  const colors = useMemo(() => new Map(view.players.map((p) => [p.id, p.color])), [view.players]);
  const avatars = useMemo(() => new Map(view.players.map((p) => [p.id, p.avatar])), [view.players]);

  // ── La loupe : sur un petit écran, une grande table se regarde de près quand c'est à toi de poser. ──
  const [cellPx, setCellPx] = useState(40);
  useLayoutEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const measure = () => setCellPx(el.clientWidth / g.size);
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [g.size]);
  const zoomable = g.size > ZOOM_CELLS + 2 && cellPx < ZOOM_OFFER_PX;
  const ghostOut = holdsGhost(pl.mode);
  // Tant que le joueur n'a rien choisi, la loupe suit la taille des cases ; pour la première touffe, on veut voir tout le terrain.
  const [zoomPlacing, setZoomPlacing] = useState<boolean | null>(null);
  const [zoomWatching, setZoomWatching] = useState(false);
  const zoomed = zoomable && (ghostOut ? (zoomPlacing ?? (cellPx < ZOOM_AUTO_PX && pl.mode !== 'base')) : zoomWatching);
  const half = ZOOM_CELLS / 2;
  const [focus, setFocus] = useState<[number, number]>([g.size / 2, g.size / 2]);
  const clampFocus = useCallback((v: number) => Math.max(half, Math.min(g.size - half, v)), [half, g.size]);

  // La vue suit la plaque quand elle s'approche d'un bord.
  useLayoutEffect(() => {
    if (!zoomed || !ghostOut) return;
    const margin = 1.5;
    const xs = pl.cells.map((c) => c[0]);
    const ys = pl.cells.map((c) => c[1]);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs) + 1;
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys) + 1;
    setFocus(([fx, fy]) => {
      let nx = fx;
      let ny = fy;
      if (minX < nx - half + margin) nx = minX - margin + half;
      if (maxX > nx + half - margin) nx = maxX + margin - half;
      if (minY < ny - half + margin) ny = minY - margin + half;
      if (maxY > ny + half - margin) ny = maxY + margin - half;
      nx = clampFocus(nx);
      ny = clampFocus(ny);
      return nx === fx && ny === fy ? [fx, fy] : [nx, ny];
    });
  }, [zoomed, ghostOut, pl.cells, half, clampFocus]);

  const fieldStyle = useMemo(() => {
    if (!zoomed) return undefined;
    const s = g.size / ZOOM_CELLS;
    const fx = clampFocus(focus[0]);
    const fy = clampFocus(focus[1]);
    return { transform: `translate(${(-(fx - half) / g.size) * s * 100}%, ${(-(fy - half) / g.size) * s * 100}%) scale(${s})` };
  }, [zoomed, g.size, focus, half, clampFocus]);

  // ── Les gestes sur le terrain. ──
  const drag = useRef<{ id: number; x: number; y: number; pos: Cell; moved: boolean; focus: [number, number] } | null>(null);
  const cellAt = useCallback((e: { clientX: number; clientY: number }): Cell => {
    const r = svg.current!.getBoundingClientRect();
    return [Math.floor(((e.clientX - r.left) / r.width) * g.size), Math.floor(((e.clientY - r.top) / r.height) * g.size)];
  }, [g.size]);
  const centered = useCallback((c: Cell): Cell => [c[0] - Math.floor(pl.size[0] / 2), c[1] - Math.floor(pl.size[1] / 2)], [pl.size]);

  const tileAt = useCallback(
    (c: Cell) => {
      const list = g.tiles.filter((t) => t.owner !== view.me && (t.kind === 'tile' || t.kind === 'plug'));
      const direct = list.find((t) => t.cells.some(([x, y]) => x === c[0] && y === c[1]));
      if (direct) return direct;
      // Un doigt n'est pas une souris : on accepte une case à côté.
      return list.find((t) => t.cells.some(([x, y]) => Math.abs(x - c[0]) + Math.abs(y - c[1]) === 1));
    },
    [g.tiles, view.me],
  );

  const onTap = useCallback(
    (e: ReactPointerEvent, mouse: boolean) => {
      const c = cellAt(e);
      if (pl.mode === 'steal') {
        const t = tileAt(c);
        if (t) pl.pickSteal(t.id);
        return;
      }
      if (pl.mode === 'removeStone') {
        const near = g.stones.find(([x, y]) => x === c[0] && y === c[1]) ?? g.stones.find(([x, y]) => Math.abs(x - c[0]) + Math.abs(y - c[1]) === 1);
        if (near) pl.removeStone(near);
        return;
      }
      if (!ghostOut) return;
      if (mouse) {
        pl.confirm();
        return;
      }
      if (pl.ori.length > 1 && pl.cells.some(([x, y]) => x === c[0] && y === c[1])) {
        pl.rotate();
        return;
      }
      pl.snap(2, centered(c));
    },
    [cellAt, centered, g.stones, ghostOut, pl, tileAt],
  );

  const onDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY, pos: pl.pos, moved: false, focus };
    if (e.pointerType === 'mouse' && ghostOut) pl.move(centered(cellAt(e)));
  };
  const onMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (e.pointerType === 'mouse' && ghostOut) {
      // À la souris, la plaque suit le pointeur.
      const c = cellAt(e);
      if (c[0] >= 0 && c[1] >= 0 && c[0] < g.size && c[1] < g.size) pl.move(centered(c));
      if (d) d.moved = d.moved || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 6;
      return;
    }
    if (!d || d.id !== e.pointerId) return;
    const unit = svg.current!.getBoundingClientRect().width / g.size;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (!d.moved && Math.hypot(dx, dy) < 6) return;
    d.moved = true;
    if (ghostOut) pl.move([d.pos[0] + Math.round(dx / unit), d.pos[1] + Math.round(dy / unit)]);
    else if (zoomed) setFocus([clampFocus(d.focus[0] - dx / unit), clampFocus(d.focus[1] - dy / unit)]);
  };
  const onUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    const mouse = e.pointerType === 'mouse';
    if (!d.moved) onTap(e, mouse);
    else if (!mouse && ghostOut) pl.snap(3);
  };

  // À la souris : la molette tourne, le clic droit retourne. Au clavier : R, F, les flèches et Entrée.
  useEffect(() => {
    const el = wrap.current;
    if (!el || !ghostOut) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (pl.ori.length > 1) pl.rotate();
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [ghostOut, pl]);
  useEffect(() => {
    if (!ghostOut) return;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.tagName === 'INPUT' || document.querySelector('.modal-back')) return;
      const k = e.key.toLowerCase();
      if (k === 'r') pl.rotate();
      else if (k === 'f') pl.flip();
      else if (k === 'enter' && target?.tagName !== 'BUTTON') pl.confirm();
      else if (k === 'arrowleft') pl.move([pl.pos[0] - 1, pl.pos[1]]);
      else if (k === 'arrowright') pl.move([pl.pos[0] + 1, pl.pos[1]]);
      else if (k === 'arrowup') pl.move([pl.pos[0], pl.pos[1] - 1]);
      else if (k === 'arrowdown') pl.move([pl.pos[0], pl.pos[1] + 1]);
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [ghostOut, pl]);

  // À la toute dernière seconde, une pose permise part toute seule : on ne perd pas sa plaque pour une seconde.
  const lastCall = useRef(pl.confirm);
  lastCall.current = pl.confirm;
  const legalNow = useRef(false);
  legalNow.current = pl.mode === 'steal' ? pl.stealId !== null : pl.mode !== 'base' && pl.ok;
  useEffect(() => {
    if (g.turn !== view.me || !g.endsAt) return;
    const offset = useStore.getState().clockOffset;
    const wait = g.endsAt - (Date.now() + offset) - 400;
    if (wait <= 0) return;
    const t = window.setTimeout(() => {
      if (legalNow.current) lastCall.current();
    }, wait);
    return () => window.clearTimeout(t);
  }, [g.seq, g.endsAt, g.turn, view.me]);

  // Ce qu'on peut faire s'illumine : les cases contre ton gazon, et les cases interdites hachurées.
  const hints = useMemo(() => {
    if (!ghostOut || pl.mode === 'stone') return null;
    const b = pl.work;
    const frontier: Cell[] = [];
    const forbidden: Cell[] = [];
    for (let y = 0; y < b.size; y++) {
      for (let x = 0; x < b.size; x++) {
        const i = b.index(x, y);
        if (b.owner[i] !== -1 || b.stone[i]) continue;
        if (b.touchesEnemy(x, y, pl.rank)) forbidden.push([x, y]);
        else if (pl.mode !== 'base' && b.touchesOwn(x, y, pl.rank)) frontier.push([x, y]);
      }
    }
    return { frontier, forbidden };
  }, [ghostOut, pl.mode, pl.work, pl.rank]);

  const stealable = useMemo(() => (pl.mode === 'steal' ? g.tiles.filter((t) => t.owner !== view.me && (t.kind === 'tile' || t.kind === 'plug')).map((t) => t.id) : null), [pl.mode, g.tiles, view.me]);
  const hidden = useMemo(() => flyers.map((f) => f.tileId), [flyers]);
  const twoRows = seatedPlayers.length > 4;

  return (
    <div className={cls('table-screen', twoRows && 'has-two-rows', pl.mode !== 'none' && 'is-my-turn', g.stage === 'buy' && 'is-buying')}>
      <div className="earth" aria-hidden />
      <header className="table-top">
        <span className="table-logo">
          <Logo size="sm" />
        </span>
        <span className="round-chip">
          {g.stage === 'buy' ? (
            <small>Achats</small>
          ) : (
            <>
              <small>Manche</small>
              <b>
                {g.round}
                <i>/{g.rounds}</i>
              </b>
            </>
          )}
        </span>
        <div className="table-tools">
          <button type="button" className={cls('icon-btn', react && 'is-on')} aria-label="Réagir" aria-expanded={react} onClick={() => setReact((x) => !x)}>
            <Smile size={20} />
          </button>
          <button type="button" className="icon-btn" aria-label="Menu" onClick={() => setMenu(true)}>
            <MoreHorizontal size={20} />
          </button>
        </div>
        {react && <ReactionTray onClose={() => setReact(false)} />}
      </header>

      <section className="chips" aria-label="Les jardiniers">
        {seatedPlayers.map((p) => (
          <Chip key={p.id} view={view} p={p} emotes={emotes.filter((e) => e.playerId === p.id)} onOpen={() => setSheet(p.id)} />
        ))}
      </section>

      <div className="field-frame" data-mode={pl.mode}>
        <div ref={wrap} className={cls('field-wrap', (ghostOut || zoomed) && 'is-held', zoomed && 'is-zoomed')} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={() => (drag.current = null)} onContextMenu={(e) => {
          if (!ghostOut) return;
          e.preventDefault();
          if (pl.ori.length > 1) pl.flip();
        }}>
          <div className="field-motion" style={fieldStyle}>
            <Field
              ref={svg}
              size={g.size}
              tiles={g.tiles}
              stones={g.stones}
              specials={g.specials}
              colors={colors}
              avatars={avatars}
              ghost={ghostOut ? { cells: pl.cells, ok: pl.ok, color: me?.color ?? 0 } : null}
              stonePreview={pl.mode === 'stone'}
              draftBase={pl.base ? { cell: pl.base, avatar: me?.avatar ?? '', color: me?.color ?? 0 } : null}
              frontier={hints?.frontier}
              forbidden={hints?.forbidden}
              fresh={fresh}
              hidden={hidden}
              stealable={stealable}
              selected={pl.stealId}
              removable={pl.mode === 'removeStone'}
              flash={flash}
              pings={pings}
            />
          </div>
        </div>
      </div>

      <Banner view={view} pl={pl} zoomable={zoomable} zoomed={zoomed} onZoom={() => (ghostOut ? setZoomPlacing(!zoomed) : setZoomWatching(!zoomed))} />

      {g.stage === 'buy' ? (
        pl.mode === 'none' && (
          <p className="buy-note">
            <SeedIcon size={16} /> Après la dernière manche, chacun à son tour peut acheter des mottes d’une case pour agrandir son carré.
          </p>
        )
      ) : (
        <QueueStrip queue={g.queue} selected={pl.k} live={pl.mode === 'tile'} canReach={pl.canReach} onChoose={pl.choose} cost={pl.paysWith} color={me?.color ?? 0} />
      )}

      <Dock view={view} pl={pl} />

      {flyers.map((f) => {
        const v = variety(f.color);
        const w = Math.max(...f.cells.map((c) => c[0])) + 1;
        const h = Math.max(...f.cells.map((c) => c[1])) + 1;
        return (
          <motion.svg key={f.id} className="flyer" viewBox={`0 0 ${w} ${h}`} style={{ width: w * f.unit, height: h * f.unit }} initial={{ x: f.from.x, y: f.from.y, scale: 0.7, rotate: -8 }} animate={{ x: f.to.x, y: f.to.y, scale: 1, rotate: 0 }} transition={{ duration: 0.46, ease: [0.3, 0.7, 0.3, 1] }} onAnimationComplete={() => landed(f.id)}>
            {f.cells.map(([x, y]) => (
              <rect key={`${x},${y}`} x={x} y={y} width="1.01" height="1.01" fill={v.color} />
            ))}
          </motion.svg>
        );
      })}

      <PlayerSheet view={view} id={sheet} onClose={() => setSheet(null)} />

      <Modal
        open={menu}
        onClose={() => {
          setMenu(false);
          setConfirmStop(false);
        }}
        title="Menu"
      >
        <div className="menu-list">
          <Button icon={prefs.sound ? <Volume2 size={18} /> : <VolumeX size={18} />} onClick={() => setPrefs({ sound: !prefs.sound })}>
            Son : {prefs.sound ? 'activé' : 'coupé'}
          </Button>
          <Button
            icon={<BookOpen size={18} />}
            onClick={() => {
              setMenu(false);
              setRulesOpen(true);
            }}
          >
            Les règles
          </Button>
          {isHost && (
            <Button
              variant="danger"
              icon={<Flag size={18} />}
              onClick={() => {
                // Deux appuis : un geste malheureux ne doit pas couper la partie de toute la table.
                if (!confirmStop) {
                  setConfirmStop(true);
                  return;
                }
                setConfirmStop(false);
                setMenu(false);
                void send('game:end');
              }}
            >
              {confirmStop ? 'Confirmer : arrêter pour tout le monde' : 'Arrêter la partie'}
            </Button>
          )}
          <Button variant="ghost" icon={<LogOut size={18} />} onClick={() => void leaveRoom()}>
            Quitter la table
          </Button>
        </div>
      </Modal>
    </div>
  );
}
