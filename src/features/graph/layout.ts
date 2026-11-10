import type { Commit } from '../../types';

export interface GraphEdge {
  from: number;
  to: number;
}

export interface GraphRow {
  sha: string;
  /** 当前提交所在的泳道 */
  lane: number;
  edges: GraphEdge[];
  /** 处理本行之前的泳道状态 */
  before: (string | null)[];
  /** 处理本行之后的泳道状态 */
  after: (string | null)[];
}

/**
 * 提交图泳道布局（纯函数，后续可原样搬进 Web Worker）。
 *
 * 输入必须是拓扑序（`git log --topo-order`），否则同一提交可能出现两次。
 * 语义与 gitk 一致：第一个 parent 继承当前泳道，其余 parent 新开/复用泳道，
 * 多条泳道指向同一提交时收敛到该提交的泳道。
 */
export function layoutGraph(commits: Commit[]): GraphRow[] {
  const lanes: (string | null)[] = [];
  const rows: GraphRow[] = [];
  const seen = new Set<string>();

  const firstFree = (): number => {
    const idx = lanes.indexOf(null);
    if (idx >= 0) return idx;
    lanes.push(null);
    return lanes.length - 1;
  };

  for (const c of commits) {
    // --all + 分页偶尔会重复同一提交，跳过以免泳道错乱
    if (seen.has(c.sha)) continue;
    seen.add(c.sha);

    const before = lanes.slice();

    let lane = lanes.indexOf(c.sha);
    if (lane < 0) {
      lane = firstFree();
      lanes[lane] = c.sha;
    }

    // 其它指向同一提交的泳道：需要收敛到 lane
    const converging: number[] = [];
    for (let i = 0; i < lanes.length; i++) {
      if (i !== lane && lanes[i] === c.sha) {
        converging.push(i);
        lanes[i] = null;
      }
    }

    const edges: GraphEdge[] = [];

    const first = c.parents[0];
    if (first) {
      const existing = lanes.indexOf(first);
      if (existing >= 0 && existing !== lane) {
        // 第一个 parent 已在别的泳道被跟踪 → 本泳道结束，连线过去
        lanes[lane] = null;
        edges.push({ from: lane, to: existing });
      } else {
        lanes[lane] = first;
        edges.push({ from: lane, to: lane });
      }
    } else {
      // 根提交
      lanes[lane] = null;
    }

    for (let k = 1; k < c.parents.length; k++) {
      const p = c.parents[k];
      let target = lanes.indexOf(p);
      if (target < 0) {
        target = firstFree();
        lanes[target] = p;
      }
      edges.push({ from: lane, to: target });
    }

    for (const i of converging) edges.push({ from: i, to: lane });

    while (lanes.length > 0 && lanes[lanes.length - 1] === null) lanes.pop();

    rows.push({ sha: c.sha, lane, edges, before, after: lanes.slice() });
  }

  return rows;
}

export function maxLane(rows: GraphRow[]): number {
  let max = 0;
  for (const r of rows) {
    max = Math.max(max, r.before.length, r.after.length, r.lane + 1);
  }
  return max;
}
