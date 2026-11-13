import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../store';
import { shortSha } from './graph/shortSha';

interface Hit {
  kind: 'branch' | 'commit';
  /** 显示主标题 */
  title: string;
  /** 次要信息 */
  sub: string;
  /** 执行动作 */
  run: () => void;
}

/**
 * Ctrl+P 快速切换（模仿编辑器的命令面板）：
 * 输入即匹配本地分支 + 提交历史（说明/SHA 前缀），回车执行第一项。
 * 键盘党切分支 / 跳提交不碰鼠标。
 */
export function QuickSwitch() {
  const open = useStore((s) => s.quickSwitch);
  const setOpen = useStore((s) => s.setQuickSwitch);
  const refs = useStore((s) => s.refs);
  const commits = useStore((s) => s.commits);
  const switchBranchOp = useStore((s) => s.switchBranchOp);
  const openCommit = useStore((s) => s.openCommit);
  const busy = useStore((s) => s.busy);

  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  // 关闭时清状态
  useEffect(() => {
    if (open) {
      setQ('');
      setActive(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  const query = q.trim().toLowerCase();

  const hits = useMemo<Hit[]>(() => {
    if (!open) return [];
    const out: Hit[] = [];
    // 当前分支排除（已经在上面了）
    const head = useStore.getState().status?.branch.head;
    for (const r of refs) {
      if (r.kind !== 'branch' || r.name === head) continue;
      if (!query || r.name.toLowerCase().includes(query)) {
        out.push({
          kind: 'branch',
          title: r.name,
          sub: r.upstream ? `上游 ${r.upstream}` : '无上游',
          run: () => void switchBranchOp(r.name),
        });
      }
      if (out.length >= 8) break;
    }
    for (const c of commits) {
      if (!query) {
        if (out.length < 8) {
          out.push({
            kind: 'commit',
            title: c.subject,
            sub: `${shortSha(c.sha)} · ${c.authorName}`,
            run: () => void openCommit(c.sha),
          });
        }
        continue;
      }
      if (c.subject.toLowerCase().includes(query) || c.sha.startsWith(query)) {
        out.push({
          kind: 'commit',
          title: c.subject,
          sub: `${shortSha(c.sha)} · ${c.authorName}`,
          run: () => void openCommit(c.sha),
        });
      }
      if (out.length >= 12) break;
    }
    return out;
  }, [open, query, refs, commits, switchBranchOp, openCommit]);

  // 选中项跟随过滤结果滚动到可视区
  useEffect(() => {
    if (!open) return;
    listRef.current?.querySelectorAll('.qs-hit')[active]?.scrollIntoView({ block: 'nearest' });
  }, [active, open]);

  useEffect(() => {
    if (active >= hits.length) setActive(0);
  }, [hits.length, active]);

  if (!open) return null;

  const close = () => setOpen(false);
  const pick = (i: number) => {
    const h = hits[i];
    if (!h || busy !== null) {
      if (busy !== null) close();
      return;
    }
    close();
    h.run();
  };

  return (
    <div className="modal-mask qs-mask" onMouseDown={close}>
      <div className="quick-switch" onMouseDown={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          className="qs-input"
          value={q}
          placeholder="切换分支 / 跳到提交…（↑↓ 选择，回车执行，Esc 关闭）"
          spellCheck={false}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setActive((v) => Math.min(hits.length - 1, v + 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setActive((v) => Math.max(0, v - 1));
            } else if (e.key === 'Enter') {
              e.preventDefault();
              pick(active);
            }
          }}
        />
        <div className="qs-list" ref={listRef}>
          {hits.length === 0 && (
            <div className="qs-empty">{query ? '没有匹配项' : '没有可切换的内容'}</div>
          )}
          {hits.map((h, i) => (
            <button
              key={`${h.kind}-${i}`}
              className={`qs-hit${i === active ? ' is-active' : ''}`}
              onMouseEnter={() => setActive(i)}
              onClick={() => pick(i)}
            >
              <span className={`qs-kind qs-${h.kind}`}>
                {h.kind === 'branch' ? '分支' : '提交'}
              </span>
              <span className="qs-title" title={h.title}>
                {h.title}
              </span>
              <span className="qs-sub">{h.sub}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
