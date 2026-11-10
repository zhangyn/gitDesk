import { useEffect, useState } from 'react';
import { countEntries, useStore } from '../store';

export function CommitPanel() {
  const status = useStore((s) => s.status);
  const doCommit = useStore((s) => s.doCommit);
  const setBottomPanel = useStore((s) => s.setBottomPanel);
  const lastCommitMessage = useStore((s) => s.lastCommitMessage);
  const busy = useStore((s) => s.busy);
  const branch = status?.branch.head ?? null;

  const [message, setMessage] = useState('');
  const [amend, setAmend] = useState(false);
  const [signoff, setSignoff] = useState(false);
  const [working, setWorking] = useState(false);

  const counts = countEntries(status);

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

  const submit = async () => {
    if (!canCommit) return;
    setWorking(true);
    const ok = await doCommit({ message, amend, signoff });
    setWorking(false);
    if (ok) {
      setMessage('');
      setAmend(false);
    }
  };

  return (
    <div className="bottom-panel commit-panel">
      <div className="bp-head">
        <span className="bp-title">提交</span>
        <span className="bp-sub">
          {branch ? `到 ${branch}` : 'detached HEAD'} · 已暂存 {counts.staged} 个文件
          {counts.worktree > 0 && counts.staged === 0
            ? '（工作区还有未暂存改动，先在左侧列表点 + 暂存）'
            : ''}
        </span>
        <span className="spacer" />
        <label className="chk">
          <input type="checkbox" checked={amend} onChange={(e) => setAmend(e.target.checked)} />
          修正上次提交
        </label>
        <label className="chk">
          <input type="checkbox" checked={signoff} onChange={(e) => setSignoff(e.target.checked)} />
          Sign-off
        </label>
        <button className="icon-btn" title="关闭（Esc）" onClick={() => setBottomPanel('commit')}>
          ✕
        </button>
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

      <div className="bp-foot">
        <span className="hint mono">git commit -F -</span>
        <span className="spacer" />
        <button className="btn" onClick={() => setBottomPanel('commit')}>
          取消
        </button>
        <button className="btn primary" disabled={!canCommit} onClick={() => void submit()}>
          {amend ? '修正提交' : '提交'}
        </button>
      </div>
    </div>
  );
}
