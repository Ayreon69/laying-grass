// Fin de partie : le terrain, la tondeuse passe sur chaque carré du plus petit au plus grand, puis les comptes et la revanche.
import confetti from 'canvas-confetti';
import { motion } from 'framer-motion';
import { FastForward, LogOut, RotateCcw, Trophy } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { FinalPlayer, RoomView } from '../../../shared/protocol';
import { Field, type Reveal } from '../components/Field';
import { SeedIcon } from '../components/Icons';
import { Avatar, Backdrop, Button, Logo } from '../components/Ui';
import { sfx } from '../lib/sound';
import { placeLabel, signed } from '../lib/text';
import { cls, reducedMotion } from '../lib/util';
import { variety } from '../lib/varieties';
import { leaveRoom, send } from '../net';

const MOW_SECONDS = 1;
const STEP_MS = 1900;

const squareText = (k: number) => `${k} × ${k}`;
const seeds = (n: number) => (n < 0 ? `−${-n} graine${n < -1 ? 's' : ''}` : `${n} graine${n > 1 ? 's' : ''}`);

function Stamp({ p, big }: { p: FinalPlayer; big?: boolean }) {
  const v = variety(p.color);
  return (
    <motion.span className={cls('square-stamp', big && 'is-big')} style={{ '--c': v.color, '--d': v.dark } as React.CSSProperties} initial={{ scale: 2.1, opacity: 0, rotate: -14 }} animate={{ scale: 1, opacity: 1, rotate: -4 }} transition={{ type: 'spring', stiffness: 420, damping: 18 }}>
      {p.square.k > 0 ? squareText(p.square.k) : 'rien'}
    </motion.span>
  );
}

export function Final({ view }: { view: RoomView }) {
  const final = view.final!;
  const isHost = view.hostId === view.me;
  const mine = final.players.find((p) => p.id === view.me);
  const winners = final.players.filter((p) => p.winner);
  // Du plus petit au plus grand : le plus beau passe en dernier.
  const order = useMemo(() => [...final.players].sort((a, b) => a.square.k - b.square.k), [final.players]);
  const [step, setStep] = useState(reducedMotion() ? order.length : 0);
  const done = step >= order.length;
  const once = useRef(false);

  useEffect(() => {
    if (done) return;
    if (order[step].square.k > 0) sfx.mow(MOW_SECONDS);
    const stamp = window.setTimeout(() => sfx.stamp(), MOW_SECONDS * 1000);
    const t = window.setTimeout(() => setStep((s) => s + 1), STEP_MS);
    return () => {
      window.clearTimeout(stamp);
      window.clearTimeout(t);
    };
  }, [step, done, order]);

  useEffect(() => {
    if (!done || once.current) return;
    once.current = true;
    const good = !!mine?.winner;
    sfx.fanfare(good);
    if (reducedMotion() || !good) return;
    const t = window.setTimeout(() => {
      void confetti({ particleCount: 170, spread: 100, origin: { y: 0.3 }, colors: ['#57b947', '#8fd14f', '#2a7526', '#c7f5b4', '#e8b93e'], shapes: ['square'], scalar: 0.8, gravity: 0.7, disableForReducedMotion: true });
    }, 300);
    return () => window.clearTimeout(t);
  }, [done, mine]);

  const colors = useMemo(() => new Map(final.players.map((p) => [p.id, p.color])), [final.players]);
  const avatars = useMemo(() => new Map(final.players.map((p) => [p.id, p.avatar])), [final.players]);

  const reveals: Reveal[] = order.slice(0, Math.min(step + 1, order.length)).filter((p) => p.square.k > 0).map((p) => ({ key: p.id, k: p.square.k, x: p.square.x, y: p.square.y, color: p.color, speed: order.indexOf(p) === step ? MOW_SECONDS : 0 }));
  const current = done ? null : order[step];

  let title: string;
  if (winners.length > 1) title = mine?.winner ? 'Égalité en tête, avec toi !' : `Égalité : ${winners.map((p) => p.name).join(' et ')}`;
  else if (mine?.winner) title = 'Tu remportes la pépinière !';
  else title = `${winners[0]?.name ?? '?'} remporte la pépinière`;
  const top = winners[0];
  const sub = top ? `${seeds(top.total)}, avec ${top.square.k > 0 ? `un carré de ${squareText(top.square.k)}` : 'aucun carré'}.` : '';

  return (
    <Backdrop>
      <div className="final">
        <header className="final-top">
          <Logo size="sm" />
          <Button variant="ghost" icon={<LogOut size={18} />} onClick={() => void leaveRoom()}>
            Quitter
          </Button>
        </header>

        <div className="final-grid">
          <div className="final-board">
            <div className="field-frame">
              <div className="field-wrap">
                <Field size={final.size} tiles={final.tiles} stones={final.stones} specials={final.specials} colors={colors} avatars={avatars} reveals={reveals} />
              </div>
            </div>
          </div>

          <div className="final-side">
            {!done && current ? (
              <section className="reveal-card">
                <span className="eyebrow">La tondeuse passe</span>
                <motion.div key={current.id} className="reveal-who" initial={{ x: -14, opacity: 0 }} animate={{ x: 0, opacity: 1 }}>
                  <Avatar avatar={current.avatar} className="player-avatar" />
                  <b>{current.id === view.me ? 'Toi' : current.name}</b>
                  <motion.span key={`s${current.id}`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: MOW_SECONDS }}>
                    <Stamp p={current} big />
                  </motion.span>
                </motion.div>
                <Button variant="ghost" icon={<FastForward size={18} />} onClick={() => setStep(order.length)}>
                  Passer aux comptes
                </Button>
              </section>
            ) : (
              <>
                <motion.section className="final-hero" initial={{ y: 18, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ duration: 0.4 }}>
                  <span className="eyebrow">Partie terminée en {final.rounds} manches</span>
                  <h1>{title}</h1>
                  {sub && <p className="final-reason">{sub}</p>}
                </motion.section>

                <section className="panel final-table">
                  <h3>Les comptes</h3>
                  <ol className="final-list">
                    {final.players.map((p, i) => {
                      const v = variety(p.color);
                      return (
                        <motion.li key={p.id} className={cls('final-row', p.winner && 'is-winner', p.id === view.me && 'is-me')} style={{ '--c': v.color } as React.CSSProperties} initial={{ x: -14, opacity: 0 }} animate={{ x: 0, opacity: 1 }} transition={{ delay: 0.1 + i * 0.07 }}>
                          <span className="final-place">{placeLabel(p.place)}</span>
                          <span className="chip-sod">
                            <Avatar avatar={p.avatar} />
                          </span>
                          <span className="final-who">
                            <b>{p.id === view.me ? 'Toi' : p.name}</b>
                            <small>
                              {seeds(p.before)} · {p.square.k > 0 ? `carré ${squareText(p.square.k)}` : 'aucun carré'} ({signed(p.reward)}){p.prize > 0 ? ` · prime ${signed(p.prize)}` : ''}
                            </small>
                          </span>
                          {p.wins > 0 && (
                            <span className="final-wins" title="Parties gagnées à cette table, ce soir">
                              <Trophy size={13} aria-hidden /> {p.wins}
                            </span>
                          )}
                          <span className="final-total">
                            <SeedIcon size={15} />
                            <b>{p.total < 0 ? `−${-p.total}` : p.total}</b>
                          </span>
                        </motion.li>
                      );
                    })}
                  </ol>
                  <p className="muted small">Un carré de 5{' '}×{' '}5 ne change rien, chaque case de côté vaut une graine. Le plus grand carré touche la prime de 3, partagée seulement si elle se divise. Le trophée compte les parties gagnées ce soir.</p>
                </section>

                <div className="lobby-cta">
                  {isHost ? (
                    <Button variant="primary" className="btn-lg btn-wide" icon={<RotateCcw size={20} />} onClick={() => void send('game:restart')}>
                      Rejouer
                    </Button>
                  ) : (
                    <div className="waiting" role="status">
                      <span className="spinner" /> En attente de la revanche…
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </Backdrop>
  );
}
