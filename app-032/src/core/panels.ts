/**
 * 蒙面裁片放样（规格书 §4.4 / §8）
 * 统一守住的规则（裁片页 / 裁片图 / 材料页 / 1:1 图纸四处同源）：
 *  - 裁切尺寸 = 展开净尺寸 + 缝份 × 2（每个尺寸方向的两条边各加一道缝份）；
 *  - 顶/底盖口沿处净尺寸按毫米取整（Math.round），再加两道缝份；
 *  - 缝份为 0 时裁切尺寸与净尺寸完全相等（仍是两套数，不得写成一个数）；
 *  - 正多边形盖片按「对边距」外放缝份：四条边缝份等宽、角上对位标记与每条棱对齐，
 *    代价是角上多出一块料（买纸买布按含缝份面积已计入）；不按外接圆外放——
 *    那样边中段缝份保不住、角标对不上棱，对边距↔外接圆的换算也失去意义；
 *  - 长度 mm（1 位小数，r1），面积 m²（3 位小数，r3），全项目统一。
 * 对位标记坐标位于「裁片坐标系」：原点为裁片（含缝份）外接框左下角，x 向右，y 向上，单位 mm。
 */
import type { Lantern, Panel, PanelMark, PanelShape } from './types'
import {
  buildGeometry,
  capArea,
  polyhedronInfo,
  r1,
  segmentInfos,
  TAU,
  type Geometry
} from './geometry'

export interface PanelResult {
  geometry: Geometry
  panels: Panel[]
  /** 净面积合计（不含缝份，mm²） */
  netAreaMm2: number
  /** 裁片面积合计（含缝份，mm²） */
  cutAreaMm2: number
  /** 裁片总块数 */
  totalQty: number
}

function areaOf(p: Panel, withSeam: boolean): number {
  // 净面积按净尺寸、含缝份面积按裁切尺寸，两套数分开算（缝份为 0 时两者自然相等）
  const wTop = withSeam ? p.widthTopMm : p.rawWidthTopMm
  const wBot = withSeam ? p.widthBottomMm : p.rawWidthBottomMm
  const h = withSeam ? p.heightMm : p.rawHeightMm
  switch (p.shape) {
    case 'circle': {
      if (p.polySides && p.polySides >= 3) {
        // 正多边形：面积 = n · apothem² · tan(π/n)，apothem = 对边距/2
        const a = wTop / 2
        return p.polySides * a * a * Math.tan(Math.PI / p.polySides)
      }
      return Math.PI * (wTop / 2) ** 2
    }
    case 'triangle':
      return (wTop * h) / 2
    default:
      return ((wTop + wBot) / 2) * h
  }
}

/** 含缝份裁片面积（按裁切尺寸，mm²） */
export function panelCutArea(p: Panel): number {
  return areaOf(p, true)
}

/** 裁片净面积（按展开净尺寸，mm²） */
export function panelNetArea(p: Panel): number {
  return areaOf(p, false)
}

/** 口沿净尺寸（毫米取整）：圆形盖 = 净直径；正多边形盖 = 净对边距 */
export function rimNetSizeMm(rMm: number, polygon: boolean, sides: number): number {
  return polygon
    ? Math.round(2 * rMm * Math.cos(Math.PI / Math.max(3, Math.round(sides))))
    : Math.round(2 * rMm)
}

/** 裁片含缝份外接框（mm）：裁片页图与 1:1 图纸共用同一套外接框 */
export function panelCutBox(p: Panel): { wMm: number; hMm: number } {
  return { wMm: Math.max(p.widthTopMm, p.widthBottomMm), hMm: p.heightMm }
}

/** 正多边形顶点串（y 向下）；acrossFlatsMm = 对边距，外接圆半径 = 对边距/2/cos(π/n) */
export function polygonPointsMm(sides: number, acrossFlatsMm: number, cxMm: number, cyMm: number): string {
  const r = acrossFlatsMm / 2 / Math.cos(Math.PI / sides)
  return Array.from({ length: sides }, (_, k) => {
    const a = -Math.PI / 2 + (TAU * k) / sides
    return `${(cxMm + r * Math.cos(a)).toFixed(2)},${(cyMm + r * Math.sin(a)).toFixed(2)}`
  }).join(' ')
}

/**
 * 裁切线顶点（y 向下、原点为裁片含缝份外接框左上角，mm）。
 * 纯圆形裁片返回空串，改用 panelCircle 画圆。
 */
export function panelCutPoints(p: Panel): string {
  const { wMm: w, hMm: h } = panelCutBox(p)
  if (p.shape === 'circle') return p.polySides ? polygonPointsMm(p.polySides, w, w / 2, h / 2) : ''
  if (p.shape === 'triangle') return `0,${h} ${w},${h} ${w / 2},0`
  return `${(w - p.widthBottomMm) / 2},${h} ${(w + p.widthBottomMm) / 2},${h} ${(w + p.widthTopMm) / 2},0 ${(w - p.widthTopMm) / 2},0`
}

/**
 * 净样线（绿色虚线）顶点，与裁切线同一坐标系。
 * 画在净样上、跟随当前缝份（不是固定内缩一段）；缝份为 0 时与裁切线重合。
 */
export function panelNetPoints(p: Panel): string {
  const { wMm: w, hMm: h } = panelCutBox(p)
  const s = p.seamAllowanceMm
  if (p.shape === 'circle') return p.polySides ? polygonPointsMm(p.polySides, p.rawWidthTopMm, w / 2, h / 2) : ''
  if (p.shape === 'triangle') {
    const rw = p.rawWidthBottomMm
    return `${(w - rw) / 2},${h - s} ${(w + rw) / 2},${h - s} ${w / 2},${h - s - p.rawHeightMm}`
  }
  const yb = h - s
  const yt = h - s - p.rawHeightMm
  return `${(w - p.rawWidthBottomMm) / 2},${yb} ${(w + p.rawWidthBottomMm) / 2},${yb} ${(w + p.rawWidthTopMm) / 2},${yt} ${(w - p.rawWidthTopMm) / 2},${yt}`
}

/** 纯圆形裁片的圆（net=false 裁切线 / net=true 净样线）；非纯圆形返回 null */
export function panelCircle(p: Panel, net: boolean): { cx: number; cy: number; r: number } | null {
  if (p.shape !== 'circle' || p.polySides) return null
  const { wMm, hMm } = panelCutBox(p)
  return { cx: wMm / 2, cy: hMm / 2, r: (net ? p.rawWidthTopMm : wMm) / 2 }
}

/** 生成四边对位标记（裁片坐标系） */
function trapezoidMarks(cutW: number, cutH: number, seam: number, tag: string): PanelMark[] {
  return [
    { x: r1(cutW / 2), y: 0, label: `${tag} 下沿中点` },
    { x: r1(cutW / 2), y: r1(cutH), label: `${tag} 上沿中点` },
    { x: r1(seam), y: r1(seam), label: `${tag} 左下角` },
    { x: r1(cutW - seam), y: r1(seam), label: `${tag} 右下角` }
  ]
}

export function buildPanels(l: Lantern): PanelResult {
  const g = buildGeometry(l)
  const s = Math.max(0, l.seamAllowanceMm)
  const panels: Panel[] = []
  let seq = 0
  const push = (p: Omit<Panel, 'id'>) => {
    panels.push({ ...p, id: `P${String(++seq).padStart(3, '0')}` })
  }

  if (l.kind === 'polyhedron') {
    const info = polyhedronInfo(g)
    const h = (info.edgeMm * Math.sqrt(3)) / 2
    const cutW = info.edgeMm + 2 * s
    const cutH = h + 2 * s
    const marks: PanelMark[] = [
      { x: 0, y: 0, label: '顶点 A' },
      { x: r1(cutW), y: 0, label: '顶点 B' },
      { x: r1(cutW / 2), y: r1(cutH), label: '顶点 C' }
    ]
    push({
      shape: 'triangle',
      label: info.kind === 'tetra' ? '正三角侧片（四面体）' : '正三角侧片（八面体）',
      rawWidthTopMm: r1(info.edgeMm),
      rawWidthBottomMm: r1(info.edgeMm),
      rawHeightMm: r1(h),
      widthTopMm: r1(cutW),
      widthBottomMm: r1(cutW),
      heightMm: r1(cutH),
      seamAllowanceMm: s,
      marksMm: marks,
      qty: info.faceCount,
      layerIndex: -1,
      color: l.layerColors[0] || l.color,
      note: `棱长 ${r1(info.edgeMm)}mm，三边各加 ${s}mm 缝份`
    })
    return finish(g, panels)
  }

  const segs = segmentInfos(g)
  const divisions = Math.max(3, Math.round(l.divisions))

  segs.forEach((sg, i) => {
    const color = l.layerColors[i] || l.color
    const isPolygon = g.polygon
    const rawBottom = isPolygon ? sg.edgeBottomMm : (TAU * sg.r0Mm) / divisions
    const rawTop = isPolygon ? sg.edgeTopMm : (TAU * sg.r1Mm) / divisions
    const rawH = isPolygon ? sg.faceHeightMm : sg.slantMm
    const cutW = Math.max(rawTop, rawBottom) + 2 * s
    const cutH = rawH + 2 * s
    const shape: PanelShape = Math.abs(rawTop - rawBottom) < 0.05 ? 'rectangle' : 'trapezoid'
    push({
      shape,
      label: isPolygon ? `侧面（第 ${i + 1} 层）` : `展开片（第 ${i + 1} 层）`,
      rawWidthTopMm: r1(rawTop),
      rawWidthBottomMm: r1(rawBottom),
      rawHeightMm: r1(rawH),
      widthTopMm: r1(rawTop + 2 * s),
      widthBottomMm: r1(rawBottom + 2 * s),
      heightMm: r1(cutH),
      seamAllowanceMm: s,
      marksMm: trapezoidMarks(cutW, cutH, s, `${i + 1}层`),
      qty: isPolygon ? g.n : divisions,
      layerIndex: i,
      color,
      note: isPolygon
        ? `四边各加 ${s}mm 缝份，${g.n} 块围成一圈`
        : `按 ${divisions} 等分近似展开，每块四边各加 ${s}mm 缝份`
    })
  })

  // 顶盖 / 底盖（口沿净尺寸按毫米取整，裁切 = 净 + 缝份 × 2）
  const topR = g.sections[g.sections.length - 1].radiusMm
  const botR = g.sections[0].radiusMm
  const coverPanel = (r: number, label: string, tag: string, color: string) => {
    if (g.polygon) {
      // 取舍：按对边距外放一圈缝份（四条边缝份等宽、角标与每条棱对得上），
      // 代价是角上多出一块料；不按外接圆外放（省料但边中段缝份保不住、角标对不上棱）。
      const n = g.n
      const netAF = rimNetSizeMm(r, true, n)
      const cutAF = r1(netAF + 2 * s)
      const netCircR = netAF / 2 / Math.cos(Math.PI / n) // 净样外接圆半径（角标落点）
      const marks: PanelMark[] = [{ x: r1(cutAF / 2), y: r1(cutAF / 2), label: `${tag} 中心` }]
      for (let k = 0; k < n; k++) {
        // 与 polygonPointsMm 同一角度约定（首顶点朝上），裁片坐标系 y 向上
        const a = -Math.PI / 2 + (TAU * k) / n
        marks.push({
          x: r1(cutAF / 2 + netCircR * Math.cos(a)),
          y: r1(cutAF / 2 - netCircR * Math.sin(a)),
          label: `${tag} 角 ${k + 1}（对第 ${k + 1} 条棱）`
        })
      }
      push({
        shape: 'circle',
        label,
        rawWidthTopMm: netAF,
        rawWidthBottomMm: netAF,
        rawHeightMm: netAF,
        widthTopMm: cutAF,
        widthBottomMm: cutAF,
        heightMm: cutAF,
        seamAllowanceMm: s,
        marksMm: marks,
        qty: 1,
        radiusMm: r1(netCircR),
        polySides: n,
        layerIndex: -1,
        color,
        note: `正 ${n} 边形裁片，净对边距 ${netAF}mm（净外接圆直径 ${r1(2 * netCircR)}mm），四边各加 ${s}mm 缝份；按对边距外放，角上多出的料用于包棱`
      })
    } else {
      const netD = rimNetSizeMm(r, false, g.n)
      const cutD = r1(netD + 2 * s)
      const marks: PanelMark[] = [
        { x: r1(cutD / 2), y: r1(cutD / 2), label: `${tag} 中心` },
        { x: r1(cutD / 2), y: 0, label: `${tag} 0°` }
      ]
      push({
        shape: 'circle',
        label,
        rawWidthTopMm: netD,
        rawWidthBottomMm: netD,
        rawHeightMm: netD,
        widthTopMm: cutD,
        widthBottomMm: cutD,
        heightMm: cutD,
        seamAllowanceMm: s,
        marksMm: marks,
        qty: 1,
        radiusMm: r1(netD / 2),
        layerIndex: -1,
        color,
        note: `圆形裁片，净直径 ${netD}mm（口沿按毫米取整），裁切直径 = 净 + 缝份 ${s}mm×2`
      })
    }
  }
  coverPanel(topR, '顶盖圆片', '顶盖', l.layerColors[l.layerColors.length - 1] || l.color)
  coverPanel(botR, '底盖圆片', '底盘', l.layerColors[0] || l.color)

  return finish(g, panels)
}

function finish(geometry: Geometry, panels: Panel[]): PanelResult {
  let net = 0
  let cut = 0
  let qty = 0
  for (const p of panels) {
    net += panelNetArea(p) * p.qty
    cut += panelCutArea(p) * p.qty
    qty += p.qty
  }
  return { geometry, panels, netAreaMm2: net, cutAreaMm2: cut, totalQty: qty }
}

/** 顶/底盖净面积（用于面积核对，与裁片公式独立来源） */
export function coverReferenceArea(g: Geometry, divisions: number): number {
  if (g.kind === 'polyhedron') return 0
  const top = g.sections[g.sections.length - 1].radiusMm
  const bot = g.sections[0].radiusMm
  if (g.polygon) return capArea(top, g.n, true) + capArea(bot, g.n, true)
  const d = Math.max(3, divisions)
  return (
    ((d / 2) * top * top * Math.sin(TAU / d)) + ((d / 2) * bot * bot * Math.sin(TAU / d))
  )
}
