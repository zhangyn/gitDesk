import { useEffect, useLayoutEffect, useRef, useState, Fragment } from 'react';
import { createPortal } from 'react-dom';

export interface CtxItem {
  label: string;
  onClick?: () => void;
  danger?: boolean;
  disabled?: boolean;
  title?: string;
  /** 在这一项前面画分隔线 */
  sepBefore?: boolean;
}

/**
 * 右键上下文菜单：Portal 到 body + fixed 定位（不受任何 overflow 裁剪），
 * 点面板外部 / Esc / 滚动 关闭；点击菜单项执行动作后自动关闭。
 * 与 SmartGit 一致：在提交图行上右键直达常用操作，不用先选中再找按钮。
 */
export function ContextMenu({
  x,
  y,
  items,
  onClose,
}: {
  x: number;
  y: number;
  items: CtxItem[];
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  // 先按估算尺寸钳制，避免首帧闪现在视口外；挂载后按实际尺寸精修
  const [pos, setPos] = useState({
    x: Math.max(8, Math.min(x, window.innerWidth - 248)),
    y: Math.max(8, Math.min(y, window.innerHeight - 320)),
  });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({
      x: Math.max(8, Math.min(pos.x, window.innerWidth - r.width - 8)),
      y: Math.max(8, Math.min(pos.y, window.innerHeight - r.height - 8)),
    });
    // 仅在位置变化时精修一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [x, y]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node | null;
      if (t && ref.current?.contains(t)) return; // 面板内的 mousedown 让 click 正常发生
      onClose();
    };
    const onScroll = (e: Event) => {
      const t = e.target as Node | null;
      if (t && ref.current?.contains(t)) return;
      onClose();
    };
    const onResize = () => onClose();
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('mousedown', onDown, true);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('mousedown', onDown, true);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onResize);
    };
  }, [onClose]);

  return createPortal(
    <div
      className="popover ctx-menu"
      ref={ref}
      style={{ position: 'fixed', left: pos.x, top: pos.y, width: 236 }}
    >
      {items.map((it, i) => (
        <Fragment key={i}>
          {it.sepBefore && <div className="menu-sep" />}
          <button
            className={`menu-item${it.danger ? ' danger' : ''}`}
            disabled={it.disabled}
            title={it.title}
            onClick={() => {
              it.onClick?.();
              onClose();
            }}
          >
            <span className="menu-label">{it.label}</span>
          </button>
        </Fragment>
      ))}
    </div>,
    document.body,
  );
}
