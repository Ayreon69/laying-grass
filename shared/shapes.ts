// Les plaques de gazon : 96 formes de 2 à 7 cases, tournées et retournées à volonté.

export type Cell = [number, number];

/** Ramène une forme contre l'origine, ses cases rangées : deux formes identiques s'écrivent pareil. */
export function normalize(cells: readonly Cell[]): Cell[] {
  const minX = Math.min(...cells.map((c) => c[0]));
  const minY = Math.min(...cells.map((c) => c[1]));
  return cells.map(([x, y]): Cell => [x - minX, y - minY]).sort((a, b) => a[1] - b[1] || a[0] - b[0]);
}

/** Un quart de tour vers la droite. */
export function rotate(cells: readonly Cell[]): Cell[] {
  return normalize(cells.map(([x, y]): Cell => [-y, x]));
}

/** Un retournement gauche-droite. */
export function flip(cells: readonly Cell[]): Cell[] {
  return normalize(cells.map(([x, y]): Cell => [-x, y]));
}

export function shapeKey(cells: readonly Cell[]): string {
  return normalize(cells)
    .map(([x, y]) => `${x},${y}`)
    .join(';');
}

/** Toutes les orientations différentes d'une forme : une à huit selon ses symétries. */
export function orientations(cells: readonly Cell[]): Cell[][] {
  const seen = new Map<string, Cell[]>();
  let cur = normalize(cells);
  for (let f = 0; f < 2; f++) {
    for (let r = 0; r < 4; r++) {
      seen.set(shapeKey(cur), cur);
      cur = rotate(cur);
    }
    cur = flip(cur);
  }
  return [...seen.values()];
}

/** La même forme écrite de la même façon, quelle que soit son orientation : on garde la plus petite écriture. */
function canonical(cells: readonly Cell[]): string {
  return orientations(cells)
    .map(shapeKey)
    .sort()[0];
}

/** Les formes d'une case de plus : à chaque forme, on ajoute une case contre son bord. */
function grow(shapes: Cell[][]): Cell[][] {
  const seen = new Map<string, Cell[]>();
  for (const shape of shapes) {
    const taken = new Set(shape.map(([x, y]) => `${x},${y}`));
    for (const [x, y] of shape) {
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        const nx = x + dx;
        const ny = y + dy;
        if (taken.has(`${nx},${ny}`)) continue;
        const next = normalize([...shape, [nx, ny]]);
        const key = canonical(next);
        if (!seen.has(key)) seen.set(key, next);
      }
    }
  }
  return [...seen.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([, s]) => s);
}

/** Une forme avec un trou ne se pose pas bien : on l'écarte. */
function hasHole(cells: readonly Cell[]): boolean {
  const w = Math.max(...cells.map((c) => c[0])) + 3;
  const h = Math.max(...cells.map((c) => c[1])) + 3;
  const filled = new Set(cells.map(([x, y]) => `${x + 1},${y + 1}`));
  const seen = new Set<string>();
  const stack: Cell[] = [[0, 0]];
  while (stack.length) {
    const [x, y] = stack.pop()!;
    const key = `${x},${y}`;
    if (x < 0 || y < 0 || x >= w || y >= h || seen.has(key) || filled.has(key)) continue;
    seen.add(key);
    stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
  }
  return seen.size + filled.size !== w * h;
}

function buildShapes(): Cell[][] {
  const bySize: Cell[][][] = [[], [[[0, 0]]]];
  for (let n = 2; n <= 7; n++) bySize[n] = grow(bySize[n - 1]);
  const repeat = (shapes: Cell[][], times: number[]): Cell[][] => shapes.flatMap((s, i) => Array.from({ length: times[i] ?? 1 }, () => s));
  // Comme dans l'émission, les petites formes reviennent plus souvent, et la plupart des plaques font 5 ou 6 cases.
  const heptominoes = bySize[7].filter((s) => !hasHole(s));
  const step = heptominoes.length / 11;
  return [
    ...repeat(bySize[2], [3]),
    ...repeat(bySize[3], [3, 4]),
    ...repeat(bySize[4], [3, 3, 3, 3, 4]),
    ...repeat(bySize[5], Array(12).fill(2)),
    ...bySize[6],
    ...Array.from({ length: 11 }, (_, i) => heptominoes[Math.floor(i * step)]),
  ];
}

export const SHAPES: Cell[][] = buildShapes();
