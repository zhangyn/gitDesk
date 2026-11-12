import { useEffect, useRef, useState, type ReactNode } from 'react';

/**
 * 极简下拉面板。Tauri 的 WebView 里没有 portal 需求，直接绝对定位 + 遮罩关闭。
 */
export function Popover({
  trigger,
  children,
  align = 'left',
  width = 220,
}: {
  trigger: ReactNode;
  children: ReactNode;
  align?: 'left' | 'right';
  width?: number;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open]);

  return (
    <span className="popover-wrap" ref={wrapRef}>
      <span
        className="popover-trigger"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
      >
        {trigger}
      </span>
      {open && (
        <>
          <div className="popover-backdrop" onMouseDown={() => setOpen(false)} />
          <div
            className={`popover ${align}`}
            style={{ width }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            {children}
          </div>
        </>
      )}
    </span>
  );
}

export function MenuItem({
  children,
  onClick,
  disabled,
  danger,
  hint,
  title,
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  danger?: boolean;
  hint?: string;
  title?: string;
}) {
  return (
    <button
      className={`menu-item${danger ? ' danger' : ''}`}
      disabled={disabled}
      onClick={onClick}
      title={title}
    >
      <span className="menu-label">{children}</span>
      {hint && <span className="menu-hint">{hint}</span>}
    </button>
  );
}

export function MenuSep() {
  return <div className="menu-sep" />;
}
