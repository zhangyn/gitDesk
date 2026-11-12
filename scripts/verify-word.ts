/**
 * 行内差异（word-level diff）的纯函数验证。
 * 这块不碰 git：输入两行文本，断言分段结果。
 */
import { buildWordMap, diffWords, tokenize } from '../src/patch/word';
import type { DiffHunk, DiffLine } from '../src/types';

let pass = 0;
let fail = 0;
const failures: string[] = [];

function check(name: string, cond: boolean, detail?: unknown): void {
  if (cond) pass += 1;
  else {
    fail += 1;
    failures.push(`${name}${detail === undefined ? '' : ` → ${JSON.stringify(detail)}`}`);
  }
}

function eq(name: string, actual: unknown, expected: unknown): void {
  check(name, JSON.stringify(actual) === JSON.stringify(expected), { actual, expected });
}

/** 只取变化片段，便于断言 */
const changedText = (segs: { text: string; changed: boolean }[]) =>
  segs.filter((s) => s.changed).map((s) => s.text);

try {
  // 1) 变量名变化
  {
    const { a, b } = diffWords('const count = 1;', 'const total = 1;');
    eq('变量名：左侧变化片段', changedText(a), ['count']);
    eq('变量名：右侧变化片段', changedText(b), ['total']);
    eq('变量名：左侧拼回原文', a.map((s) => s.text).join(''), 'const count = 1;');
    eq('变量名：右侧拼回原文', b.map((s) => s.text).join(''), 'const total = 1;');
  }

  // 2) 完全相同
  {
    const { a, b } = diffWords('same line', 'same line');
    eq('相同行：左侧无变化片段', changedText(a), []);
    eq('相同行：右侧无变化片段', changedText(b), []);
  }

  // 3) 只有缩进变化：不应该把整行点亮
  {
    const { a, b } = diffWords('    foo();', '  foo();');
    eq('纯缩进：左侧不标记变化', changedText(a), []);
    eq('纯缩进：右侧不标记变化', changedText(b), []);
    eq(
      '纯缩进：文本未丢',
      [a.map((s) => s.text).join(''), b.map((s) => s.text).join('')],
      ['    foo();', '  foo();'],
    );
  }

  // 4) 参数变多
  {
    const { b } = diffWords('call(a)', 'call(a, b)');
    check('追加参数：右侧变化片段含 "b"', changedText(b).join('').includes('b'), changedText(b));
  }

  // 5) 中文内容的差异
  {
    const { a, b } = diffWords('// 旧注释：计算金额', '// 新注释：计算金额');
    eq('中文：左侧变化片段', changedText(a), ['旧']);
    eq('中文：右侧变化片段', changedText(b), ['新']);
  }

  // 6) 空行
  {
    const { a, b } = diffWords('', 'x');
    eq('空行：左侧为空', a.length, 0);
    check('空行：右侧整行标记', changedText(b).join('') === 'x', b);
  }

  // 7) 超长行走整行兜底（避免 O(n*m)）
  {
    const long = 'a'.repeat(1) + ' x'.repeat(500);
    const { a } = diffWords(long, long.replace('x', 'y'));
    eq('超长行：整行标记为变化', a.length, 1);
    check('超长行：分段合并成一段', a[0].changed === true, a[0]);
  }

  // 8) tokenize 保留空白与标点
  {
    eq('tokenize：拆分结果拼回原文', tokenize('a = b + 1;').join(''), 'a = b + 1;');
    check('tokenize：空白单独成 token', tokenize('a  b').includes('  '), tokenize('a  b'));
  }

  // 9) buildWordMap：只配对 del/add
  {
    const line = (kind: DiffLine['kind'], text: string, i: number): DiffLine => ({
      kind,
      text,
      oldNo: kind === 'add' ? null : i,
      newNo: kind === 'del' ? null : i,
    });
    const hunk: DiffHunk = {
      header: '@@ -1,3 +1,4 @@',
      oldStart: 1,
      oldLines: 3,
      newStart: 1,
      newLines: 4,
      lines: [
        line('ctx', 'context', 1),
        line('del', 'const count = 1;', 2),
        line('add', 'const total = 1;', 2),
        line('add', 'const extra = 2;', 3),
        line('ctx', 'tail', 3),
      ],
    };
    const map = buildWordMap(hunk);
    check('wordMap：配对的删除行有分段', map.has(1), [...map.keys()]);
    check('wordMap：配对的新增行有分段', map.has(2), [...map.keys()]);
    check('wordMap：多出来的新增行不配对', !map.has(3), [...map.keys()]);
    check('wordMap：上下文行不入表', !map.has(0) && !map.has(4), [...map.keys()]);
    eq('wordMap：配对行的变化片段', changedText(map.get(1) ?? []), ['count']);
  }
} catch (e) {
  fail += 1;
  failures.push(`脚本异常：${e instanceof Error ? e.message : String(e)}`);
}

const total = pass + fail;
console.log(`\n行内差异验证：${pass}/${total} 通过`);
if (fail > 0) {
  console.log('\n失败项：');
  for (const f of failures) console.log('  ✗ ' + f);
  process.exitCode = 1;
} else {
  console.log('全部通过 ✓');
}
