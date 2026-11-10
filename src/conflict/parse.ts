/**
 * 冲突标记解析与合成。
 *
 * 数据源是**已被 git 合并过的**工作区文件（含 <<<<<<< / ======= / >>>>>>> 标记），
 * 而不是自己实现 diff3 —— git 已经做过三方合并，我们只负责让用户逐块拍板。
 * 支持 merge.conflictStyle=diff3 时的 ||||||| 基线段。
 */

export type ConflictSide = 'ours' | 'theirs';

export interface TextBlock {
  kind: 'text';
  text: string;
}

export interface ConflictBlock {
  kind: 'conflict';
  id: number;
  oursLabel: string;
  theirsLabel: string;
  hasBase: boolean;
  ours: string[];
  base: string[];
  theirs: string[];
}

export type Block = TextBlock | ConflictBlock;

export type Decision = ConflictSide | 'both' | 'both-reverse';

export interface ParsedConflict {
  blocks: Block[];
  conflicts: ConflictBlock[];
  /** 解析时跳过的畸形标记（仅用于诊断，不影响合成） */
  warnings: string[];
}

const OURS = /^<{7}(\s|$)/;
const BASE = /^\|{7}(\s|$)/;
const SEP = /^={7}\s*$/;
const THEIRS = /^>{7}(\s|$)/;

function stripMarkerLabel(line: string): string {
  return line.replace(/^[<|>]{7}\s*/, '').trim();
}

/**
 * 把冲突文件切成「普通文本块 + 冲突块」。
 * 不在冲突状态时出现的 ======= 视为普通文本（避免把 Markdown 分隔线当成分隔符）。
 */
export function parseConflictFile(content: string): ParsedConflict {
  const trailingNewline = content.endsWith('\n');
  const lines = content.split('\n');
  if (trailingNewline) lines.pop();

  const blocks: Block[] = [];
  const conflicts: ConflictBlock[] = [];
  const warnings: string[] = [];

  let text: string[] = [];
  let state: 'text' | 'ours' | 'base' | 'theirs' = 'text';
  let cur: ConflictBlock | null = null;
  let id = 0;

  const flushText = () => {
    if (text.length > 0) {
      blocks.push({ kind: 'text', text: text.join('\n') });
      text = [];
    }
  };

  for (const line of lines) {
    if (state === 'text') {
      if (OURS.test(line)) {
        flushText();
        id += 1;
        cur = {
          kind: 'conflict',
          id,
          oursLabel: stripMarkerLabel(line) || 'ours',
          theirsLabel: 'theirs',
          hasBase: false,
          ours: [],
          base: [],
          theirs: [],
        };
        state = 'ours';
      } else {
        text.push(line);
      }
      continue;
    }

    if (state === 'ours') {
      if (BASE.test(line)) {
        cur!.hasBase = true;
        state = 'base';
      } else if (SEP.test(line)) {
        state = 'theirs';
      } else if (THEIRS.test(line)) {
        // 没有 ======= 的畸形块：直接把 ours 当成唯一内容
        warnings.push(`冲突块 #${cur!.id} 缺少 ======= 分隔线`);
        finishConflict();
      } else if (OURS.test(line)) {
        warnings.push(`冲突块 #${cur!.id} 内出现嵌套 <<<<<<<，已按文本处理`);
        cur!.ours.push(line);
      } else {
        cur!.ours.push(line);
      }
      continue;
    }

    if (state === 'base') {
      if (SEP.test(line)) {
        state = 'theirs';
      } else if (THEIRS.test(line)) {
        warnings.push(`冲突块 #${cur!.id} 缺少 ======= 分隔线`);
        finishConflict();
      } else {
        cur!.base.push(line);
      }
      continue;
    }

    if (state === 'theirs') {
      if (THEIRS.test(line)) {
        cur!.theirsLabel = stripMarkerLabel(line) || 'theirs';
        finishConflict();
      } else if (SEP.test(line)) {
        warnings.push(`冲突块 #${cur!.id} 内出现重复 =======`);
        cur!.theirs.push(line);
      } else {
        cur!.theirs.push(line);
      }
      continue;
    }
  }

  if (state !== 'text' && cur) {
    warnings.push(`文件结尾有未闭合的冲突块 #${cur.id}`);
    finishConflict();
  }
  flushText();

  function finishConflict(): void {
    if (!cur) return;
    blocks.push(cur);
    conflicts.push(cur);
    cur = null;
    state = 'text';
  }

  const parsed: ParsedConflict = { blocks, conflicts, warnings };
  // trailingNewline 通过 resolve 时补回，这里记录在 warnings 之外：
  Object.defineProperty(parsed, '__trailingNewline', { value: trailingNewline, enumerable: false });
  return parsed;
}

/** 只要文件里有冲突标记就算未解决 */
export function hasConflictMarkers(content: string): boolean {
  return content.split('\n').some((l) => OURS.test(l) || SEP.test(l) || THEIRS.test(l));
}

const DEFAULT_DECISION: Decision = 'ours';

/**
 * 按决策合成最终内容。
 * 未给出决策的块默认「采用我方」——与 git checkout --ours 的心智一致，
 * 但 UI 会明确提示还有几块没拍板。
 */
export function resolveConflict(
  parsed: ParsedConflict,
  decisions: Record<number, Decision>,
): string {
  const trailing = Boolean(
    (parsed as unknown as { __trailingNewline?: boolean }).__trailingNewline,
  );
  const out: string[] = [];

  for (const block of parsed.blocks) {
    if (block.kind === 'text') {
      out.push(block.text);
      continue;
    }
    const d = decisions[block.id] ?? DEFAULT_DECISION;
    if (d === 'ours') out.push(...block.ours);
    else if (d === 'theirs') out.push(...block.theirs);
    else if (d === 'both') out.push(...block.ours, ...block.theirs);
    else out.push(...block.theirs, ...block.ours);
  }

  const joined = out.join('\n');
  if (trailing) return joined.endsWith('\n') ? joined : `${joined}\n`;
  return joined.replace(/\n+$/, '');
}

/** 还有多少块没拍板 */
export function undecidedCount(
  parsed: ParsedConflict,
  decisions: Record<number, Decision>,
): number {
  return parsed.conflicts.filter((c) => decisions[c.id] === undefined).length;
}

/** 两侧差异行数统计，用于列表里给个规模感 */
export function conflictSize(block: ConflictBlock): { ours: number; theirs: number } {
  return { ours: block.ours.length, theirs: block.theirs.length };
}
