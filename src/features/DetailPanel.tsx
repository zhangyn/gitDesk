import { useEffect, useMemo, useState } from 'react';
import { hasStaged, hasWorktree, useStore, type DiffFlags } from '../store';
import type { Side } from '../types';
import { DiffView, type DiffMode } from './DiffView';
import { DiffActions } from './DiffActions';
import { ConflictEditor } from './ConflictEditor';
import { IconSplit, IconUnified } from '../ui/icons';
import { HunkNav, useHunkNav } from '../ui/HunkNav';
import { copyText } from '../ui/clipboard';

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

/** 提交正文：默认折叠成 3 行，点一下展开 */
function CommitBody({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const lines = text.split('\n');
  const truncated = lines.length > 3;
  const shown = open || !truncated ? text : lines.slice(0, 3).join('\n');
  return (
    <div
      className={`commit-body${truncated ? ' is-toggle' : ''}`}
      onClick={() => {
        if (truncated) setOpen((v) => !v);
      }}
      title={truncated ? (open ? '收起正文' : '展开完整正文') : undefined}
    >
      <pre>{shown}</pre>
      {truncated && (
        <span className="cb-more">{open ? '收起' : `展开全部 ${lines.length} 行`}</span>
      )}
    </div>
  );
}

function WordToggle() {
  const wordDiff = useStore((s) => s.wordDiff);
  const toggle = useStore((s) => s.toggleWordDiff);
  return (
    <button
      className={`btn small word-toggle${wordDiff ? ' is-on' : ''}`}
      title={wordDiff ? '行内差异高亮：开（点击关闭）' : '行内差异高亮：关（点击开启）'}
      onClick={toggle}
    >
      行内
    </button>
  );
}

/** diff 展示选项小开关：忽略空白 / 忽略 CRLF / 自动换行 */
function FlagToggle({
  flag,
  label,
  title,
}: {
  flag: keyof DiffFlags;
  label: string;
  title: string;
}) {
  const on = useStore((s) => s.diffFlags[flag]);
  const set = useStore((s) => s.setDiffFlag);
  return (
    <button
      className={`btn small word-toggle${on ? ' is-on' : ''}`}
      title={`${title}（点击切换，改动会重新拉取当前 diff）`}
      onClick={() => void set(flag, !on)}
    >
      {label}
    </button>
  );
}

function DiffFlagToggles() {
  return (
    <>
      <FlagToggle
        flag="ignoreWhitespace"
        label="空白"
        title="忽略空白差异（git diff --ignore-all-space）：缩进/空格变化不再显示"
      />
      <FlagToggle
        flag="ignoreEol"
        label="CRLF"
        title="忽略换行符差异（--ignore-cr-at-eol）：CRLF/LF 转换不再显示"
      />
      <FlagToggle flag="wordWrap" label="换行" title="自动换行：超长行折行显示" />
    </>
  );
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
  const cherryPickOp = useStore((s) => s.cherryPickOp);
  const revertOp = useStore((s) => s.revertOp);
  const undoLastCommitOp = useStore((s) => s.undoLastCommitOp);
  const wordWrap = useStore((s) => s.diffFlags.wordWrap);

  const hunkCount = useMemo(() => patches.reduce((n, p) => n + p.hunks.length, 0), [patches]);
  // 中间面板与双击弹窗共用同一套导航；换文件/换提交就回到第 1 块
  const nav = useHunkNav(
    hunkCount,
    `${target?.kind ?? ''}:${target?.path ?? ''}:${target?.sha ?? ''}:${target?.ref ?? ''}`,
  );

  // F6 / Shift+F6：在差异块之间跳转（对齐 SmartGit 的 Next/Previous Change）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'F6') return;
      e.preventDefault();
      nav.go(e.shiftKey ? -1 : 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [nav]);

  const commit = useMemo(
    () => commits.find((c) => c.sha === selectedSha) ?? null,
    [commits, selectedSha],
  );

  const commitBody = useStore((s) => s.commitBody);
  const commitTabs = useStore((s) => s.commitTabs);
  const fileTab = useStore((s) => s.fileTab);
  const activeTab = commitTabs.find((t) => t.key === fileTab) ?? null;
  // %B 的第一行就是标题，正文从这里切出来
  const bodyRest = useMemo(() => {
    const raw = commitBody.replace(/\r\n/g, '\n').trim();
    const idx = raw.indexOf('\n');
    return idx < 0 ? '' : raw.slice(idx + 1).trim();
  }, [commitBody]);

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
            <span className="sides-label">
              · {sidesLabel('commit', side, commit.parents.length > 0)}
            </span>
            <span className="spacer" />
            <button
              className="icon-btn"
              title="复制完整 SHA"
              onClick={() => void copyText(commit.sha)}
            >
              ⧉
            </button>
            <button
              className="icon-btn"
              title="复制提交信息（标题 + 正文）"
              onClick={() => void copyText(commitBody.trim() || commit.subject)}
            >
              📋
            </button>
            <button
              className="btn small"
              title={`把 ${commit.sha.slice(0, 7)} 拣选到当前分支（git cherry-pick）`}
              onClick={() => void cherryPickOp(commit.sha)}
            >
              拣选
            </button>
            <button
              className="btn small"
              title={`生成一个反向提交（git revert）`}
              onClick={() => void revertOp(commit.sha)}
            >
              还原
            </button>
            {/* 只对当前 HEAD 的提交提供撤销：reset --soft 会改写历史位置 */}
            {commit.sha !== null && commit.sha === status?.branch.oid && (
              <button
                className="btn small danger"
                title="撤销这次提交（git reset --soft HEAD~1）：改动回到暂存区"
                onClick={() => void undoLastCommitOp(commit.sha)}
              >
                撤销提交
              </button>
            )}
            <HunkNav count={hunkCount} index={nav.index} onGo={nav.go} />
            <WordToggle />
            <DiffFlagToggles />
            <ModeToggle mode={mode} onChange={setMode} />
          </div>

          {bodyRest && <CommitBody text={bodyRest} />}
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
          {!isConflict && <HunkNav count={hunkCount} index={nav.index} onGo={nav.go} />}
          {!isConflict && <WordToggle />}
          {!isConflict && <DiffFlagToggles />}
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
          interactive={!isCommitView && !isStashView && !isCompareView}
          side={side}
          mode={mode}
          wrap={wordWrap}
          containerRef={nav.containerRef}
          emptyText={
            !isCommitView && !isStashView && !isCompareView && side === 'staged'
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
