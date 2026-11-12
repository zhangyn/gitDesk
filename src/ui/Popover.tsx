import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/**
 * 下拉面板：Portal 渲染到 body + fixed 定位。
 *
 * 之所以不用原来的「absolute 挂在触发器正下方」：工具栏有 overflow: hidden
 * （窄窗口降级用的），从工具栏里往下伸的面板会被整段裁掉，表现为
 * "点了下拉什么都看不见"。Portal 到 body 之后不受任何祖先的裁剪影响。
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
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const wrapRef = useRef<HTMLSpanElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  /** 打开时按触发器的实时屏幕位置计算面板坐标 */
  const place = (): void => {
    const r = wrapRef.current?.getBoundingClientRect();
    if (!r) return;
    const maxLeft = Math.max(8, window.innerWidth - width - 8);
    const left = align === 'right' ? Math.max(8, r.right - width) : Math.min(r.left, maxLeft);
    setPos({ top: r.bottom + 5, left: Math.min(left, maxLeft) });
  };

  const toggle = (): void => {
    if (!open) place();
    setOpen((v) => !v);
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    // 触发器被滚动/缩放挪走后，fixed 面板会悬空——直接关掉。
    // 面板内部的滚动（分支选择器的长列表）不算，不要误关。
    const onScroll = (e: Event) => {
      const t = e.target as Node | null;
      if (t && panelRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onResize = () => setOpen(false);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onResize);
    };
  }, [open]);

  return (
    <span className="popover-wrap" ref={wrapRef}>
      <span
        className="popover-trigger"
        onClick={(e) => {
          e.stopPropagation();
          toggle();
        }}
      >
        {trigger}
      </span>
      {open &&
        pos &&
        createPortal(
          <>
            <div className="popover-backdrop" onMouseDown={() => setOpen(false)} />
            <div
              className="popover"
              ref={panelRef}
              style={{ position: 'fixed', top: pos.top, left: pos.left, width }}
              onMouseDown={(e) => e.stopPropagation()}
            >
              {children}
            </div>
          </>,
          document.body,
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
