import { useMemo } from 'react';
import { useStore } from '../store';
import {
  parseConflictFile,
  undecidedCount,
  type ConflictBlock,
  type Decision,
} from '../conflict/parse';

const MAX_PREVIEW = 14;

function Column({
  title,
  lines,
  tone,
}: {
  title: string;
  lines: string[];
  tone: 'ours' | 'theirs';
}) {
  const shown = lines.slice(0, MAX_PREVIEW);
  return (
    <div className={`cside ${tone}`}>
      <div className="cside-head">
        <span>{title}</span>
        <span className="cside-count">{lines.length} 行</span>
      </div>
      <pre className="cside-body">
        {shown.length === 0 ? <span className="cside-empty">（空）</span> : shown.join('\n')}
        {lines.length > MAX_PREVIEW ? `\n… 还有 ${lines.length - MAX_PREVIEW} 行` : ''}
      </pre>
    </div>
  );
}

function DecisionButtons({
  current,
  onPick,
}: {
  current: Decision | undefined;
  onPick: (d: Decision) => void;
}) {
  const opts: Array<{ key: Decision; label: string }> = [
    { key: 'ours', label: '采用我方' },
    { key: 'theirs', label: '采用对方' },
    { key: 'both', label: '两个都要' },
    { key: 'both-reverse', label: '对方在前' },
  ];
  return (
    <div className="cdecide">
      {opts.map((o) => (
        <button
          key={o.key}
          className={`btn small${current === o.key ? ' primary' : ''}`}
          onClick={() => onPick(o.key)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function BlockCard({ block, decision }: { block: ConflictBlock; decision: Decision | undefined }) {
  const setDecision = useStore((s) => s.setDecision);
  return (
    <div className={`cblock${decision ? ' is-decided' : ''}`}>
      <div className="cblock-head">
        <span className="cblock-no">冲突块 #{block.id}</span>
        {block.hasBase && <span className="badge">含共同祖先</span>}
        <span className="spacer" />
        <span className={`cblock-state ${decision ? 'ok' : 'todo'}`}>
          {decision ? `已选：${
            { ours: '我方', theirs: '对方', both: '两者', 'both-reverse': '两者（对方在前）' }[
              decision
            ]
          }` : '未处理'}
        </span>
      </div>
      <div className="cblock-cols">
        <Column title={`我方 · ${block.oursLabel}`} lines={block.ours} tone="ours" />
        <Column title={`对方 · ${block.theirsLabel}`} lines={block.theirs} tone="theirs" />
      </div>
      <DecisionButtons current={decision} onPick={(d) => setDecision(block.id, d)} />
    </div>
  );
}

export function ConflictEditor() {
  const sides = useStore((s) => s.conflictSides);
  const decisions = useStore((s) => s.decisions);
  const target = useStore((s) => s.target);
  const busy = useStore((s) => s.busy);
  const decideAll = useStore((s) => s.decideAll);
  const applyResolved = useStore((s) => s.applyResolved);
  const checkoutSideOp = useStore((s) => s.checkoutSideOp);
  const abortMergeOp = useStore((s) => s.abortMergeOp);

  const parsed = useMemo(
    () => (sides ? parseConflictFile(sides.merged) : null),
    [sides],
  );

  if (!sides || !parsed || !target) return null;

  const open = undecidedCount(parsed, decisions);
  const disabled = busy !== null;
  const path = target.path;

  return (
    <div className="conflict">
      <div className="conflict-head">
        <span className="conflict-title">冲突解决</span>
        <span className="mono path">{path}</span>
        <span className="spacer" />
        <span className={`cblock-state ${open === 0 ? 'ok' : 'todo'}`}>
          {parsed.conflicts.length} 块 / 剩 {open} 块未处理
        </span>
      </div>

      {!sides.hasMarkers && (
        <div className="conflict-warn">
          这个文件已经被解决（没有冲突标记），直接「标记为已解决」即可。
        </div>
      )}
      {parsed.warnings.length > 0 && (
        <div className="conflict-warn">
          {parsed.warnings.map((w) => (
            <div key={w}>{w}</div>
          ))}
        </div>
      )}

      <div className="conflict-toolbar">
        <button className="btn small" disabled={disabled} onClick={() => decideAll('ours')}>
          全部采用我方
        </button>
        <button className="btn small" disabled={disabled} onClick={() => decideAll('theirs')}>
          全部采用对方
        </button>
        <span className="spacer" />
        <button
          className="btn small"
          disabled={disabled}
          onClick={() => void checkoutSideOp(path, 'ours')}
          title="git checkout --ours —— 整文件采用我方并标记解决"
        >
          整文件采用我方
        </button>
        <button
          className="btn small"
          disabled={disabled}
          onClick={() => void checkoutSideOp(path, 'theirs')}
        >
          整文件采用对方
        </button>
        <button className="btn small danger" disabled={disabled} onClick={() => void abortMergeOp()}>
          中止合并
        </button>
      </div>

      <div className="conflict-body">
        {parsed.conflicts.map((c) => (
          <BlockCard key={c.id} block={c} decision={decisions[c.id]} />
        ))}
        {parsed.conflicts.length === 0 && (
          <div className="empty-hint">这个文件没有冲突标记，可以直接标记为已解决。</div>
        )}
      </div>

      <div className="conflict-foot">
        <span className="hint">
          写入后会自动执行 <code className="mono">git add -- {path}</code>
        </span>
        <span className="spacer" />
        <button
          className="btn primary"
          disabled={disabled || open > 0}
          onClick={() => void applyResolved()}
        >
          写入并标记已解决
        </button>
      </div>
    </div>
  );
}
