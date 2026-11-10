import { useMemo } from 'react';
import { hasStaged, hasWorktree, useStore } from '../store';
import { allSelectableKeys } from '../patch/build';
import type { Side } from '../types';

export function DiffActions({ side }: { side: Side }) {
  const target = useStore((s) => s.target);
  const patches = useStore((s) => s.patches);
  const selection = useStore((s) => s.selection);
  const status = useStore((s) => s.status);
  const busy = useStore((s) => s.busy);
  const toggleKeys = useStore((s) => s.toggleKeys);
  const clearSelection = useStore((s) => s.clearSelection);
  const stageSelection = useStore((s) => s.stageSelection);
  const unstageSelection = useStore((s) => s.unstageSelection);
  const discardSelection = useStore((s) => s.discardSelection);
  const stageEntry = useStore((s) => s.stageEntry);
  const unstageEntry = useStore((s) => s.unstageEntry);
  const discardEntry = useStore((s) => s.discardEntry);

  const allKeys = useMemo(() => allSelectableKeys(patches, side), [patches, side]);
  const selCount = useMemo(
    () => allKeys.reduce((n, k) => (selection.has(k) ? n + 1 : n), 0),
    [allKeys, selection],
  );

  if (!target || target.kind !== 'file') return null;
  const entry = status?.entries.find((e) => e.path === target.path);
  const disabled = busy !== null;
  const isStaged = side === 'staged';

  return (
    <div className="diff-actions">
      <span className="selinfo">
        {selCount > 0
          ? `已选 ${selCount} 行`
          : isStaged
            ? '已暂存的内容（取消暂存后回到工作区）'
            : '点行或块标题选择改动'}
      </span>

      <span className="spacer" />

      {allKeys.length > 0 && (
        <>
          <button
            className="btn small"
            disabled={disabled}
            onClick={() => toggleKeys(allKeys)}
            title="全选 / 全不选"
          >
            全选
          </button>
          <button className="btn small" disabled={disabled || selCount === 0} onClick={clearSelection}>
            清空
          </button>
        </>
      )}

      {isStaged ? (
        <button
          className="btn small primary"
          disabled={disabled || selCount === 0}
          onClick={() => void unstageSelection()}
        >
          取消暂存所选{selCount > 0 ? ` (${selCount})` : ''}
        </button>
      ) : (
        <button
          className="btn small primary"
          disabled={disabled || selCount === 0}
          onClick={() => void stageSelection()}
        >
          暂存所选{selCount > 0 ? ` (${selCount})` : ''}
        </button>
      )}

      {entry && (
        <>
          <button
            className="btn small"
            disabled={disabled}
            onClick={() => void (isStaged ? unstageEntry(entry) : stageEntry(entry))}
          >
            {isStaged ? '取消暂存整个文件' : '暂存整个文件'}
          </button>
          {!isStaged && hasWorktree(entry) && (
            <>
              <button
                className="btn small danger"
                disabled={disabled || selCount === 0}
                onClick={() => void discardSelection()}
              >
                丢弃所选
              </button>
              <button
                className="btn small danger"
                disabled={disabled}
                onClick={() => void discardEntry(entry)}
              >
                丢弃文件更改
              </button>
            </>
          )}
          {isStaged && hasStaged(entry) && hasWorktree(entry) && (
            <span className="hint-inline">该文件两侧都有改动</span>
          )}
        </>
      )}
    </div>
  );
}
