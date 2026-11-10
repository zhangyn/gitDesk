import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../store';

/**
 * 任意两个版本的对比对话框。
 * 左右都可以是分支名 / 标签 / 提交 sha / HEAD~3 —— `git diff A B` 与两者的 DAG 关系无关，
 * 所以「分支↔分支」和「提交 A↔提交 B（中间隔很多次提交）」走的是同一套逻辑。
 */
export function CompareDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const refs = useStore((s) => s.refs);
  const status = useStore((s) => s.status);
  const openCompare = useStore((s) => s.openCompare);
  const busy = useStore((s) => s.busy);

  const head = status?.branch.head ?? null;
  const upstream = status?.branch.upstream ?? null;

  const [a, setA] = useState('');
  const [b, setB] = useState('');

  useEffect(() => {
    if (!open) return;
    setA(head ?? 'HEAD');
    setB(upstream ?? '');
  }, [open, head, upstream]);

  const suggestions = useMemo(() => {
    const out: string[] = [];
    if (head) out.push(head);
    if (upstream) out.push(upstream);
    for (const r of refs) {
      if (r.kind === 'tag') continue;
      out.push(r.name);
    }
    for (const r of refs) {
      if (r.kind === 'tag') out.push(r.name);
    }
    return [...new Set(out)];
  }, [refs, head, upstream]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, onClose]);

  if (!open) return null;

  const canRun = a.trim().length > 0 && b.trim().length > 0 && busy === null;

  const run = async (left: string, right: string) => {
    if (!left.trim() || !right.trim()) return;
    await openCompare(left.trim(), right.trim());
    onClose();
  };

  return (
    <div className="modal-mask" onMouseDown={onClose}>
      <div className="modal compare-modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-title">对比两个版本</div>
        <div className="modal-body">
          两边都可以填分支名、标签、提交 sha，或 <code className="mono">HEAD~3</code> 这类写法。
          结果会显示「右侧相对左侧」的净差异。
        </div>

        <datalist id="gd-compare-refs">
          {suggestions.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>

        <div className="cmp-row">
          <label className="cmp-label">左侧（基准）</label>
          <input
            className="modal-input mono"
            autoFocus
            list="gd-compare-refs"
            value={a}
            onChange={(e) => setA(e.target.value)}
            placeholder="main"
            spellCheck={false}
          />
        </div>
        <div className="cmp-row">
          <label className="cmp-label">右侧（目标）</label>
          <input
            className="modal-input mono"
            list="gd-compare-refs"
            value={b}
            onChange={(e) => setB(e.target.value)}
            placeholder="feature/xxx 或 1a2b3c4"
            spellCheck={false}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void run(a, b);
            }}
          />
        </div>

        <div className="cmp-quick">
          {head && upstream && (
            <button className="btn small" onClick={() => void run(upstream, head)}>
              当前分支 ↔ 上游
            </button>
          )}
          {head && <button className="btn small" onClick={() => setA('HEAD~10')}>
            左侧填 HEAD~10
          </button>}
          {head && <button className="btn small" onClick={() => setA(head)}>
            左侧填当前分支
          </button>}
        </div>

        <div className="modal-actions">
          <button className="btn" onClick={onClose}>
            取消
          </button>
          <button className="btn primary" disabled={!canRun} onClick={() => void run(a, b)}>
            对比
          </button>
        </div>
      </div>
    </div>
  );
}
