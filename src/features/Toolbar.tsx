import { useMemo, useRef, useState, type ComponentType } from 'react';
import { countEntries, useStore } from '../store';
import { MenuItem, MenuSep, Popover } from '../ui/Popover';
import { promptBox } from '../ui/dialog';
import type { RefEntry } from '../types';
import { THEME_LABEL, nextTheme } from '../ui/theme';
import { CompareDialog } from './CompareDialog';
import {
  IconBranch,
  IconCompare,
  IconChevron,
  IconCommit,
  IconFolder,
  IconLog,
  IconMerge,
  IconPull,
  IconPush,
  IconRebase,
  IconRefresh,
  IconStage,
  IconStash,
  IconTag,
  IconUnstage,
} from '../ui/icons';

function TB({
  icon: Icon,
  label,
  onClick,
  disabled,
  active,
  caret,
  primary,
  title,
}: {
  icon?: ComponentType<{ size?: number; className?: string }>;
  label: string;
  onClick?: () => void;
  disabled?: boolean;
  active?: boolean;
  caret?: boolean;
  primary?: boolean;
  title?: string;
}) {
  return (
    <button
      className={`tb-btn${primary ? ' primary' : ''}${active ? ' is-on' : ''}`}
      disabled={disabled}
      onClick={onClick}
      title={title}
    >
      {Icon && <Icon size={14} />}
      <span>{label}</span>
      {caret && <IconChevron size={11} className="tb-caret" />}
    </button>
  );
}

function BranchPicker({
  exclude,
  onPick,
}: {
  exclude?: string | null;
  onPick: (name: string) => void;
}) {
  const refs = useStore((s) => s.refs);
  const branches = useMemo(
    () => refs.filter((r) => r.kind === 'branch' && r.name !== exclude),
    [refs, exclude],
  );
  const [q, setQ] = useState('');
  const filtered = branches.filter((b) => b.name.toLowerCase().includes(q.toLowerCase()));
  const inputRef = useRef<HTMLInputElement | null>(null);

  return (
    <>
      <div className="menu-search">
        <input
          ref={inputRef}
          autoFocus
          value={q}
          placeholder="搜索分支…"
          onChange={(e) => setQ(e.target.value)}
          spellCheck={false}
        />
      </div>
      <div className="menu-scroll">
        {filtered.length === 0 && <div className="menu-empty">没有匹配的分支</div>}
        {filtered.map((b: RefEntry) => (
          <MenuItem key={b.name} onClick={() => onPick(b.name)}>
            <IconBranch size={12} /> {b.name}
          </MenuItem>
        ))}
      </div>
    </>
  );
}

export function Toolbar() {
  const repo = useStore((s) => s.repo);
  const status = useStore((s) => s.status);
  const busy = useStore((s) => s.busy);
  const remotes = useStore((s) => s.remotes);
  const remote = useStore((s) => s.remote);
  const stashes = useStore((s) => s.stashes);
  const bottomPanel = useStore((s) => s.bottomPanel);

  const recent = useStore((s) => s.recent);
  const openPath = useStore((s) => s.openPath);
  const pickRepo = useStore((s) => s.pickRepo);
  const setRemote = useStore((s) => s.setRemote);
  const refresh = useStore((s) => s.refresh);
  const fetchOp = useStore((s) => s.fetchOp);
  const pullOp = useStore((s) => s.pullOp);
  const pushOp = useStore((s) => s.pushOp);
  const mergeBranchOp = useStore((s) => s.mergeBranchOp);
  const rebaseOntoOp = useStore((s) => s.rebaseOntoOp);
  const stashSaveOp = useStore((s) => s.stashSaveOp);
  const stashApplyOp = useStore((s) => s.stashApplyOp);
  const stageAllOp = useStore((s) => s.stageAllOp);
  const unstageAllOp = useStore((s) => s.unstageAllOp);
  const setBottomPanel = useStore((s) => s.setBottomPanel);
  const createTagOp = useStore((s) => s.createTagOp);
  const logScope = useStore((s) => s.logScope);
  const setLogScope = useStore((s) => s.setLogScope);
  const theme = useStore((s) => s.theme);
  const setTheme = useStore((s) => s.setTheme);
  const [compareOpen, setCompareOpen] = useState(false);

  const counts = countEntries(status);
  const branch = status?.branch.head ?? null;
  const ahead = status?.branch.ahead ?? 0;
  const behind = status?.branch.behind ?? 0;
  const disabled = busy !== null;
  const noRepo = !repo;
  const hasRemote = remotes.length > 0;

  const newTag = async () => {
    const name = await promptBox({
      title: '新建标签',
      label: '标签名（打在当前 HEAD 上）',
      placeholder: 'v1.0.0',
      okText: '下一步',
    });
    if (!name) return;
    const message = await promptBox({
      title: `标签 ${name} 的说明`,
      label: '留空 = 轻量标签；填写 = 附注标签',
      okText: '创建',
    });
    await createTagOp(name.trim(), message ?? '');
  };

  const newStash = async () => {
    const message = await promptBox({
      title: '保存 stash',
      label: '说明（可选，包含未跟踪文件）',
      okText: '保存',
    });
    await stashSaveOp(message ?? '');
  };

  return (
    <header className="toolbar">
      <Popover
        width={300}
        trigger={
          <button className="repo-switch" title={repo?.path ?? '选择仓库'}>
            <IconFolder size={14} />
            <span className="repo-name-sm">{repo?.name ?? '选择仓库'}</span>
            <IconChevron size={11} className="tb-caret" />
          </button>
        }
      >
        <MenuItem onClick={() => void pickRepo()}>+ 打开仓库…</MenuItem>
        <MenuSep />
        <div className="menu-title">最近仓库</div>
        <div className="menu-scroll">
          {recent.length === 0 && <div className="menu-empty">还没有打开过仓库</div>}
          {recent.map((r) => (
            <div key={r.path} className="menu-item row">
              <button className="menu-label col" onClick={() => void openPath(r.path)}>
                <span className="menu-repo-name">{r.name}</span>
                <span className="menu-repo-path">{r.path}</span>
              </button>
            </div>
          ))}
        </div>
      </Popover>

      <span className="tb-sep" />

      <Popover
        width={190}
        trigger={<TB icon={IconPull} label="拉取" caret disabled={disabled || noRepo || !hasRemote} />}
      >
        <MenuItem onClick={() => void pullOp('ff-only')}>仅快进（--ff-only）</MenuItem>
        <MenuItem onClick={() => void pullOp('rebase')}>变基（--rebase）</MenuItem>
        <MenuItem onClick={() => void pullOp('merge')}>合并</MenuItem>
        <MenuSep />
        <MenuItem onClick={() => void fetchOp()}>只获取，不合并</MenuItem>
      </Popover>

      <Popover
        width={190}
        trigger={<TB icon={IconPush} label="推送" caret disabled={disabled || noRepo || !hasRemote} />}
      >
        <MenuItem onClick={() => void pushOp(false)}>推送当前分支</MenuItem>
        <MenuItem onClick={() => void pushOp(true)} danger>
          强制推送（with-lease）
        </MenuItem>
      </Popover>

      <span className="tb-sep" />

      <TB
        icon={IconCommit}
        label="提交"
        primary
        active={bottomPanel === 'commit'}
        disabled={disabled || noRepo}
        onClick={() => setBottomPanel('commit')}
        title="Ctrl+K"
      />

      <span className="tb-sep" />

      <TB
        icon={IconStage}
        label="暂存"
        disabled={disabled || counts.worktree === 0}
        onClick={() => void stageAllOp()}
        title="暂存全部改动（git add -A）"
      />
      <TB
        icon={IconUnstage}
        label="取消暂存"
        disabled={disabled || counts.staged === 0}
        onClick={() => void unstageAllOp()}
        title="取消全部暂存（git reset HEAD）"
      />

      <span className="tb-sep" />

      <Popover width={250} trigger={<TB icon={IconMerge} label="合并" caret disabled={disabled || noRepo} />}>
        <div className="menu-title">合并到 {branch ?? '当前分支'}</div>
        <BranchPicker exclude={branch} onPick={(n) => void mergeBranchOp(n)} />
      </Popover>

      <Popover width={250} trigger={<TB icon={IconRebase} label="变基" caret disabled={disabled || noRepo} />}>
        <div className="menu-title">把 {branch ?? '当前分支'} 变基到</div>
        <BranchPicker exclude={branch} onPick={(n) => void rebaseOntoOp(n)} />
      </Popover>

      <span className="tb-sep" />

      <Popover width={190} trigger={<TB icon={IconStash} label="Stash" caret disabled={disabled || noRepo} />}>
        <MenuItem onClick={() => void newStash()} disabled={counts.total === 0}>
          保存 Stash
        </MenuItem>
        <MenuItem
          onClick={() => void stashApplyOp(stashes[0].ref, true)}
          disabled={stashes.length === 0}
          hint={stashes.length > 0 ? stashes[0].ref : undefined}
        >
          Pop 最近一条
        </MenuItem>
        <MenuSep />
        <MenuItem onClick={() => void setBottomPanel('log')}>查看命令日志</MenuItem>
      </Popover>

      <TB icon={IconTag} label="标签" disabled={disabled || noRepo} onClick={() => void newTag()} />
      <TB
        icon={IconCompare}
        label="对比"
        disabled={disabled || noRepo}
        onClick={() => setCompareOpen(true)}
        title="对比两个分支/提交"
      />

      <Popover
        width={230}
        trigger={<TB icon={IconLog} label="历史" caret disabled={disabled || noRepo} />}
      >
        <div className="menu-title">提交历史范围</div>
        <MenuItem
          onClick={() => setLogScope('local')}
          hint={logScope === 'local' ? '当前' : undefined}
        >
          本地分支 + HEAD
        </MenuItem>
        <MenuItem
          onClick={() => setLogScope('all')}
          hint={logScope === 'all' ? '当前' : undefined}
        >
          全部（含远程分支）
        </MenuItem>
        <MenuSep />
        <MenuItem onClick={() => setBottomPanel('log')}>查看命令日志</MenuItem>
      </Popover>

      <span className="spacer" />

      {branch && (
        <span className="branch-pill" title={`当前分支 ${branch}`}>
          <IconBranch size={12} />
          {branch}
          {ahead > 0 && <span className="ab-ahead">&gt;{ahead}</span>}
          {behind > 0 && <span className="ab-behind">&lt;{behind}</span>}
        </span>
      )}
      {!branch && repo && <span className="branch-pill detached">detached</span>}

      {remotes.length > 1 ? (
        <select
          className="mini-select"
          value={remote}
          onChange={(e) => setRemote(e.target.value)}
          disabled={disabled}
          title="选择远程"
        >
          {remotes.map((r) => (
            <option key={r.name} value={r.name}>
              {r.name}
            </option>
          ))}
        </select>
      ) : (
        <span className="remote-name">{hasRemote ? remote : '无 remote'}</span>
      )}

      <TB
        icon={IconLog}
        label="日志"
        active={bottomPanel === 'log'}
        disabled={noRepo}
        onClick={() => setBottomPanel('log')}
      />
      <TB
        icon={IconRefresh}
        label="刷新"
        disabled={disabled || noRepo}
        onClick={() => void refresh()}
        title="F5"
      />
      <button
        className="tb-btn icon-btn2"
        onClick={() => setTheme(nextTheme(theme))}
        title={`主题：${THEME_LABEL[theme]}（点击切换，Ctrl+Shift+L）`}
      >
        {theme === 'light' ? '☀' : theme === 'dark' ? '🌙' : '◐'}
      </button>

      <CompareDialog open={compareOpen} onClose={() => setCompareOpen(false)} />
    </header>
  );
}
