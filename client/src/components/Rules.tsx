// Les règles, lisibles en deux minutes et consultables à tout moment.
import { SPECIAL_NAMES, SeedIcon, SpecialIcon, TicketIcon } from './Icons';
import { useStore } from '../store';
import { Modal } from './Ui';

/** Un petit terrain d'exemple : un carré de 3 × 3 à côté d'une case interdite. */
function RuleBoard() {
  const mine: [number, number][] = [[1, 1], [2, 1], [3, 1], [1, 2], [2, 2], [3, 2], [1, 3], [2, 3], [3, 3], [4, 3]];
  const other: [number, number][] = [[6, 0], [6, 1], [7, 1], [7, 2], [6, 2]];
  const path = (list: [number, number][]) => list.map(([x, y]) => `M${x} ${y}h1v1h-1z`).join('');
  return (
    <svg className="rule-board" viewBox="0 0 8 5" aria-label="Exemple : un gazon vert en carré, et un gazon rose qu'il ne doit pas toucher par un côté">
      <rect width="8" height="5" fill="#2c1e14" />
      <path d="M0 1H8M0 2H8M0 3H8M0 4H8M1 0V5M2 0V5M3 0V5M4 0V5M5 0V5M6 0V5M7 0V5" stroke="#1a110a" strokeWidth=".03" />
      <path d={path(mine)} fill="#57b947" />
      <path d={path(other)} fill="#f178b6" />
      <path d={path([[5, 1], [5, 0], [5, 2], [6, 3], [7, 3]])} fill="rgba(217,99,58,.34)" />
      <rect x="1" y="1" width="3" height="3" fill="none" stroke="#f3ecd9" strokeWidth=".12" />
    </svg>
  );
}

export function RulesModal() {
  const open = useStore((s) => s.rulesOpen);
  const setOpen = useStore((s) => s.setRulesOpen);
  return (
    <Modal open={open} onClose={() => setOpen(false)} title="Les règles" wide>
      <div className="rules">
        <section className="rule-hero">
          <figure className="rule-figure">
            <RuleBoard />
            <figcaption>Ce gazon vert forme un carré de 3{' '}×{' '}3. Il n'a pas droit aux cases rouges : elles touchent le gazon rose par un côté.</figcaption>
          </figure>
          <p>
            Tout le monde partage un terrain et une même <b>file de plaques de gazon</b>. À ton tour, tu plantes la plaque suivante. À la fin, on regarde <b>le plus grand carré plein</b> de chacun. C'est lui qui fait gagner des <b>graines</b>, et le plus de graines l'emporte.
          </p>
        </section>

        <section>
          <h3>Planter</h3>
          <ul className="rule-list">
            <li>
              Tu tournes et retournes la plaque comme tu veux, puis tu la poses : elle doit <b>toucher ton gazon par un côté</b>.
            </li>
            <li>
              Elle ne doit <b>jamais toucher le gazon d'un autre par un côté</b>. Par un coin, c'est permis : c'est comme ça qu'on se coupe la route.
            </li>
            <li>Une plaque posée ne bouge plus. Si le temps s'écoule ou si elle n'a aucune place, elle est perdue.</li>
            <li>Au premier tour, tu choisis d'abord une case pour ta première touffe, puis ta plaque se pose contre elle.</li>
          </ul>
        </section>

        <section>
          <h3>
            La file et les bons <TicketIcon size={15} />
          </h3>
          <ul className="rule-list">
            <li>
              Tu commences avec <b>3 graines et 1 bon</b>.
            </li>
            <li>
              Un bon te laisse prendre <b>l'une des cinq plaques suivantes</b> à la place de celle du tour. Celles que tu as sautées repartent en bout de file. Le joueur d'après enchaîne sur celle qui suit la tienne : ton choix change aussi son tour.
            </li>
            <li>Sans bon, l'échange coûte une graine. Touche un jardinier pour acheter un bon ou en donner un : tout se négocie à voix haute.</li>
          </ul>
        </section>

        <section>
          <h3>Les cases spéciales</h3>
          <p>
            Entoure une case spéciale <b>sur ses quatre côtés</b> : elle devient ton gazon et son effet s'applique. Une plaque posée dessus la fait disparaître, sans effet.
          </p>
          <ul className="rule-specials">
            <li>
              <SpecialIcon kind="coupon" size={26} />
              <span>
                <b>Bon</b> : un bon de plus.
              </span>
            </li>
            <li>
              <SpecialIcon kind="seed" size={26} />
              <span>
                <b>Graine</b> : une graine de plus.
              </span>
            </li>
            <li>
              <SpecialIcon kind="stone" size={26} />
              <span>
                <b>Pierre</b> : tu poses une pierre sur une case libre. Rien n'y pousse. N'importe qui peut la retirer pendant son tour, pour une graine.
              </span>
            </li>
            <li>
              <SpecialIcon kind="steal" size={26} />
              <span>
                <b>Arrachage</b> : tu prends une plaque d'un autre, et tu la replantes chez toi. S'il n'y a pas la place, elle est perdue. La première touffe et les cases entourées ne s'arrachent pas.
              </span>
            </li>
          </ul>
          <span className="sr-only">{Object.values(SPECIAL_NAMES).join(', ')}</span>
        </section>

        <section>
          <h3>
            La fin et les comptes <SeedIcon size={15} />
          </h3>
          <ul className="rule-list">
            <li>
              Après la dernière manche, chacun à son tour peut acheter des <b>mottes d'une case</b>, à une graine pièce. Elles peuvent encore entourer une case spéciale, et même se faire arracher.
            </li>
            <li>
              Puis on regarde ton plus grand carré plein : un <b>5 × 5 ne change rien</b>, chaque case de côté en plus rapporte une graine, chaque case en moins en coûte une.
            </li>
            <li>
              Le plus grand carré de la table touche une <b>prime de 3 graines</b>. S'il y a égalité, elle se partage, mais seulement si elle se divise juste. Sinon, personne ne la touche.
            </li>
            <li>Le plus de graines gagne. En cas d'égalité, le plus grand carré passe devant.</li>
          </ul>
          <div className="rule-scale" aria-label="Barème">
            {[2, 3, 4, 5, 6, 7, 8].map((k) => (
              <span key={k}>
                <b>
                  {k} × {k}
                </b>
                <small>{k === 5 ? '0' : k > 5 ? `+${k - 5}` : `−${5 - k}`}</small>
              </span>
            ))}
          </div>
        </section>

        <section className="rule-note">
          <p>
            D'après l'épreuve <i>Laying Grass</i> de <i>The Devil's Plan</i> (Netflix). L'émission se joue à neuf, sur 30 × 30 cases, avec des plaques imprimées. Ici, le terrain s'adapte au nombre de joueurs (environ cent cases chacun) et les cases spéciales changent à chaque partie. Création de fans, non officielle.
          </p>
        </section>
      </div>
    </Modal>
  );
}
