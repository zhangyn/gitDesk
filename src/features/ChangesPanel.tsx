import { useMemo, useState } from 'react';
import { hasStaged, hasWorktree, useStore } from '../store';
import type { CommitFile, StatusEntry } from '../types';

type Tone = 'add' | 'mod' | 'del' | 'rename' | 'conflict' | 'untracked' | 'none';

function toneOf(letter: string, entry: StatusEntry): Tone {
  if (entry.kind === 'untracked') return 'untracked';
  if (entry.kind === 'unmerged' || letter === 'U') return 'conflict';
  if (letter === 'A') return 'add';
  if (letter === 'D') return 'del';
  if (letter === 'R' || letter === 'C') return 'rename';
  if (letter === 'M' || letter === 'T') return 'mod';
  return 'none';
}

function Chip({ letter, tone }: { letter: string; tone: Tone }) {
  // 空格子也画一个淡点：两列宽度恒定，暂存/取消暂存时文件名不会左右跳
  if (letter === '.' || letter === ' ') return <span className="chip chip-empty">·</span>;
  return <span className={`chip chip-${tone}`}>{letter}</span>;
}

/** 一行中文说明，用于行 tooltip（"怎么区分暂存 / 未暂存"最直接的答案） */
function describeEntry(entry: StatusEntry): string {
  if (entry.kind === 'unmerged') return '冲突：需要先解决';
  if (entry.kind === 'untracked') return '未跟踪：还没有被 git 记录';
  const staged = hasStaged(entry);
  const worktree = hasWorktree(entry);
  if (staged && worktree) return '已暂存，且工作区还有未暂存的改动';
  if (staged) return '已暂存，工作区无改动';
  return '未暂存：改动还在工作区';
}

function splitPath(path: string): { dir: string; base: string } {
  const idx = path.lastIndexOf('/');
  if (idx < 0) return { dir: '', base: path };
  return { dir: path.slice(0, idx + 1), base: path.slice(idx + 1) };
}

const FILE_TONE: Record<string, Tone> = {
  A: 'add',
  D: 'del',
  M: 'mod',
  T: 'mod',
  R: 'rename',
  C: 'rename',
  U: 'conflict',
};

/** 工作区变更行 */
function ChangeRow({ entry }: { entry: StatusEntry }) {
  const target = useStore((s) => s.target);
  const showChange = useStore((s) => s.showChange);
  const openDiffModal = useStore((s) => s.openDiffModal);
  const stageEntry = useStore((s) => s.stageEntry);
  const unstageEntry = useStore((s) => s.unstageEntry);
  const discardEntry = useStore((s) => s.discardEntry);
  const busy = useStore((s) => s.busy);

  const untracked = entry.kind === 'untracked';
  const unmerged = entry.kind === 'unmerged';
  const staged = hasStaged(entry);
  const worktree = hasWorktree(entry);
  const active = target?.kind === 'file' && target.path === entry.path;
  const { dir, base } = splitPath(entry.path);
  const disabled = busy !== null;

  return (
    <div
      className={`chg-row${active ? ' is-active' : ''}${unmerged ? ' is-conflict' : ''}`}
      title={`${entry.path}\n${describeEntry(entry)}\n单击预览 · 双击放大`}
      onDoubleClick={async () => {
        await showChange(entry);
        openDiffModal();
      }}
    >
      <button className="chg-main" onClick={() => void showChange(entry)}>
        <span className="chg-chips" title="左：暂存区状态　右：工作区状态">
          <Chip
            letter={untracked ? '.' : entry.index}
            tone={toneOf(entry.index, entry)}
          />
          <Chip
            letter={untracked ? '?' : entry.worktree}
            tone={toneOf(entry.worktree, entry)}
          />
        </span>
        <span className="chg-path">
          {dir && <span className="chg-dir">{dir}</span>}
          <span className="chg-base">{base}</span>
        </span>
      </button>

      {!unmerged && (
        <span className="row-actions">
          {worktree && (
            <button
              className="icon-btn"
              title={untracked ? '暂存（git add）' : '暂存整个文件'}
              disabled={disabled}
              onClick={() => void stageEntry(entry)}
            >
              +
            </button>
          )}
          {staged && (
            <button
              className="icon-btn"
              title="取消暂存整个文件"
              disabled={disabled}
              onClick={() => void unstageEntry(entry)}
            >
              −
            </button>
          )}
          {worktree && (
            <button
              className="icon-btn danger"
              title={untracked ? '删除未跟踪文件' : '丢弃该文件的改动'}
              disabled={disabled}
              onClick={() => void discardEntry(entry)}
            >
              ✕
            </button>
          )}
        </span>
      )}
      {unmerged && <span className="chg-hint">待解决</span>}
    </div>
  );
}

/** 某个历史提交里的文件行 */
function CommitFileRow({ file }: { file: CommitFile }) {
  const target = useStore((s) => s.target);
  const showTabFile = useStore((s) => s.showTabFile);
  const openDiffModal = useStore((s) => s.openDiffModal);
  const active = target?.kind === 'commit' && target.path === file.path;
  const { dir, base } = splitPath(file.path);

  return (
    <div
      className={`chg-row${active ? ' is-active' : ''}`}
      title={`${file.path}\n单击预览 · 双击放大`}
      onDoubleClick={async () => {
        await showTabFile(file);
        openDiffModal();
      }}
    >
      <button className="chg-main" onClick={() => void showTabFile(file)}>
        <span className="chg-chips" title="该提交对这个文件做了什么">
          <Chip letter={file.status} tone={FILE_TONE[file.status] ?? 'mod'} />
          <Chip letter="." tone="none" />
        </span>
        <span className="chg-path">
          {dir && <span className="chg-dir">{dir}</span>}
          <span className="chg-base">{base}</span>
        </span>
      </button>
    </div>
  );
}

export function ChangesPanel() {
  const status = useStore((s) => s.status);
  const commitTabs = useStore((s) => s.commitTabs);
  const fileTab = useStore((s) => s.fileTab);
  const commitFiles = useStore((s) => s.commitFiles);
  const busy = useStore((s) => s.busy);
  const setFileTab = useStore((s) => s.setFileTab);
  const closeCommitTab = useStore((s) => s.closeCommitTab);
  const stageAllOp = useStore((s) => s.stageAllOp);
  const unstageAllOp = useStore((s) => s.unstageAllOp);

  const [filter, setFilter] = useState('');

  const entries = useMemo(() => {
    const all = status?.entries ?? [];
    if (!filter.trim()) return all;
    const q = filter.trim().toLowerCase();
    return all.filter((e) => e.path.toLowerCase().includes(q));
  }, [status, filter]);

  const total = status?.entries.length ?? 0;
  const activeTab = commitTabs.find((t) => t.key === fileTab) ?? null;
  const isWorktree = fileTab === 'worktree';
  const hasStagedAny = (status?.entries ?? []).some((e) => e.kind !== 'untracked' && e.index !== '.');

  const commitFileList = useMemo(() => {
    if (!filter.trim()) return commitFiles;
    const q = filter.trim().toLowerCase();
    return commitFiles.filter((f) => f.path.toLowerCase().includes(q));
  }, [commitFiles, filter]);

  return (
    <div className="files-panel">
      <div className="pane-head files-head">
        <div className="file-tabs">
          <button
            className={`file-tab${isWorktree ? ' is-on' : ''}`}
            onClick={() => void setFileTab('worktree')}
            title="当前工作区的改动"
          >
            工作区
            <span className="tab-count">{total}</span>
          </button>
          {commitTabs.map((t) => (
            <span
              key={t.key}
              className={`file-tab commit-tab${t.kind === 'stash' ? ' stash-tab' : ''}${
                t.kind === 'compare' ? ' compare-tab' : ''
              }${
                fileTab === t.key ? ' is-on' : ''
              }`}
            >
              <button
                className="file-tab-label"
                onClick={() => void setFileTab(t.key)}
                title={t.subject}
              >
                {t.label}
              </button>
              <button
                className="file-tab-x"
                title="关闭页签"
                onClick={() => void closeCommitTab(t.key)}
              >
                ✕
              </button>
            </span>
          ))}
        </div>

        <span className="spacer" />

        {isWorktree ? (
          <>
            <span className="chips-legend" title="每行两个格子：左=暂存区状态，右=工作区状态">
              左 暂存区 · 右 工作区
            </span>
            <button
              className="link"
              disabled={busy !== null || total === 0}
              onClick={() => void stageAllOp()}
              title="git add -A"
            >
              全部暂存
            </button>
            <button
              className="link"
              disabled={busy !== null || !hasStagedAny}
              onClick={() => void unstageAllOp()}
              title="git reset HEAD"
            >
              全部取消
            </button>
          </>
        ) : (
          <span className="hint">
            {activeTab ? `${commitFiles.length} 个文件` : ''}
          </span>
        )}
      </div>

      {total + commitFiles.length > 8 && (
        <div className="changes-filter">
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="过滤文件…"
            spellCheck={false}
          />
        </div>
      )}

      <div className="files-list">
        {isWorktree ? (
          <>
            {entries.length === 0 && total === 0 && (
              <div className="empty-hint small">工作区干净</div>
            )}
            {entries.length === 0 && total > 0 && (
              <div className="empty-hint small">没有匹配的文件</div>
            )}
            {entries.map((e) => (
              <ChangeRow key={`${e.path}-${e.kind}`} entry={e} />
            ))}
          </>
        ) : (
          <>
            {commitFileList.length === 0 && (
              <div className="empty-hint small">这个提交没有文件改动</div>
            )}
            {commitFileList.map((f) => (
              <CommitFileRow key={f.path} file={f} />
            ))}
          </>
        )}
      </div>
    </div>
  );
}
