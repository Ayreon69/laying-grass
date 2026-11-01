// Les phrases de la partie : ce qui vient de se passer, dit à la deuxième personne quand c'est toi.
import type { GameEvent, RoomView, SpecialKind } from '../../../shared/protocol';

export function nameOf(view: RoomView, id: string | null | undefined): string {
  return view.players.find((p) => p.id === id)?.name ?? '?';
}

export function placeLabel(place: number): string {
  return place === 1 ? '1re' : `${place}e`;
}

export function signed(n: number): string {
  return n > 0 ? `+${n}` : n < 0 ? `−${-n}` : '0';
}

const EFFECT: Record<SpecialKind, string> = {
  coupon: '+1 bon',
  seed: '+1 graine',
  stone: 'une pierre à poser',
  steal: 'un arrachage',
};

export function eventLine(view: RoomView, e: GameEvent): string {
  const mine = e.player === view.me;
  const who = nameOf(view, e.player);
  const other = e.other === view.me ? 'toi' : nameOf(view, e.other);
  const verb = (me: string, them: string) => (mine ? `Tu ${me}` : `${who} ${them}`);
  switch (e.type) {
    case 'place': {
      let line = verb('plantes', 'plante');
      if (e.k) line += e.paid === 'coupon' ? ` la ${e.k + 1}e plaque, pour un bon` : ` la ${e.k + 1}e plaque, pour une graine`;
      if (e.activated?.length) line += ` et entoure : ${e.activated.map((k) => EFFECT[k]).join(', ')}`;
      return `${line}.`;
    }
    case 'plug':
      return e.activated?.length ? `${verb('achètes', 'achète')} une motte et entoure : ${e.activated.map((k) => EFFECT[k]).join(', ')}.` : `${verb('achètes', 'achète')} une motte.`;
    case 'discard':
      if (e.why === 'time') return `Temps écoulé : ${mine ? 'tu perds' : `${who} perd`} la plaque.`;
      if (e.why === 'stuck') return `${mine ? 'Tu n’as' : `${who} n’a`} plus de place : la plaque est perdue.`;
      return `${verb('renonces', 'renonce')} à la plaque.`;
    case 'stealTake':
      return e.other === view.me ? `${who} t’arrache une plaque !` : `${verb('arraches', 'arrache')} une plaque à ${other}.`;
    case 'stealPlace':
      return e.activated?.length ? `${verb('replantes', 'replante')} la plaque arrachée et entoure : ${e.activated.map((k) => EFFECT[k]).join(', ')}.` : `${verb('replantes', 'replante')} la plaque arrachée.`;
    case 'stealLost':
      return 'La plaque arrachée est perdue.';
    case 'stoneSet':
      return `${verb('poses', 'pose')} une pierre.`;
    case 'stoneOff':
      return `${verb('retires', 'retire')} une pierre pour une graine.`;
    case 'skip':
      return e.why === 'time' ? `Temps écoulé : ${mine ? 'tu perds' : `${who} perd`} l’effet.` : `${verb('renonces', 'renonce')} à l’effet.`;
    case 'buyCoupon':
      return `${verb('achètes', 'achète')} un bon.`;
    case 'giveCoupon':
      return `${verb('donnes', 'donne')} un bon à ${other}.`;
  }
}
