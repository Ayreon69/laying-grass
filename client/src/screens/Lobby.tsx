// Salon : partage de la table, jardiniers et leur variété, réglages de l'hôte et lancement.
import { motion } from 'framer-motion';
import { BookOpen, Bot, Check, Copy, Crown, LogOut, Play, QrCode, Share2, Trophy, UserX } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { useState } from 'react';
import { MAX_PLAYERS, MIN_PLAYERS, ROUND_OPTIONS, THINK_OPTIONS, boardSize, type PlayerView, type RoomView, type RoundCount, type ThinkTime } from '../../../shared/protocol';
import { Avatar, Backdrop, Button, Logo, Modal, Pill, Segmented } from '../components/Ui';
import { cls, shareUrl } from '../lib/util';
import { variety } from '../lib/varieties';
import { leaveRoom, send } from '../net';
import { useStore } from '../store';

function PlayerRow({ view, p, i, isHost }: { view: RoomView; p: PlayerView; i: number; isHost: boolean }) {
  const v = variety(p.color);
  return (
    <motion.li className={cls('player-row', p.id === view.me && 'is-me')} style={{ '--c': v.color, '--d': v.dark } as React.CSSProperties} initial={{ x: -10, opacity: 0 }} animate={{ x: 0, opacity: 1 }} transition={{ delay: i * 0.03 }}>
      <svg className="player-sod" viewBox="0 0 1 1" aria-hidden>
        <rect width="1" height="1" fill={v.color} />
        <path d={v.motif} stroke={v.dark} strokeWidth=".085" strokeLinecap="round" fill="none" opacity=".62" />
      </svg>
      <Avatar avatar={p.avatar} className="player-avatar" />
      <span className="player-who">
        <span className="player-name">
          {p.name}
          {p.id === view.me && <span className="muted"> (toi)</span>}
        </span>
        <small className="player-latin">{v.latin}</small>
      </span>
      {p.wins > 0 && (
        <Pill tone="lime" className="wins-pill">
          <Trophy size={12} aria-hidden /> {p.wins}
        </Pill>
      )}
      {p.isHost && (
        <Pill tone="ink">
          <Crown size={12} aria-hidden /> Hôte
        </Pill>
      )}
      {p.isBot && <Pill tone="soil">Bot</Pill>}
      {!p.connected && <Pill>Hors ligne</Pill>}
      {isHost && p.id !== view.me && (
        <button type="button" className="icon-btn" aria-label={`Retirer ${p.name}`} onClick={() => void send('room:kick', { playerId: p.id })}>
          <UserX size={18} />
        </button>
      )}
    </motion.li>
  );
}

export function Lobby({ view }: { view: RoomView }) {
  const setRulesOpen = useStore((s) => s.setRulesOpen);
  const isHost = view.hostId === view.me;
  const seated = view.players.filter((p) => p.status !== 'spectator');
  const spectators = view.players.filter((p) => p.status === 'spectator');
  const [copied, setCopied] = useState(false);
  const [qr, setQr] = useState(false);
  const url = shareUrl(view.code);
  const host = view.players.find((p) => p.id === view.hostId);
  const s = view.settings;
  const blocked = seated.length < MIN_PLAYERS ? `Il faut au moins ${MIN_PLAYERS} joueurs` : null;
  const side = boardSize(Math.max(MIN_PLAYERS, seated.length));

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      useStore.getState().showToast(`Lien : ${url}`, 'info');
    }
  };
  const share = async () => {
    if (navigator.share) {
      try {
        await navigator.share({ title: 'Laying Grass', text: `Rejoins ma table de Laying Grass (code ${view.code}) !`, url });
      } catch {
        /* partage annulé */
      }
    } else void copy();
  };

  return (
    <Backdrop>
      <div className="lobby">
        <header className="lobby-top">
          <Logo size="sm" />
          <Button variant="ghost" icon={<LogOut size={18} />} onClick={() => void leaveRoom()}>
            Quitter
          </Button>
        </header>

        <motion.section className="code-panel" initial={{ y: 12, opacity: 0 }} animate={{ y: 0, opacity: 1 }}>
          <div className="code-tag">
            <i className="logo-hole" aria-hidden />
            <span className="code-eyebrow">Code de la table</span>
            <div className="big-code" aria-label={`Code ${view.code.split('').join(' ')}`}>
              {view.code}
            </div>
          </div>
          <div className="share-row">
            <Button variant="primary" icon={<Share2 size={18} />} onClick={share}>
              Inviter
            </Button>
            <Button icon={copied ? <Check size={18} /> : <Copy size={18} />} onClick={copy}>
              {copied ? 'Lien copié !' : 'Copier le lien'}
            </Button>
            <Button icon={<QrCode size={18} />} onClick={() => setQr(true)} aria-label="Afficher le QR code">
              QR
            </Button>
          </div>
        </motion.section>

        <div className="lobby-grid">
          <section className="panel">
            <div className="panel-head">
              <h3>
                Jardiniers <span className="muted">{seated.length}/{MAX_PLAYERS}</span>
              </h3>
              {isHost && (
                <Button variant="soft" icon={<Bot size={18} />} disabled={seated.length >= MAX_PLAYERS} onClick={() => void send('room:addBot')}>
                  Ajouter un bot
                </Button>
              )}
            </div>
            <ul className="player-list">
              {seated.map((p, i) => (
                <PlayerRow key={p.id} view={view} p={p} i={i} isHost={isHost} />
              ))}
              {Array.from({ length: Math.max(0, MIN_PLAYERS - seated.length) }, (_, i) => (
                <li key={`empty${i}`} className="player-row is-empty">
                  <span className="player-ghost">?</span>
                  <span className="player-name muted">En attente d'un joueur…</span>
                </li>
              ))}
            </ul>
            {spectators.length > 0 && <p className="muted small">Spectateurs : {spectators.map((p) => p.name).join(', ')}</p>}
            <p className="muted small lobby-note">De 2 à 8 joueurs. Le terrain grandit avec la table : {side}{' '}×{' '}{side} cases ici.</p>
          </section>

          <section className="panel">
            <div className="panel-head">
              <h3>Réglages</h3>
              {!isHost && <span className="muted small">choisis par {host?.name ?? "l'hôte"}</span>}
            </div>
            <span className="field-label">Longueur de la partie</span>
            <Segmented<RoundCount>
              label="Longueur de la partie"
              value={s.rounds}
              disabled={!isHost}
              onChange={(rounds) => void send('room:settings', { rounds })}
              options={ROUND_OPTIONS.map((r) => ({ value: r, label: `${r} manches`, sub: r === 9 ? 'comme l’émission' : 'plus court' }))}
            />
            <span className="field-label">Temps pour chaque geste</span>
            <Segmented<ThinkTime>
              label="Temps pour chaque geste"
              value={s.think}
              disabled={!isHost}
              onChange={(think) => void send('room:settings', { think })}
              options={THINK_OPTIONS.map((t) => ({ value: t, label: t === 0 ? 'Sans limite' : t === 120 ? '2 min' : `${t} s` }))}
            />
            <p className="muted small lobby-note">Le temps écoulé, la plaque du tour est perdue.</p>
          </section>
        </div>

        <div className="lobby-cta">
          {isHost ? (
            <Button variant="primary" className="btn-lg btn-wide" icon={<Play size={20} />} disabled={!!blocked} onClick={() => void send('game:start')}>
              {blocked ?? `Lancer la partie (${seated.length} joueurs)`}
            </Button>
          ) : (
            <div className="waiting" role="status">
              <span className="spinner" /> En attente que {host?.name ?? "l'hôte"} lance la partie…
            </div>
          )}
          <Button variant="ghost" icon={<BookOpen size={18} />} onClick={() => setRulesOpen(true)}>
            Nouveau ? Les règles en 2 minutes
          </Button>
        </div>

        <Modal open={qr} onClose={() => setQr(false)} title={`Table ${view.code}`}>
          <div className="qr-box">
            <QRCodeSVG value={url} size={220} bgColor="#f3ecd9" fgColor="#221a12" level="M" includeMargin />
            <p className="muted small">Scanne pour rejoindre la table directement.</p>
            <code className="url-code">{url}</code>
          </div>
        </Modal>
      </div>
    </Backdrop>
  );
}
