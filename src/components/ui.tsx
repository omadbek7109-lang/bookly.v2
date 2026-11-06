import { useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useT, useUi } from '../app/AppContext';
import { Icon, type IconName } from './Icon';

// ------------------------------------------------------------------ Button

type BtnVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'glass';
export function Button({ variant = 'primary', icon, iconRight, loading, block, size = 'md', children, className = '', ...rest }: {
  variant?: BtnVariant; icon?: IconName; iconRight?: IconName; loading?: boolean; block?: boolean; size?: 'sm' | 'md' | 'lg';
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type="button" className={`btn btn-${variant} btn-${size} ${block ? 'btn-block' : ''} ${className}`} disabled={loading || rest.disabled} aria-busy={loading || undefined} {...rest}>
      {loading ? <span className="spinner" aria-hidden="true" /> : icon ? <Icon name={icon} size={size === 'sm' ? 16 : 19} /> : null}
      {children && <span>{children}</span>}
      {iconRight && !loading && <Icon name={iconRight} size={size === 'sm' ? 16 : 18} />}
    </button>
  );
}

export function IconButton({ icon, label, active, className = '', size = 22, ...rest }: { icon: IconName; label: string; active?: boolean; size?: number } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type="button" className={`icon-btn ${active ? 'is-active' : ''} ${className}`} aria-label={label} title={label} aria-pressed={active === undefined ? undefined : active} {...rest}>
      <Icon name={icon} size={size} />
    </button>
  );
}

export function DemoBadge({ title }: { title?: string }) {
  return <span className="demo-badge" title={title}>DEMO</span>;
}

export function Spinner({ label }: { label?: string }) {
  return <span className="spinner-wrap" role="status"><span className="spinner" aria-hidden="true" />{label && <span>{label}</span>}</span>;
}

// ------------------------------------------------------------------ Sheet (bottom sheet on mobile, dialog on desktop)

const focusableSel = 'button:not([disabled]), [href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])';

export function Sheet({ open, onClose, title, children, footer, size = 'md', labelledBy }: {
  open: boolean; onClose: () => void; title?: ReactNode; children: ReactNode; footer?: ReactNode; size?: 'sm' | 'md' | 'lg'; labelledBy?: string;
}) {
  const t = useT();
  const ref = useRef<HTMLDivElement>(null);
  const id = useId();
  const [visible, setVisible] = useState(open);
  useEffect(() => { if (open) setVisible(true); }, [open]);
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose(); }
      if (e.key === 'Tab' && ref.current) {
        const els = Array.from(ref.current.querySelectorAll<HTMLElement>(focusableSel));
        if (!els.length) return;
        const first = els[0], last = els[els.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', onKey);
    document.body.classList.add('no-scroll');
    const f = setTimeout(() => {
      const target = ref.current?.querySelector<HTMLElement>('[data-autofocus]') ?? ref.current?.querySelector<HTMLElement>('.sheet-body ' + focusableSel) ?? ref.current;
      target?.focus({ preventScroll: true });
    }, 30);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.classList.remove('no-scroll');
      clearTimeout(f);
      // Return focus to where it was — unless the action that closed the sheet already moved it
      // (e.g. the editor placed the caret in a newly inserted block).
      const a = document.activeElement;
      if (!a || a === document.body || ref.current?.contains(a)) prev?.focus?.({ preventScroll: true });
    };
  }, [open, onClose]);
  if (!visible) return null;
  return createPortal(
    <div className={`sheet-root ${open ? 'is-open' : 'is-closing'}`} onAnimationEnd={() => { if (!open) setVisible(false); }}>
      <div className="sheet-backdrop" onClick={onClose} />
      <div ref={ref} className={`sheet sheet-${size}`} role="dialog" aria-modal="true" aria-labelledby={labelledBy ?? (title ? id : undefined)} tabIndex={-1}>
        <div className="sheet-grabber" aria-hidden="true" />
        {title && (
          <div className="sheet-head">
            <h2 id={id}>{title}</h2>
            <IconButton icon="x" label={t('common.close')} onClick={onClose} />
          </div>
        )}
        <div className="sheet-body">{children}</div>
        {footer && <div className="sheet-foot">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

// ------------------------------------------------------------------ Dialog host (confirm / prompt)

export function DialogHost() {
  const { dialog, closeDialog } = useUi();
  const t = useT();
  const [value, setValue] = useState('');
  useEffect(() => { setValue(dialog?.value ?? ''); }, [dialog]);
  if (!dialog) return null;
  const submit = () => closeDialog(dialog.kind === 'prompt' ? value.trim() || null : true);
  return (
    <Sheet open onClose={() => closeDialog(dialog.kind === 'prompt' ? null : false)} title={dialog.title} size="sm"
      footer={<>
        <Button variant="secondary" onClick={() => closeDialog(dialog.kind === 'prompt' ? null : false)}>{t('common.cancel')}</Button>
        <Button variant={dialog.danger ? 'danger' : 'primary'} onClick={submit} disabled={dialog.kind === 'prompt' && !value.trim()} data-testid="dialog-confirm">
          {dialog.confirmLabel ?? t('common.confirm')}
        </Button>
      </>}>
      {dialog.message && <p className="muted">{dialog.message}</p>}
      {dialog.kind === 'prompt' && (
        <form onSubmit={(e) => { e.preventDefault(); submit(); }}>
          <input className="input" data-autofocus value={value} placeholder={dialog.placeholder} onChange={(e) => setValue(e.target.value)} aria-label={dialog.title} />
        </form>
      )}
    </Sheet>
  );
}

export function ToastHost() {
  const { toasts, dismiss } = useUi();
  return createPortal(
    <div className="toasts" aria-live="polite" aria-atomic="false">
      {toasts.map((x) => (
        <div key={x.id} className={`toast toast-${x.kind}`} role={x.kind === 'error' ? 'alert' : 'status'}>
          <Icon name={x.kind === 'success' ? 'check' : x.kind === 'error' ? 'alert' : 'info'} size={18} />
          <span>{x.text}</span>
          {x.action && <button type="button" className="toast-action" onClick={() => { x.action!.run(); dismiss(x.id); }}>{x.action.label}</button>}
        </div>
      ))}
    </div>,
    document.body,
  );
}

// ------------------------------------------------------------------ Layout pieces

export function PageHeader({ title, subtitle, onBack, actions, sticky = true }: { title: ReactNode; subtitle?: ReactNode; onBack?: () => void; actions?: ReactNode; sticky?: boolean }) {
  const t = useT();
  return (
    <header className={`page-header ${sticky ? 'is-sticky' : ''}`}>
      {onBack && <IconButton icon="chevronLeft" label={t('common.back')} onClick={onBack} className="page-back" />}
      <div className="page-header-text">
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {actions && <div className="page-header-actions">{actions}</div>}
    </header>
  );
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return <div className="section-title"><h2>{children}</h2>{action}</div>;
}

export function EmptyState({ icon = 'bookOpen', title, text, action }: { icon?: IconName; title: string; text?: string; action?: ReactNode }) {
  return (
    <div className="empty">
      <div className="empty-art" aria-hidden="true">
        <svg viewBox="0 0 120 96" width="120" height="96">
          <defs><linearGradient id="eg" x1="0" x2="1" y1="0" y2="1"><stop offset="0" stopColor="var(--violet)" /><stop offset="1" stopColor="var(--indigo)" /></linearGradient></defs>
          <ellipse cx="60" cy="84" rx="42" ry="6" fill="var(--glow)" />
          <path d="M18 24c14-6 28-6 42 2v52c-14-8-28-8-42-2z" fill="url(#eg)" opacity=".9" />
          <path d="M102 24c-14-6-28-6-42 2v52c14-8 28-8 42-2z" fill="var(--lavender)" opacity=".85" />
          <circle cx="92" cy="14" r="3" fill="var(--violet)" /><circle cx="24" cy="10" r="2" fill="var(--lavender)" />
        </svg>
        <span className="empty-icon"><Icon name={icon} size={22} /></span>
      </div>
      <h3>{title}</h3>
      {text && <p>{text}</p>}
      {action}
    </div>
  );
}

export function Segmented<T extends string>({ value, options, onChange, label, scroll }: { value: T; options: { value: T; label: string; icon?: IconName; count?: number }[]; onChange: (v: T) => void; label: string; scroll?: boolean }) {
  return (
    <div className={`segmented ${scroll ? 'is-scroll' : ''}`} role="tablist" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" role="tab" aria-selected={o.value === value} className={o.value === value ? 'is-active' : ''} onClick={() => onChange(o.value)}>
          {o.icon && <Icon name={o.icon} size={16} />}
          <span>{o.label}</span>
          {o.count !== undefined && <span className="seg-count">{o.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function Field({ label, hint, error, children, htmlFor, required }: { label: string; hint?: string; error?: string | null; children: ReactNode; htmlFor?: string; required?: boolean }) {
  return (
    <div className={`field ${error ? 'has-error' : ''}`}>
      <label htmlFor={htmlFor}>{label}{required && <span className="req" aria-hidden="true"> *</span>}</label>
      {children}
      {error ? <p className="field-error" role="alert">{error}</p> : hint ? <p className="field-hint">{hint}</p> : null}
    </div>
  );
}

export function Switch({ checked, onChange, label, id }: { checked: boolean; onChange: (v: boolean) => void; label: string; id?: string }) {
  return (
    <label className="switch-row" htmlFor={id}>
      <span>{label}</span>
      <input id={id} type="checkbox" role="switch" className="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}

export function ListRow({ icon, title, subtitle, onClick, right, danger, testId }: { icon?: IconName; title: string; subtitle?: string; onClick?: () => void; right?: ReactNode; danger?: boolean; testId?: string }) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag type={onClick ? 'button' : undefined} className={`list-row ${danger ? 'is-danger' : ''}`} onClick={onClick} data-testid={testId}>
      {icon && <span className="list-row-icon"><Icon name={icon} size={19} /></span>}
      <span className="list-row-text"><span>{title}</span>{subtitle && <small>{subtitle}</small>}</span>
      {right ?? (onClick ? <Icon name="chevronRight" size={18} className="list-row-chev" /> : null)}
    </Tag>
  );
}

export function ProgressBar({ value, done }: { value: number; done?: boolean }) {
  return (
    <div className={`progress ${done ? 'is-done' : ''}`} role="progressbar" aria-valuenow={value} aria-valuemin={0} aria-valuemax={100}>
      <span style={{ width: `${Math.max(2, Math.min(100, value))}%` }} />
    </div>
  );
}
