// Les petits dessins du jeu : graine, bon, cases spéciales, et une plaque vue de dessus.
import { memo } from 'react';
import type { SpecialKind } from '../../../shared/protocol';
import type { Cell } from '../../../shared/shapes';

export const SPECIAL_NAMES: Record<SpecialKind, string> = {
  coupon: 'bon',
  seed: 'graine',
  stone: 'pierre',
  steal: 'arrachage',
};

export function SeedIcon({ size = 14 }: { size?: number }) {
  return (
    <svg className="ico" viewBox="0 0 16 16" width={size} height={size} aria-hidden>
      <path d="M8 1.2C11.6 4.6 12.8 9 11.6 11.8 10.8 13.8 9.4 14.8 8 14.8S5.2 13.8 4.4 11.8C3.2 9 4.4 4.6 8 1.2Z" fill="#e8b93e" stroke="#6d4c0c" strokeWidth=".9" />
      <path d="M8 4.6V11.4" stroke="#6d4c0c" strokeWidth=".9" strokeLinecap="round" />
    </svg>
  );
}

export function TicketIcon({ size = 14 }: { size?: number }) {
  return (
    <svg className="ico" viewBox="0 0 18 14" width={(size * 18) / 14} height={size} aria-hidden>
      <path d="M1 2.2C1 1.5 1.5 1 2.2 1H15.8C16.5 1 17 1.5 17 2.2V4.8A2.2 2.2 0 0 0 17 9.2V11.8C17 12.5 16.5 13 15.8 13H2.2C1.5 13 1 12.5 1 11.8V9.2A2.2 2.2 0 0 0 1 4.8Z" fill="#f3ecd9" stroke="#6b5a40" strokeWidth="1" />
      <path d="M6.2 3V11" stroke="#6b5a40" strokeWidth="1" strokeDasharray="1.4 1.4" />
    </svg>
  );
}

/** Une case spéciale, dans un carré de 1 sur 1 : on s'en sert sur le terrain comme dans le texte. */
export function SpecialGlyph({ kind }: { kind: SpecialKind }) {
  if (kind === 'coupon') {
    return (
      <g>
        <circle cx=".5" cy=".5" r=".46" fill="#f3ecd9" stroke="#221a12" strokeWidth=".05" />
        <path d="M.2 .35H.8V.44A.06 .06 0 0 0 .8 .56V.65H.2V.56A.06 .06 0 0 0 .2 .44Z" fill="#221a12" />
        <path d="M.42 .37V.63" stroke="#f3ecd9" strokeWidth=".035" strokeDasharray=".05 .04" />
      </g>
    );
  }
  if (kind === 'seed') {
    return (
      <g>
        <circle cx=".5" cy=".5" r=".46" fill="#e8b93e" stroke="#221a12" strokeWidth=".05" />
        <path d="M.5 .16C.73 .38 .77 .66 .69 .75 .62 .84 .38 .84 .31 .75 .23 .66 .27 .38 .5 .16Z" fill="#4a2f12" />
        <path d="M.5 .4V.72" stroke="#e8b93e" strokeWidth=".04" strokeLinecap="round" />
      </g>
    );
  }
  if (kind === 'stone') {
    return (
      <g>
        <circle cx=".5" cy=".5" r=".46" fill="#6e6a62" stroke="#221a12" strokeWidth=".05" />
        <path d="M.2 .62C.15 .42 .34 .26 .52 .28 .72 .28 .86 .46 .79 .64 .74 .77 .25 .79 .2 .62Z" fill="#d9d5ca" />
        <path d="M.34 .44C.4 .38 .5 .36 .58 .38" stroke="#fff" strokeWidth=".04" fill="none" strokeLinecap="round" />
      </g>
    );
  }
  return (
    <g>
      <circle cx=".5" cy=".5" r=".46" fill="#d9633a" stroke="#221a12" strokeWidth=".05" />
      <path d="M.17 .17C.42 .13 .67 .33 .66 .66 .33 .67 .13 .42 .17 .17Z" fill="#f3ecd9" />
      <path d="M.64 .64L.82 .82" stroke="#f3ecd9" strokeWidth=".09" strokeLinecap="round" />
    </g>
  );
}

export function SpecialIcon({ kind, size = 18 }: { kind: SpecialKind; size?: number }) {
  return (
    <svg className="ico" viewBox="0 0 1 1" width={size} height={size} aria-hidden>
      <SpecialGlyph kind={kind} />
    </svg>
  );
}

/** Une plaque de la file : ses cases séparées, pour bien voir sa forme. */
export const Piece = memo(function Piece({ cells, unit, fill, line }: { cells: readonly Cell[]; unit: number; fill: string; line: string }) {
  const w = Math.max(...cells.map((c) => c[0])) + 1;
  const h = Math.max(...cells.map((c) => c[1])) + 1;
  return (
    <svg className="piece" viewBox={`-.04 -.04 ${w + 0.08} ${h + 0.08}`} width={w * unit} height={h * unit} aria-hidden>
      {cells.map(([x, y]) => (
        <rect key={`${x},${y}`} x={x + 0.03} y={y + 0.03} width=".94" height=".94" rx=".16" fill={fill} stroke={line} strokeWidth=".06" />
      ))}
    </svg>
  );
});
