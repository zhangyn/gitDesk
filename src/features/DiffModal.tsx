import { useEffect } from 'react';
import { useStore } from '../store';
import { DiffView, type DiffMode } from './DiffView';
import { DiffActions } from './DiffActions';
import { IconSplit, IconUnified } from '../ui/icons';

/**
 * 双击文件后的大窗 diff。
 * 复用同一份 patches / selection，所以在这里也能直接暂存所选。
 */
export function DiffModal() {
  const open = useStore((s) => s.diffModal);
  const close = useStore((s) => s.closeDiffModal);
  const target = useStore((s) => s.target);
  const patches = useStore((s) => s.patches);
  const side = useStore((s) => s.side);
  const loading = useStore((s) => s.diffLoading);
  const conflictSides = useStore((s) => s.conflictSides);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, close]);

  if (!open || !target) return null;

  const mode: DiffMode = localStorage.getItem('gitdesk.diffMode') === 'unified' ? 'unified' : 'split';
  const interactive = !conflictSides && target.kind === 'file';
  const title =
    target.kind === 'commit'
      ? `提交 ${target.sha?.slice(0, 8)} · ${target.path}`
      : target.kind === 'stash'
        ? `${target.ref} · ${target.path}`
        : target.path;

  return (
    <div className="modal-mask diff-mask" onMouseDown={close}>
      <div className="diff-modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="pane-head diff-modal-head">
          <span className="mono path" title={title}>
            {title}
          </span>
          <span className="sides-label">
            ·{' '}
            {target.kind === 'commit'
              ? '父提交 ↔ 本次提交'
              : target.kind === 'stash'
                ? 'stash 基线 ↔ stash 内容'
                : side === 'staged'
                  ? 'HEAD ↔ 暂存区'
                  : '暂存区 ↔ 工作区'}
          </span>
          <span className="spacer" />
          <span className="hint">Esc 关闭</span>
          <button className="icon-btn" title="关闭" onClick={close}>
            ✕
          </button>
        </div>

        {interactive && <DiffActions side={side} />}

        <DiffView
          patches={patches}
          loading={loading}
          hasTarget
          interactive={interactive}
          side={side}
          mode={mode}
        />

        <div className="diff-modal-foot">
          <span className="hint mono">
            {mode === 'split' ? '分栏视图' : '统一视图'} · 点行或块标题可选中改动
          </span>
          <span className="spacer" />
          <div className="mode-toggle" title="视图模式（在中间面板切换会同步）">
            <span className={`icon-btn${mode === 'split' ? ' is-on' : ''}`}>
              <IconSplit size={12} />
            </span>
            <span className={`icon-btn${mode === 'unified' ? ' is-on' : ''}`}>
              <IconUnified size={12} />
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
