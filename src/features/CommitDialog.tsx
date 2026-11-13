import { useEffect, useState } from 'react';
import { countEntries, hasStaged, useStore } from '../store';
import { Chip, toneOf } from './ChangesPanel';

/**
 * 提交弹窗（替代原来的底部面板）：填写提交信息，并把**暂存的文件**直接列出来，
 * 提交了哪些文件一目了然。由 bottomPanel === 'commit' 驱动（工具栏提交按钮 / Ctrl+K）。
 */
export function CommitDialog() {
  const status = useStore((s) => s.status);
  const doCommit = useStore((s) => s.doCommit);
  const setBottomPanel = useStore((s) => s.setBottomPanel);
  const lastCommitMessage = useStore((s) => s.lastCommitMessage);
  const lastCommitMessages = useStore((s) => s.lastCommitMessages);
  const busy = useStore((s) => s.busy);
  const branch = status?.branch.head ?? null;
  const stagedStat = useStore((s) => s.stagedStat);

  const [message, setMessage] = useState('');
  const [amend, setAmend] = useState(false);
  const [signoff, setSignoff] = useState(false);
  const [noVerify, setNoVerify] = useState(false);
  const [working, setWorking] = useState(false);
  const [recent, setRecent] = useState<string[]>([]);

  const counts = countEntries(status);
  const stagedFiles = (status?.entries ?? []).filter(hasStaged);

  // 打开弹窗时拉一次最近提交信息，供「最近消息」下拉快速复用
  useEffect(() => {
    let alive = true;
    void lastCommitMessages().then((list) => {
      if (alive) setRecent(list);
    });
    return () => {
      alive = false;
    };
  }, [lastCommitMessages]);

  useEffect(() => {
    if (!amend) return;
    let alive = true;
    void lastCommitMessage().then((m) => {
      if (alive && m) setMessage(m);
    });
    return () => {
      alive = false;
    };
  }, [amend, lastCommitMessage]);

  const disabled = busy !== null || working;
  const canCommit = !disabled && message.trim().length > 0 && (amend || counts.staged > 0);

  const close = () => setBottomPanel('commit'); // setBottomPanel 对当前值取反 → 'none'

  const submit = async () => {
    if (!canCommit) return;
    setWorking(true);
    const ok = await doCommit({ message, amend, signoff, noVerify });
    setWorking(false);
    if (ok) {
      setMessage('');
      setAmend(false);
    }
  };

  return (
    <div className="modal-mask" onMouseDown={close}>
      <div className="modal commit-dialog" onMouseDown={(e) => e.stopPropagation()}>
        <div className="cd-head">
          <span className="modal-title">提交</span>
          <span className="bp-sub">
            {branch ? `到 ${branch}` : 'detached HEAD'}
            {stagedStat && stagedStat.files > 0
              ? ` · ${stagedStat.files} 个文件 · +${stagedStat.insertions} −${stagedStat.deletions}`
              : ''}
          </span>
          <span className="spacer" />
          <button className="icon-btn" title="关闭（Esc）" onClick={close}>
            ✕
          </button>
        </div>

        {/* 暂存的文件：这次提交到底带哪些东西，一眼看清 */}
        <div className="cd-files" title="暂存区里的文件（git diff --cached --name-status）">
          <div className="cd-files-title">暂存的文件（{stagedFiles.length}）</div>
          {stagedFiles.length === 0 && (
            <div className="cd-empty">
              {amend
                ? '修正模式：不追加新内容，只改写上一次提交。'
                : '暂存区是空的——先在左侧列表点 + 或勾选后用工具栏「暂存」。'}
            </div>
          )}
          {stagedFiles.map((e) => (
            <div key={`${e.path}-${e.kind}`} className="cd-file" title={e.path}>
              <Chip letter={e.index} tone={toneOf(e.index, e)} />
              <span className="cd-path mono" title={e.path}>
                {e.origPath ? `${e.path} ← ${e.origPath}` : e.path}
              </span>
              {e.worktree !== '.' && e.worktree !== '?' && e.kind !== 'untracked' && (
                <span className="cd-hint" title="暂存后工作区又有新改动（不在本次提交里）">
                  工作区仍有改动
                </span>
              )}
            </div>
          ))}
        </div>

        <div className="cd-opts">
          {recent.length > 0 && (
            <select
              className="mini-select"
              value=""
              title="复用最近一条提交信息"
              onChange={(e) => {
                const idx = Number(e.target.value);
                if (Number.isFinite(idx) && recent[idx]) setMessage(recent[idx]);
              }}
            >
              <option value="">最近消息…</option>
              {recent.map((m, i) => (
                <option key={i} value={i}>
                  {m.split('\n')[0].slice(0, 60)}
                </option>
              ))}
            </select>
          )}
          <label className="chk" title="并入上一次提交（git commit --amend）">
            <input type="checkbox" checked={amend} onChange={(e) => setAmend(e.target.checked)} />
            修正上次提交
          </label>
          <label className="chk">
            <input
              type="checkbox"
              checked={signoff}
              onChange={(e) => setSignoff(e.target.checked)}
            />
            Sign-off
          </label>
          <label
            className="chk"
            title="跳过 pre-commit / commit-msg 钩子（git commit --no-verify）"
          >
            <input
              type="checkbox"
              checked={noVerify}
              onChange={(e) => setNoVerify(e.target.checked)}
            />
            绕过钩子
          </label>
        </div>

        <textarea
          className="commit-msg"
          value={message}
          autoFocus
          placeholder={
            amend ? '修正上次提交信息…' : '提交信息（第一行摘要，空一行写正文）· Ctrl+Enter 提交'
          }
          spellCheck={false}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              void submit();
            }
          }}
        />

        <div className="modal-actions">
          <span className="hint mono">git commit -F -</span>
          <span className="spacer" />
          <button className="btn" onClick={close}>
            取消
          </button>
          <button className="btn primary" disabled={!canCommit} onClick={() => void submit()}>
            {amend ? '修正提交' : '提交'}
          </button>
        </div>
      </div>
    </div>
  );
}
