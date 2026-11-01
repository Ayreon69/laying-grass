// Accueil : six plaques tombent et forment un carré, une tondeuse passe ; pseudo + avatar, créer / rejoindre une table, jouer contre des bots, règles.
import { motion } from 'framer-motion';
import { BookOpen, Bot, House, LogIn, MessageSquare, Minus, Plus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { AVATARS, MAX_PLAYERS, MIN_PLAYERS } from '../../../shared/protocol';
import { AVATAR_EMOJI, AVATAR_LABELS, Backdrop, Button, Logo } from '../components/Ui';
import { cls } from '../lib/util';
import { codeFromUrl, createRoom, joinRoom } from '../net';
import { useStore } from '../store';

const BOTS_KEY = 'lg.bots';
const MAX_BOTS = MAX_PLAYERS - 1;
const MIN_BOTS = MIN_PLAYERS - 1;

function savedBots(): number {
  try {
    const n = Number(localStorage.getItem(BOTS_KEY));
    return n >= MIN_BOTS && n <= MAX_BOTS ? n : 3;
  } catch {
    return 3;
  }
}

/** Le carré de l'accueil : un 5 sur 5 taillé dans six plaques. */
const HERO_TILES: { cells: [number, number][]; from: [number, number]; spin: number }[] = [
  { cells: [[0, 0], [1, 0], [2, 0], [0, 1], [0, 2]], from: [-40, -70], spin: -30 },
  { cells: [[3, 0], [4, 0], [2, 1], [3, 1], [4, 1]], from: [60, -80], spin: 24 },
  { cells: [[1, 1], [1, 2], [2, 2], [1, 3]], from: [-70, 10], spin: 40 },
  { cells: [[3, 2], [4, 2], [3, 3], [4, 3], [4, 4]], from: [80, 30], spin: -22 },
  { cells: [[0, 3], [0, 4], [1, 4]], from: [-60, 70], spin: 30 },
  { cells: [[2, 3], [2, 4], [3, 4]], from: [30, 80], spin: -36 },
];

const SHADES = ['#57b947', '#62c552', '#4eac40', '#5cc04c', '#4aa53c', '#66c956'];

function HeroSquare() {
  const [mown, setMown] = useState(false);
  useEffect(() => {
    const t = window.setTimeout(() => setMown(true), 1500);
    return () => window.clearTimeout(t);
  }, []);
  return (
    <div className="hero-square" aria-hidden>
      <svg viewBox="-.2 -.2 5.4 5.4">
        <rect x="-.2" y="-.2" width="5.4" height="5.4" rx=".14" fill="#1a110a" />
        {HERO_TILES.map((t, i) => (
          <motion.g key={i} initial={{ x: t.from[0] / 30, y: t.from[1] / 30, rotate: t.spin, opacity: 0 }} animate={{ x: 0, y: 0, rotate: 0, opacity: 1 }} transition={{ delay: 0.15 + i * 0.15, type: 'spring', stiffness: 260, damping: 19 }} style={{ transformOrigin: '2.5px 2.5px', transformBox: 'view-box' }}>
            <path d={t.cells.map(([x, y]) => `M${x} ${y}h1v1h-1z`).join('')} fill={SHADES[i]} />
            <path d={t.cells.map(([x, y]) => `M${x + 0.25} ${y + 0.78}L${x + 0.3} ${y + 0.42}M${x + 0.52} ${y + 0.84}L${x + 0.52} ${y + 0.3}M${x + 0.8} ${y + 0.76}L${x + 0.74} ${y + 0.44}`).join('')} stroke="#2a7526" strokeWidth=".07" strokeLinecap="round" opacity=".55" />
            <path d={edgePath(t.cells)} stroke="#2a7526" strokeWidth=".06" strokeLinecap="round" fill="none" />
          </motion.g>
        ))}
        {mown &&
          [0, 1, 2, 3, 4].map((i) => (
            <motion.rect key={i} y={i} height="1" fill={i % 2 ? '#2a7526' : '#c7f5b4'} opacity={i % 2 ? 0.2 : 0.3} initial={{ x: i % 2 ? 5 : 0, width: 0 }} animate={{ x: 0, width: 5 }} transition={{ delay: i * 0.22, duration: 0.22, ease: 'linear' }} />
          ))}
      </svg>
    </div>
  );
}

function edgePath(cells: [number, number][]): string {
  const has = new Set(cells.map(([x, y]) => `${x},${y}`));
  let d = '';
  for (const [x, y] of cells) {
    if (!has.has(`${x},${y - 1}`)) d += `M${x} ${y}h1`;
    if (!has.has(`${x},${y + 1}`)) d += `M${x} ${y + 1}h1`;
    if (!has.has(`${x - 1},${y}`)) d += `M${x} ${y}v1`;
    if (!has.has(`${x + 1},${y}`)) d += `M${x + 1} ${y}v1`;
  }
  return d;
}

export function Home() {
  const profile = useStore((s) => s.profile);
  const setProfile = useStore((s) => s.setProfile);
  const setRulesOpen = useStore((s) => s.setRulesOpen);
  const conn = useStore((s) => s.conn);
  const [invited, setInvited] = useState(codeFromUrl);
  const [code, setCode] = useState('');
  const [bots, setBots] = useState(savedBots);
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => {
    const sync = () => setInvited(codeFromUrl());
    window.addEventListener('lg:url', sync);
    return () => window.removeEventListener('lg:url', sync);
  }, []);
  const nameOk = profile.name.trim().length > 0;

  const run = async (key: string, fn: () => Promise<boolean>) => {
    if (busy) return;
    if (!nameOk) {
      useStore.getState().showToast('Choisis d’abord un pseudo.', 'info');
      document.getElementById('pseudo')?.focus();
      return;
    }
    setBusy(key);
    await fn();
    setBusy(null);
  };

  const changeBots = (d: number) => {
    const n = Math.max(MIN_BOTS, Math.min(MAX_BOTS, bots + d));
    setBots(n);
    try {
      localStorage.setItem(BOTS_KEY, String(n));
    } catch {
      /* stockage indisponible */
    }
  };

  const cleanCode = code.replace(/[^A-Za-z]/g, '').toUpperCase().slice(0, 4);

  return (
    <Backdrop className="home">
      <div className="home-links">
        <a className="all-games" href="https://akhis-games.onrender.com">
          <House size={16} aria-hidden /> Tous les jeux
        </a>
        <a className="all-games" href="https://akhis-games.onrender.com/feedback.html?jeu=laying-grass">
          <MessageSquare size={16} aria-hidden /> Feedback
        </a>
      </div>
      <div className="home-main">
      <header className="home-hero">
        <motion.div initial={{ y: -14, opacity: 0, rotate: -6 }} animate={{ y: 0, opacity: 1, rotate: -2 }} transition={{ duration: 0.5 }}>
          <Logo size="lg" />
        </motion.div>
        <HeroSquare />
        <p className="tagline">
          Plante tes plaques, arrache celles des autres, fais pousser <b>le plus grand carré</b>.
        </p>
      </header>

      <motion.section className="panel home-panel" initial={{ y: 26, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.15, duration: 0.45 }}>
        {invited && (
          <div className="invite-banner">
            Invitation à la table <b>{invited}</b> : choisis ton pseudo et entre !
          </div>
        )}
        <label className="field-label" htmlFor="pseudo">
          Ton pseudo
        </label>
        <input
          id="pseudo"
          className="input input-lg"
          placeholder="Ex. Pâquerette"
          value={profile.name}
          maxLength={16}
          autoComplete="nickname"
          onChange={(e) => setProfile({ name: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && invited) void run('join', () => joinRoom(invited));
          }}
        />
        <span className="field-label" id="avatar-label">
          Ton compagnon de jardin
        </span>
        <div className="avatar-picker" role="radiogroup" aria-labelledby="avatar-label">
          {AVATARS.map((a) => (
            <button key={a} type="button" role="radio" aria-checked={profile.avatar === a} aria-label={AVATAR_LABELS[a]} className={cls('avatar-opt', profile.avatar === a && 'is-on')} onClick={() => setProfile({ avatar: a })}>
              {AVATAR_EMOJI[a]}
            </button>
          ))}
        </div>

        {invited ? (
          <div className="home-actions">
            <Button variant="primary" className="btn-lg" icon={<LogIn size={20} />} disabled={!!busy} onClick={() => run('join', () => joinRoom(invited))}>
              {busy === 'join' ? 'Connexion…' : `Rejoindre la table ${invited}`}
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                window.history.replaceState(null, '', '/');
                setInvited(null);
              }}
            >
              Créer ma propre table à la place
            </Button>
          </div>
        ) : (
          <div className="home-actions">
            <Button variant="primary" className="btn-lg" icon={<Plus size={20} />} disabled={!!busy} onClick={() => run('create', () => createRoom())}>
              {busy === 'create' ? 'Création…' : 'Créer une table'}
            </Button>
            <div className="join-row">
              <input
                className="input code-input"
                placeholder="CODE"
                value={cleanCode}
                maxLength={4}
                aria-label="Code de la table"
                autoCapitalize="characters"
                onChange={(e) => setCode(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && cleanCode.length === 4) void run('join', () => joinRoom(cleanCode));
                }}
              />
              <Button icon={<LogIn size={18} />} disabled={cleanCode.length !== 4 || !!busy} onClick={() => run('join', () => joinRoom(cleanCode))}>
                Rejoindre
              </Button>
            </div>
            <div className="bots-row">
              <Button className="bots-go" icon={<Bot size={18} />} disabled={!!busy} onClick={() => run('bots', () => createRoom({ bots, autostart: true }))}>
                {busy === 'bots' ? 'Préparation…' : bots > 1 ? `Jouer contre ${bots} bots` : 'Jouer contre 1 bot'}
              </Button>
              <div className="stepper" role="group" aria-label="Nombre de bots">
                <button type="button" className="icon-btn" aria-label="Un bot de moins" disabled={bots <= MIN_BOTS} onClick={() => changeBots(-1)}>
                  <Minus size={16} />
                </button>
                <button type="button" className="icon-btn" aria-label="Un bot de plus" disabled={bots >= MAX_BOTS} onClick={() => changeBots(1)}>
                  <Plus size={16} />
                </button>
              </div>
            </div>
          </div>
        )}
        <Button variant="ghost" className="rules-link" icon={<BookOpen size={18} />} onClick={() => setRulesOpen(true)}>
          Les règles en 2 minutes
        </Button>
        {conn !== 'online' && (
          <p className="wake-note" role="status">
            <span className="spinner" /> Réveil du serveur… (jusqu'à une minute la première fois)
          </p>
        )}
      </motion.section>
      </div>

      <footer className="home-foot">
        D'après l'épreuve <i>Laying Grass</i> de <i>The Devil's Plan</i> (Netflix). Création de fans, non officielle.
      </footer>
    </Backdrop>
  );
}
