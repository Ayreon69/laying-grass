// Chaque siège est une vraie variété d'herbe ornementale : sa couleur, et un motif pour qui distingue mal les couleurs.

export interface Variety {
  name: string;
  latin: string;
  color: string;
  dark: string;
  light: string;
  /** Le dessin d'une case, dans un carré de 1 sur 1. */
  motif: string;
}

export const VARIETIES: Variety[] = [
  { name: 'Pâturin', latin: 'Poa pratensis', color: '#57b947', dark: '#2a7526', light: '#9be986', motif: 'M.2 .78L.25 .42M.5 .84L.5 .3M.8 .76L.74 .44' },
  { name: 'Fétuque bleue', latin: 'Festuca glauca', color: '#5fb4d6', dark: '#256f93', light: '#b4e6f7', motif: 'M.5 .82L.24 .36M.5 .82L.5 .22M.5 .82L.76 .36' },
  { name: 'Muhly rose', latin: 'Muhlenbergia capillaris', color: '#f178b6', dark: '#a92f74', light: '#ffc8e4', motif: 'M.25 .3h.01M.7 .24h.01M.48 .55h.01M.2 .78h.01M.8 .72h.01' },
  { name: 'Laîche orange', latin: 'Carex testacea', color: '#f08a2e', dark: '#a04d0c', light: '#ffcb96', motif: 'M.18 .82Q.28 .3 .78 .22M.42 .86Q.52 .52 .86 .5' },
  { name: 'Stipe dorée', latin: 'Stipa tenuissima', color: '#efd04c', dark: '#957a0c', light: '#fff4b0', motif: 'M.12 .55L.55 .12M.3 .88L.88 .3M.68 .86L.86 .68' },
  { name: 'Herbe sanglante', latin: 'Imperata cylindrica', color: '#e5483f', dark: '#951c17', light: '#ffa49d', motif: 'M.16 .3H.84M.16 .7H.84' },
  { name: 'Herbe pourpre', latin: 'Pennisetum setaceum', color: '#a374f0', dark: '#5c2fae', light: '#dac6ff', motif: 'M.5 .2V.8M.26 .35L.74 .65M.74 .35L.26 .65' },
  { name: 'Miscanthus argenté', latin: 'Miscanthus sinensis', color: '#e6e4d6', dark: '#837f6c', light: '#ffffff', motif: 'M.18 .46L.5 .18L.82 .46M.18 .82L.5 .54L.82 .82' },
];

export function variety(i: number): Variety {
  return VARIETIES[i] ?? VARIETIES[0];
}
