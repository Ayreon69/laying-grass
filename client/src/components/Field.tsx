// Le terrain : un seul dessin SVG, une unité par case. Le gazon posé ne se redessine que si la partie change, pas quand la plaque en main bouge.
import { motion } from 'framer-motion';
import { forwardRef, memo, useMemo } from 'react';
import type { PlacedTile, Special, SpecialKind } from '../../../shared/protocol';
import type { Cell } from '../../../shared/shapes';
import { cls } from '../lib/util';
import { VARIETIES, variety } from '../lib/varieties';
import { AVATAR_EMOJI } from './Ui';
import { SpecialGlyph } from './Icons';

function cellsPath(cells: readonly Cell[]): string {
  return cells.map(([x, y]) => `M${x} ${y}h1v1h-1z`).join('');
}

/** Les côtés d'un groupe de cases qui ne touchent pas une case du même ensemble. */
function edgesPath(cells: readonly Cell[], same: Set<string>): string {
  let d = '';
  for (const [x, y] of cells) {
    if (!same.has(`${x},${y - 1}`)) d += `M${x} ${y}h1`;
    if (!same.has(`${x},${y + 1}`)) d += `M${x} ${y + 1}h1`;
    if (!same.has(`${x - 1},${y}`)) d += `M${x} ${y}v1`;
    if (!same.has(`${x + 1},${y}`)) d += `M${x + 1} ${y}v1`;
  }
  return d;
}

const keyset = (cells: readonly Cell[]) => new Set(cells.map(([x, y]) => `${x},${y}`));

export interface Ghost {
  cells: Cell[];
  ok: boolean;
  color: number;
}

export interface Ping {
  id: number;
  x: number;
  y: number;
  kind: SpecialKind;
}

export interface Flash {
  key: number;
  cells: Cell[];
}

export interface Reveal {
  /** Une clé par carré dévoilé. */
  key: string;
  k: number;
  x: number;
  y: number;
  color: number;
  /** Le temps de la tondeuse (s) ; 0 pour un carré déjà tondu. */
  speed: number;
}

interface FieldProps {
  size: number;
  tiles: PlacedTile[];
  stones: Cell[];
  specials: Special[];
  colors: Map<string, number>;
  avatars: Map<string, string>;
  ghost?: Ghost | null;
  draftBase?: { cell: Cell; avatar: string; color: number } | null;
  frontier?: Cell[] | null;
  forbidden?: Cell[] | null;
  fresh?: number | null;
  hidden?: readonly number[];
  stealable?: readonly number[] | null;
  selected?: number | null;
  removable?: boolean;
  stonePreview?: boolean;
  flash?: Flash | null;
  pings?: Ping[];
  reveals?: Reveal[];
}

const Soil = memo(function Soil({ size }: { size: number }) {
  const dots: Cell[] = [];
  for (let y = 5; y < size; y += 5) for (let x = 5; x < size; x += 5) dots.push([x, y]);
  return (
    <>
      <defs>
        <pattern id="lg-soil" width="2" height="2" patternUnits="userSpaceOnUse">
          <rect width="2" height="2" fill="#2c1e14" />
          <rect width="1" height="1" fill="#33241a" />
          <rect x="1" y="1" width="1" height="1" fill="#33241a" />
          <path d="M.22 .3h.01M.7 .62h.01M1.34 .22h.01M1.76 .7h.01M.4 1.5h.01M.84 1.2h.01M1.2 1.72h.01M1.66 1.3h.01" stroke="#1a110a" strokeWidth=".07" strokeLinecap="round" />
          <path d="M0 0H2M0 1H2M0 0V2M1 0V2" stroke="#1a110a" strokeWidth=".025" opacity=".7" />
        </pattern>
        {VARIETIES.map((v, i) => (
          <pattern key={v.name} id={`lg-sod-${i}`} width="1" height="1" patternUnits="userSpaceOnUse">
            <rect width="1" height="1" fill={v.color} />
            <path d={v.motif} stroke={v.dark} strokeWidth=".085" strokeLinecap="round" fill="none" opacity=".62" />
          </pattern>
        ))}
        <pattern id="lg-forbid" width=".5" height=".5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width=".5" height=".5" fill="rgba(217,99,58,.12)" />
          <path d="M0 0V.5" stroke="rgba(217,99,58,.62)" strokeWidth=".09" />
        </pattern>
      </defs>
      <rect width={size} height={size} fill="url(#lg-soil)" />
      {dots.map(([x, y]) => (
        <circle key={`${x},${y}`} cx={x} cy={y} r=".07" fill="#6e553f" />
      ))}
    </>
  );
});

const Stone = memo(function Stone({ x, y, removable }: { x: number; y: number; removable: boolean }) {
  return (
    <g className={cls('stone', removable && 'is-removable')} transform={`translate(${x} ${y})`}>
      <path d="M.07 .62C.02 .36 .24 .08 .52 .08 .82 .08 1 .36 .93 .64 .86 .92 .14 .94 .07 .62Z" fill="#3a3731" />
      <path d="M.1 .54C.06 .3 .26 .06 .52 .06 .8 .06 .96 .3 .9 .56 .84 .8 .16 .82 .1 .54Z" fill="#a09c92" />
      <path d="M.26 .3C.34 .2 .46 .17 .58 .19" stroke="#e2dfd6" strokeWidth=".06" fill="none" strokeLinecap="round" />
      {removable && <circle cx=".5" cy=".5" r=".66" fill="none" stroke="#8fd14f" strokeWidth=".1" />}
    </g>
  );
});

/** Le gazon d'un joueur : ses plaques, leurs joints, l'épaisseur de la motte et le bord de son territoire. */
const Territory = memo(function Territory({ tiles, color, avatar, hidden, fresh, stealable, selected }: { tiles: PlacedTile[]; color: number; avatar: string; hidden?: readonly number[]; fresh?: number | null; stealable?: readonly number[] | null; selected?: number | null }) {
  const v = variety(color);
  const shown = hidden?.length ? tiles.filter((t) => !hidden.includes(t.id)) : tiles;
  const all = shown.flatMap((t) => t.cells);
  const own = keyset(all);
  const below = all.filter(([x, y]) => !own.has(`${x},${y + 1}`));
  return (
    <g>
      {shown.map((t) => (
        <g key={t.id} className={cls('tile', t.id === fresh && 'is-fresh', stealable?.includes(t.id) && 'is-stealable', stealable && !stealable.includes(t.id) && 'is-off', t.id === selected && 'is-selected')}>
          <path d={cellsPath(t.cells)} fill={`url(#lg-sod-${color})`} />
          <path d={edgesPath(t.cells, keyset(t.cells))} stroke={v.dark} strokeWidth=".05" strokeLinecap="round" opacity=".85" fill="none" />
        </g>
      ))}
      <path d={below.map(([x, y]) => `M${x} ${y + 0.86}h1v.14h-1z`).join('')} fill={v.dark} opacity=".9" />
      <path d={edgesPath(all, own)} stroke="#120b06" strokeWidth=".1" strokeLinecap="round" fill="none" />
      {shown
        .filter((t) => t.kind === 'base')
        .map((t) => (
          <text key={t.id} className="tile-base" x={t.cells[0][0] + 0.5} y={t.cells[0][1] + 0.54} fontSize=".74" textAnchor="middle" dominantBaseline="central">
            {AVATAR_EMOJI[avatar] ?? '🌱'}
          </text>
        ))}
    </g>
  );
});

/** Une tondeuse passe sur le carré, rang après rang, puis son contour s'imprime. */
function SquareReveal({ r }: { r: Reveal }) {
  const v = variety(r.color);
  const pass = r.speed / r.k;
  return (
    <g>
      {Array.from({ length: r.k }, (_, i) => {
        const left = i % 2 === 0;
        return r.speed ? (
          <motion.rect key={i} y={r.y + i} height="1" fill={i % 2 ? v.dark : v.light} opacity={i % 2 ? 0.34 : 0.42} initial={{ x: left ? r.x : r.x + r.k, width: 0 }} animate={{ x: r.x, width: r.k }} transition={{ delay: i * pass, duration: pass, ease: 'linear' }} />
        ) : (
          <rect key={i} x={r.x} y={r.y + i} width={r.k} height="1" fill={i % 2 ? v.dark : v.light} opacity={i % 2 ? 0.34 : 0.42} />
        );
      })}
      <motion.g initial={r.speed ? { opacity: 0 } : false} animate={{ opacity: 1 }} transition={{ delay: r.speed, duration: 0.2 }}>
        <rect x={r.x} y={r.y} width={r.k} height={r.k} fill="none" stroke="#f3ecd9" strokeWidth=".2" rx=".08" />
        <text className="square-label" x={r.x + r.k / 2} y={r.y + r.k / 2} fontSize={Math.min(1.6, r.k * 0.42)} textAnchor="middle" dominantBaseline="central">
          {r.k}×{r.k}
        </text>
      </motion.g>
    </g>
  );
}

export const Field = forwardRef<SVGSVGElement, FieldProps>(function Field({ size, tiles, stones, specials, colors, avatars, ghost, draftBase, frontier, forbidden, fresh, hidden, stealable, selected, removable = false, stonePreview = false, flash, pings, reveals }, ref) {
  const byOwner = useMemo(() => {
    const map = new Map<string, PlacedTile[]>();
    for (const t of tiles) {
      if (!map.has(t.owner)) map.set(t.owner, []);
      map.get(t.owner)!.push(t);
    }
    return [...map.entries()];
  }, [tiles]);
  return (
    <svg ref={ref} className="field" viewBox={`0 0 ${size} ${size}`} role="img" aria-label="Le terrain">
      <Soil size={size} />
      {forbidden && forbidden.length > 0 && <path d={cellsPath(forbidden)} fill="url(#lg-forbid)" />}
      {frontier && frontier.length > 0 && <path className="field-frontier" d={cellsPath(frontier)} />}
      {specials.map((s) => (
        <g key={`${s.x},${s.y}`} transform={`translate(${s.x} ${s.y})`}>
          <SpecialGlyph kind={s.kind} />
        </g>
      ))}
      {byOwner.map(([owner, list]) => (
        <Territory key={owner} tiles={list} color={colors.get(owner) ?? 0} avatar={avatars.get(owner) ?? ''} hidden={hidden} fresh={fresh} stealable={stealable} selected={selected} />
      ))}
      {stones.map(([x, y]) => (
        <Stone key={`${x},${y}`} x={x} y={y} removable={removable} />
      ))}
      {reveals?.map((r) => <SquareReveal key={r.key} r={r} />)}
      {flash && <path key={flash.key} className="field-flash" d={cellsPath(flash.cells)} />}
      {draftBase && (
        <g>
          <path d={cellsPath([draftBase.cell])} fill={`url(#lg-sod-${draftBase.color})`} stroke="#120b06" strokeWidth=".1" />
          <text className="tile-base" x={draftBase.cell[0] + 0.5} y={draftBase.cell[1] + 0.54} fontSize=".74" textAnchor="middle" dominantBaseline="central">
            {AVATAR_EMOJI[draftBase.avatar] ?? '🌱'}
          </text>
        </g>
      )}
      {ghost &&
        (stonePreview ? (
          <g className={cls('ghost-stone', !ghost.ok && 'is-bad')}>
            <Stone x={ghost.cells[0][0]} y={ghost.cells[0][1]} removable={false} />
            <path d={cellsPath(ghost.cells)} fill="none" stroke={ghost.ok ? '#8fd14f' : '#ff6b57'} strokeWidth=".1" />
          </g>
        ) : (
          <g className={cls('ghost', ghost.ok ? 'is-ok' : 'is-bad')}>
            <path d={cellsPath(ghost.cells)} fill={ghost.ok ? `url(#lg-sod-${ghost.color})` : 'rgba(229,72,63,.72)'} opacity={ghost.ok ? 0.94 : 1} />
            <path d={edgesPath(ghost.cells, keyset(ghost.cells))} className="ghost-edge" strokeLinecap="round" fill="none" />
          </g>
        ))}
      {pings?.map((p) => (
        <g key={p.id} className="ping" transform={`translate(${p.x} ${p.y})`}>
          <circle className="ping-ring" cx=".5" cy=".5" r=".5" />
          <g className="ping-icon">
            <SpecialGlyph kind={p.kind} />
          </g>
        </g>
      ))}
    </svg>
  );
});
