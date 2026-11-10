import { useMemo, useState } from 'react';
import { hasStaged, hasWorktree, useStore } from '../store';
import type { Side } from '../types';
import { DiffView, type DiffMode } from './DiffView';
import { DiffActions } from './DiffActions';
import { ConflictEditor } from './ConflictEditor';
import { IconSplit, IconUnified } from '../ui/icons';

const MODE_KEY = 'gitdesk.diffMode';
const DATE_FMT = new Intl.DateTimeFormat('zh-CN', {
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});

function useDiffMode(): [DiffMode, (m: DiffMode) => void] {
  const [mode, setMode] = useState<DiffMode>(() =>
    localStorage.getItem(MODE_KEY) === 'unified' ? 'unified' : 'split',
  );
  const update = (m: DiffMode) => {
    localStorage.setItem(MODE_KEY, m);
    setMode(m);
  };
  return [mode, update];
}

function sidesLabel(kind: 'commit' | 'file', side: Side, hasParent: boolean): string {
  if (kind === 'commit') return hasParent ? '父提交 ↔ 本次提交' : '空 ↔ 本次提交';
  return side === 'staged' ? 'HEAD ↔ 暂存区' : '暂存区 ↔ 工作区';
}

function ModeToggle({ mode, onChange }: { mode: DiffMode; onChange: (m: DiffMode) => void }) {
  return (
    <div className="mode-toggle">
      <button
        className={`icon-btn${mode === 'split' ? ' is-on' : ''}`}
        title="分栏对比"
        onClick={() => onChange('split')}
      >
        <IconSplit size={13} />
      </button>
      <button
        className={`icon-btn${mode === 'unified' ? ' is-on' : ''}`}
        title="统一视图"
        onClick={() => onChange('unified')}
      >
        <IconUnified size={13} />
      </button>
    </div>
  );
}

export function DetailPanel() {
  const commits = useStore((s) => s.commits);
  const selectedSha = useStore((s) => s.selectedSha);
  const target = useStore((s) => s.target);
  const patches = useStore((s) => s.patches);
  const worktreePatches = useStore((s) => s.worktreePatches);
  const stagedPatches = useStore((s) => s.stagedPatches);
  const side = useStore((s) => s.side);
  const setSide = useStore((s) => s.setSide);
  const diffLoading = useStore((s) => s.diffLoading);
  const conflictSides = useStore((s) => s.conflictSides);
  const status = useStore((s) => s.status);
  const [mode, setMode] = useDiffMode();

  const commit = useMemo(
    () => commits.find((c) => c.sha === selectedSha) ?? null,
    [commits, selectedSha],
  );

  const commitTabs = useStore((s) => s.commitTabs);
  const fileTab = useStore((s) => s.fileTab);
  const activeTab = commitTabs.find((t) => t.key === fileTab) ?? null;
  const isStashView = target?.kind === 'stash';
  const isCompareView = target?.kind === 'compare';
  const compareInfo = useStore((s) => s.compareInfo);
  const isCommitView = target === null || target.kind === 'commit';
  const isConflict = conflictSides !== null;
  const entry = status?.entries.find((e) => e.path === target?.path);

  return (
    <div className="detail">
      {isCompareView && target && (
        <div className="pane-head commit-head">
          <span className="commit-subject">
            {activeTab?.label ?? `${target.a?.slice(0, 7)} ↔ ${target.b?.slice(0, 7)}`}
          </span>
          <span className="meta-dot">·</span>
          <span className="meta-item">{activeTab?.subject}</span>
          {compareInfo && (
            <span className="sides-label">
              · 中间 {compareInfo.commitCount} 个提交 · +{compareInfo.insertions} −
              {compareInfo.deletions}
            </span>
          )}
          <span className="spacer" />
          <ModeToggle mode={mode} onChange={setMode} />
        </div>
      )}

      {isStashView && target && (
        <div className="pane-head commit-head">
          <span className="commit-subject" title={activeTab?.subject}>
            {activeTab?.label ?? 'stash'}
          </span>
          <span className="meta-dot">·</span>
          <span className="meta-item">{activeTab?.subject}</span>
          <span className="sides-label">· stash 基线 ↔ stash 内容</span>
          <span className="spacer" />
          <ModeToggle mode={mode} onChange={setMode} />
        </div>
      )}

      {isCommitView && commit && (
        <>
          <div className="pane-head commit-head">
            <span className="commit-subject" title={commit.subject}>
              {commit.subject}
            </span>
            <span className="meta-dot">·</span>
            <span className="mono sha">{commit.sha.slice(0, 8)}</span>
            <span className="meta-item">{commit.authorName}</span>
            <span className="meta-item mono">
              {DATE_FMT.format(new Date(commit.authorDate * 1000))}
            </span>
            <span className="sides-label">· {sidesLabel('commit', side, commit.parents.length > 0)}</span>
            <span className="spacer" />
            <ModeToggle mode={mode} onChange={setMode} />
          </div>

        </>
      )}

      {!isCommitView && !isStashView && !isCompareView && target && (
        <div className="pane-head file-head">
          <span className="mono path" title={target.path}>
            {target.path}
          </span>
          {!isConflict && (
            <>
              <span className="sides-label">· {sidesLabel('file', side, true)}</span>
              <div className="seg">
                <button
                  className={`seg-btn${side === 'worktree' ? ' is-on' : ''}`}
                  disabled={worktreePatches.length === 0}
                  onClick={() => setSide('worktree')}
                >
                  未暂存
                  <span className="seg-count">{worktreePatches.length > 0 ? '●' : '0'}</span>
                </button>
                <button
                  className={`seg-btn${side === 'staged' ? ' is-on' : ''}`}
                  disabled={stagedPatches.length === 0}
                  onClick={() => setSide('staged')}
                >
                  已暂存
                  <span className="seg-count">{stagedPatches.length > 0 ? '●' : '0'}</span>
                </button>
              </div>
            </>
          )}
          <span className="spacer" />
          {!isConflict && <ModeToggle mode={mode} onChange={setMode} />}
        </div>
      )}

      {!isConflict && !isCommitView && <DiffActions side={side} />}

      {isConflict ? (
        <ConflictEditor />
      ) : (
        <DiffView
          patches={patches}
          loading={diffLoading}
          hasTarget={target !== null}
          interactive={!isCommitView}
          side={side}
          mode={mode}
          emptyText={
            !isCommitView && side === 'staged'
              ? '这个文件没有已暂存的内容'
              : !isCommitView && entry && !hasWorktree(entry) && !hasStaged(entry)
                ? '这个文件已经没有改动了'
                : undefined
          }
        />
      )}
    </div>
  );
}
