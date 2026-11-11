import { useEffect, useState } from 'react';
import { useStore } from '../store';

/**
 * 远端认证失败时弹出的凭据输入框。
 *
 * 密码/Token 只通过环境变量传给 git（见 git/runner.ts 的一次性凭据），
 * 不会出现在 argv 里，所以命令日志中看不到，也不会被复制出去。
 */
export function CredentialDialog() {
  const req = useStore((s) => s.credRequest);
  const submit = useStore((s) => s.submitCredentials);
  const cancel = useStore((s) => s.cancelCredentials);
  const remotes = useStore((s) => s.remotes);
  const remote = useStore((s) => s.remote);

  const [user, setUser] = useState('');
  const [pass, setPass] = useState('');
  const [remember, setRemember] = useState(true);
  const [working, setWorking] = useState(false);

  useEffect(() => {
    if (!req) return;
    setUser('');
    setPass('');
    setWorking(false);
  }, [req]);

  useEffect(() => {
    if (!req) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') cancel();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [req, cancel]);

  if (!req) return null;

  const current = remotes.find((r) => r.name === remote);
  const host = current?.fetchUrl.replace(/^https?:\/\//, '').split('/')[0] ?? remote;

  const canSubmit = user.trim().length > 0 && pass.length > 0 && !working;

  const run = async () => {
    if (!canSubmit) return;
    setWorking(true);
    await submit(user.trim(), pass, remember);
  };

  return (
    <div className="modal-mask" onMouseDown={cancel}>
      <div className="modal cred-modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-title">需要登录：{host}</div>
        <div className="modal-body">
          {req.label} 需要远端认证。GitDesk 不会把凭据写进命令或日志。
        </div>

        <div className="cmp-row">
          <label className="cmp-label">用户名</label>
          <input
            className="modal-input mono"
            autoFocus
            value={user}
            onChange={(e) => setUser(e.target.value)}
            placeholder="GitHub 用户名"
            spellCheck={false}
          />
        </div>
        <div className="cmp-row">
          <label className="cmp-label">Token / 密码</label>
          <input
            className="modal-input mono"
            type="password"
            value={pass}
            onChange={(e) => setPass(e.target.value)}
            placeholder="GitHub 用 Personal Access Token"
            spellCheck={false}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void run();
            }}
          />
        </div>

        <label className="chk cred-remember">
          <input
            type="checkbox"
            checked={remember}
            onChange={(e) => setRemember(e.target.checked)}
          />
          交给系统凭据管理器保存（下次不用再输）
        </label>

        <div className="modal-body cred-hint">
          GitHub 从 2021 起不接受账号密码推送，请用 <span className="mono">Personal Access Token</span>
          （Settings → Developer settings → Tokens，勾 <span className="mono">repo</span>）。
          也可以改成 SSH 远端：<span className="mono">git remote set-url origin git@github.com:…</span>
        </div>

        <div className="modal-actions">
          <button className="btn" onClick={cancel} disabled={working}>
            取消
          </button>
          <button className="btn primary" disabled={!canSubmit} onClick={() => void run()}>
            {working ? '重试中…' : '登录并重试'}
          </button>
        </div>
      </div>
    </div>
  );
}
