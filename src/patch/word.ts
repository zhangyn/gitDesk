import type { DiffHunk } from '../types';

export interface Segment {
  text: string;
  /** 该片段在两侧不同（需要加重高亮） */
  changed: boolean;
}

/** 超过这个 token 数就不做逐词比较，直接整行标记（避免 O(n*m) 爆掉） */
const MAX_TOKENS = 400;

const TOKEN_RE = /\s+|[A-Za-z0-9_]+|[^\sA-Za-z0-9_]/gu;

export function tokenize(line: string): string[] {
  return line.match(TOKEN_RE) ?? [];
}

/** 最长公共子序列的匹配表（只返回两边需要跳过的 token 集合） */
function lcsKeep(a: string[], b: string[]): { keepA: boolean[]; keepB: boolean[] } {
  const n = a.length;
  const m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const keepA = new Array(n).fill(false);
  const keepB = new Array(m).fill(false);
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      keepA[i] = true;
      keepB[j] = true;
      i += 1;
      j += 1;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      i += 1;
    } else {
      j += 1;
    }
  }
  return { keepA, keepB };
}

function toSegments(tokens: string[], keep: boolean[]): Segment[] {
  const out: Segment[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const changed = !keep[i];
    const last = out[out.length - 1];
    if (last && last.changed === changed) last.text += tokens[i];
    else out.push({ text: tokens[i], changed });
  }
  return mergePureWhitespace(out);
}

/**
 * 纯空白的差异片段没必要单独加重（否则缩进变化会让整行都亮），
 * 合并进相邻片段即可。
 */
function mergePureWhitespace(segs: Segment[]): Segment[] {
  if (!segs.some((s) => s.changed && s.text.trim() === '')) return segs;
  const out: Segment[] = [];
  for (const s of segs) {
    const changed = s.changed && !(s.text.trim() === '' && s.text.length > 0);
    const last = out[out.length - 1];
    if (last && last.changed === changed) last.text += s.text;
    else out.push({ text: s.text, changed });
  }
  return out;
}

/** 逐词比较两行，返回两侧的分段 */
export function diffWords(oldLine: string, newLine: string): { a: Segment[]; b: Segment[] } {
  const a = tokenize(oldLine);
  const b = tokenize(newLine);
  if (a.length === 0 || b.length === 0 || a.length > MAX_TOKENS || b.length > MAX_TOKENS) {
    return {
      a: oldLine ? [{ text: oldLine, changed: true }] : [],
      b: newLine ? [{ text: newLine, changed: true }] : [],
    };
  }
  const { keepA, keepB } = lcsKeep(a, b);
  return { a: toSegments(a, keepA), b: toSegments(b, keepB) };
}

/**
 * 为一个 hunk 计算「行号 → 分段」的映射。
 * 只处理相邻的 del/add 块：块内按位配对（和分栏视图的对齐方式一致），
 * 配不上的那一侧整行标记。
 */
export function buildWordMap(hunk: DiffHunk): Map<number, Segment[]> {
  const map = new Map<number, Segment[]>();
  const lines = hunk.lines;
  let i = 0;

  while (i < lines.length) {
    if (lines[i].kind !== 'del' && lines[i].kind !== 'add') {
      i += 1;
      continue;
    }
    const delIdx: number[] = [];
    const addIdx: number[] = [];
    while (i < lines.length && (lines[i].kind === 'del' || lines[i].kind === 'add')) {
      if (lines[i].kind === 'del') delIdx.push(i);
      else addIdx.push(i);
      i += 1;
    }
    // 只有真正成对的行才值得逐词比较
    const pairs = Math.min(delIdx.length, addIdx.length);
    for (let k = 0; k < pairs; k++) {
      const di = delIdx[k];
      const ai = addIdx[k];
      const { a, b } = diffWords(lines[di].text, lines[ai].text);
      map.set(di, a);
      map.set(ai, b);
    }
  }
  return map;
}
