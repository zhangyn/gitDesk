import { runGit } from '../runner';

export async function createTag(
  repoPath: string,
  name: string,
  message: string,
  at?: string,
) {
  const args = ['tag'];
  if (message.trim()) {
    args.push('-a', name, '-m', message.trim());
  } else {
    args.push(name);
  }
  if (at) args.push(at);
  return runGit(args, { cwd: repoPath, timeoutMs: 60_000 });
}

export async function deleteTag(repoPath: string, name: string) {
  return runGit(['tag', '-d', '--', name], { cwd: repoPath });
}

export async function pushTag(repoPath: string, name: string, remote = 'origin') {
  return runGit(['push', remote, name], { cwd: repoPath, timeoutMs: 180_000 });
}
