import type { GraphRow } from './layout';

export const ROW_HEIGHT = 26;
/** 泳道基准宽度（泳道少时用它） */
export const LANE_WIDTH = 13;
export const PAD_X = 8;
/** 图区最大占用宽度。再宽就把提交信息挤没了 */
const MAX_GRAPH_WIDTH = 156;
/** 泳道再多也不能让 step 低于这个值 */
const MIN_LANE_STEP = 1.8;
/** 最多绘制多少列泳道；超出的折到最后一列，避免几百条分支糊成一条彩色噪点带 */
const MAX_DRAWN_LANES = 22;

export const LANE_COLORS = [
  '#7ee787',
  '#58a6ff',
  '#d2a8ff',
  '#ffa657',
  '#f778ba',
  '#39c5cf',
  '#e3b341',
  '#ff7b72',
  '#a5d6ff',
  '#b1bac4',
];

function laneCount(rows: GraphRow[]): number {
  let max = 0;
  for (const r of rows) {
    max = Math.max(max, r.before.length, r.after.length, r.lane + 1);
  }
  return Math.max(1, max);
}

/**
 * 泳道步长：按泳道总数压缩，保证 laneCount * step 一定落在画布内。
 * 这点很关键 —— 之前 step 有 4.5px 下限，60 条泳道会算出 286px，超出 156px 画布后被直接裁掉。
 */
export function laneStepFor(rows: GraphRow[]): number {
  const n = laneCount(rows);
  const fit = (MAX_GRAPH_WIDTH - PAD_X * 2) / n;
  return Math.max(MIN_LANE_STEP, Math.min(LANE_WIDTH, fit));
}

export function graphWidthFor(rows: GraphRow[]): number {
  const n = Math.min(MAX_DRAWN_LANES, laneCount(rows));
  const step = Math.min(LANE_WIDTH, (MAX_GRAPH_WIDTH - PAD_X * 2) / Math.max(1, n));
  return Math.min(MAX_GRAPH_WIDTH, PAD_X * 2 + n * Math.max(MIN_LANE_STEP, step));
}

/** 给 UI 用的诊断值：泳道太多时提示"已压缩" */
export function laneStats(rows: GraphRow[]): { lanes: number; step: number } {
  return { lanes: laneCount(rows), step: laneStepFor(rows) };
}

/**
 * 把提交图绘制到一张「整表高度」的 canvas 上。
 * canvas 位于文本行之下（z-index 更低），行本身背景透明，因此不需要虚拟滚动也能
 * 在 400 行级别保持 60fps。超过 2000 行时再切分片/虚拟化。
 */
function laneSpan(rows: GraphRow[]): number {
  return laneCount(rows);
}

export function drawGraph(
  canvas: HTMLCanvasElement,
  rows: GraphRow[],
  opts: {
    /** 画布宽度（整行宽度，用于铺选中/hover 底色） */
    width: number;
    /** 泳道图区宽度（文本从它右边开始） */
    graphWidth: number;
    height: number;
    selectedIndex: number;
    hoverIndex: number;
  },
): void {
  const dpr = window.devicePixelRatio || 1;
  const { width, graphWidth, height } = opts;

  canvas.width = Math.max(1, Math.floor(width * dpr));
  canvas.height = Math.max(1, Math.floor(height * dpr));
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;

  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  // 节点描边要和底色一致（浅色主题下是白），否则会有一圈黑边
  const ring =
    getComputedStyle(document.documentElement).getPropertyValue('--node-ring').trim() || '#0d1117';

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);

  const span = Math.min(MAX_DRAWN_LANES, laneSpan(rows));
  const step = Math.max(
    MIN_LANE_STEP,
    Math.min(LANE_WIDTH, (graphWidth - PAD_X * 2) / Math.max(1, span)),
  );
  const clampLane = (l: number) => Math.min(l, MAX_DRAWN_LANES - 1);
  const x = (lane: number): number => PAD_X + clampLane(lane) * step + step / 2;
  // 泳道密时节点和线一起变细，否则会糊成一团
  const nodeR = Math.max(1.15, Math.min(3.6, step * 0.42));
  ctx.lineWidth = Math.max(0.9, Math.min(1.6, step * 0.22));

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const yTop = i * ROW_HEIGHT;
    const yMid = yTop + ROW_HEIGHT / 2;
    const yBot = yTop + ROW_HEIGHT;

    if (i === opts.selectedIndex) {
      ctx.fillStyle = 'rgba(88, 166, 255, 0.14)';
      ctx.fillRect(0, yTop, width, ROW_HEIGHT);
      ctx.fillStyle = 'rgba(88, 166, 255, 0.9)';
      ctx.fillRect(0, yTop, 2, ROW_HEIGHT);
    } else if (i === opts.hoverIndex) {
      ctx.fillStyle = 'rgba(255, 255, 255, 0.04)';
      ctx.fillRect(0, yTop, width, ROW_HEIGHT);
    }

    ctx.lineCap = 'round';

    // 上半段：进入本行的泳道
    for (let l = 0; l < Math.min(r.before.length, MAX_DRAWN_LANES); l++) {
      if (r.before[l] == null) continue;
      ctx.strokeStyle = LANE_COLORS[l % LANE_COLORS.length];
      ctx.beginPath();
      ctx.moveTo(x(l), yTop);
      ctx.lineTo(x(l), yMid);
      ctx.stroke();
    }

    // 下半段：离开本行的泳道
    for (let l = 0; l < Math.min(r.after.length, MAX_DRAWN_LANES); l++) {
      if (r.after[l] == null) continue;
      ctx.strokeStyle = LANE_COLORS[l % LANE_COLORS.length];
      ctx.beginPath();
      ctx.moveTo(x(l), yMid);
      ctx.lineTo(x(l), yBot);
      ctx.stroke();
    }

    // 跨泳道的连线（合并 / 收敛）
    for (const e of r.edges) {
      if (e.from === e.to) continue;
      ctx.strokeStyle = LANE_COLORS[e.to % LANE_COLORS.length];
      ctx.beginPath();
      ctx.moveTo(x(e.from), yMid);
      ctx.lineTo(x(e.to), yBot);
      ctx.stroke();
    }

    // 节点
    const cx = x(r.lane);
    ctx.beginPath();
    ctx.arc(cx, yMid, nodeR, 0, Math.PI * 2);
    ctx.fillStyle = LANE_COLORS[r.lane % LANE_COLORS.length];
    ctx.fill();
    ctx.lineWidth = Math.min(1.2, Math.max(0.6, nodeR * 0.45));
    ctx.strokeStyle = ring;
    ctx.stroke();
  }
}
