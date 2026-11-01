// Briques d'interface communes : boutons, fenêtres, pastilles, sélecteurs, logo, avatars et terre de la pépinière.
import { X } from 'lucide-react';
import { useEffect, useRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { cls } from '../lib/util';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'default' | 'primary' | 'ghost' | 'danger' | 'soft';
  icon?: ReactNode;
}

export function Button({ variant = 'default', icon, className, children, type = 'button', ...rest }: ButtonProps) {
  return (
    <button type={type} className={cls('btn', `btn-${variant}`, className)} {...rest}>
      {icon}
      {children && <span className="btn-label">{children}</span>}
    </button>
  );
}

/** Le titre : une étiquette de pépinière plantée dans la terre, avec son nom latin. Le petit format n'en garde que le nom. */
export function Logo({ size = 'md' }: { size?: 'sm' | 'md' | 'lg' }) {
  return (
    <div className={cls('logo', `logo-${size}`)} role="img" aria-label="Laying Grass">
      <span className="logo-tag" aria-hidden>
        <i className="logo-hole" />
        <span className="logo-word">
          Laying <em>Grass</em>
        </span>
        <small className="logo-latin">Gramen quadratum</small>
      </span>
    </div>
  );
}

/** Le décor : de la terre retournée, ses sillons et ses mottes. */
export function Backdrop({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cls('backdrop', className)}>
      <div className="earth" aria-hidden />
      <div className="backdrop-body">{children}</div>
    </div>
  );
}

export function Pill({ tone, children, className }: { tone?: 'lime' | 'ink' | 'soil' | 'cream'; children: ReactNode; className?: string }) {
  return <span className={cls('pill', tone && `pill-${tone}`, className)}>{children}</span>;
}

interface SegmentedOption<T> {
  value: T;
  label: string;
  sub?: string;
  disabled?: boolean;
}

export function Segmented<T extends string | number | boolean>({ options, value, onChange, disabled, label }: { options: SegmentedOption<T>[]; value: T; onChange: (v: T) => void; disabled?: boolean; label: string }) {
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          disabled={disabled || o.disabled}
          className={cls('seg', o.value === value && 'is-on')}
          onClick={() => onChange(o.value)}
        >
          <b>{o.label}</b>
          {o.sub && <small>{o.sub}</small>}
        </button>
      ))}
    </div>
  );
}

/**
 * Une fenêtre, rendue à la racine du document pour ne dépendre d'aucun parent.
 * Elle s'ouvre avec un petit mouvement en CSS et se ferme d'un coup.
 */
export function Modal({ open, onClose, title, children, wide, footer }: { open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean; footer?: ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    if (!open) return;
    const before = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close.current();
    };
    window.addEventListener('keydown', onKey);
    const t = window.setTimeout(() => box.current?.querySelector<HTMLElement>('[data-autofocus], .modal-body button, .modal-body input')?.focus({ preventScroll: true }), 30);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.clearTimeout(t);
      before?.focus?.({ preventScroll: true });
    };
  }, [open]);

  if (!open) return null;
  return createPortal(
    <div className="modal-back" onClick={onClose}>
      <div ref={box} className={cls('modal', wide && 'is-wide')} role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <h2>{title}</h2>
          <button type="button" className="icon-btn" aria-label="Fermer" onClick={onClose}>
            <X size={20} />
          </button>
        </header>
        <div className="modal-body">{children}</div>
        {footer && <footer className="modal-foot">{footer}</footer>}
      </div>
    </div>,
    document.body,
  );
}

export const AVATAR_EMOJI: Record<string, string> = {
  escargot: '🐌',
  abeille: '🐝',
  herisson: '🦔',
  coccinelle: '🐞',
  lapin: '🐇',
  papillon: '🦋',
  grenouille: '🐸',
  ecureuil: '🐿️',
  canard: '🦆',
  chenille: '🐛',
  poule: '🐓',
  mouton: '🐑',
};

export const AVATAR_LABELS: Record<string, string> = {
  escargot: 'Escargot',
  abeille: 'Abeille',
  herisson: 'Hérisson',
  coccinelle: 'Coccinelle',
  lapin: 'Lapin',
  papillon: 'Papillon',
  grenouille: 'Grenouille',
  ecureuil: 'Écureuil',
  canard: 'Canard',
  chenille: 'Chenille',
  poule: 'Poule',
  mouton: 'Mouton',
};

export function Avatar({ avatar, className }: { avatar: string; className?: string }) {
  return (
    <span className={cls('avatar', className)} aria-hidden>
      {AVATAR_EMOJI[avatar] ?? '🌱'}
    </span>
  );
}
