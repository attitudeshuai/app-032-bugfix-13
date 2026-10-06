/**
 * 蒙面裁片放样（规格书 §4.4 / §8）
 * 裁片尺寸 = 展开净尺寸 + 缝份 × 2（每个尺寸方向的两条边各加一道缝份）。
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
  switch (p.shape) {
    case 'circle': {
      // 圆形与正 n 边形盖片统一用「直径 / 对边距」作特征尺寸：
      // 净样取 rawWidthTopMm（= 净直径或净对边距），裁样取 widthTopMm（= 净尺寸 + 2×缝份）。
      const d = withSeam ? p.widthTopMm : p.rawWidthTopMm
      if (p.polySides && p.polySides >= 3) {
        // 正多边形面积 = n · apothem² · tan(π/n)，apothem = 对边距/2
        const a = d / 2
        return p.polySides * a * a * Math.tan(Math.PI / p.polySides)
      }
      return Math.PI * (d / 2) ** 2
    }
    case 'triangle': {
      const w = withSeam ? p.widthTopMm : p.rawWidthTopMm
      const h = withSeam ? p.heightMm : p.rawHeightMm
      return (w * h) / 2
    }
    default: {
      const wt = withSeam ? p.widthTopMm : p.rawWidthTopMm
      const wb = withSeam ? p.widthBottomMm : p.rawWidthBottomMm
      const h = withSeam ? p.heightMm : p.rawHeightMm
      return ((wt + wb) / 2) * h
    }
  }
}

export function panelCutArea(p: Panel): number {
  return areaOf(p, true)
}

export function panelNetArea(p: Panel): number {
  return areaOf(p, false)
}

/** 生成对位标记（裁片坐标系，y 向上）：上下沿中点 + 净样四个折角 */
function trapezoidMarks(
  cutW: number,
  cutH: number,
  rawTop: number,
  rawBottom: number,
  rawH: number,
  seam: number,
  tag: string
): PanelMark[] {
  const xbL = (cutW - rawBottom) / 2
  const xbR = (cutW + rawBottom) / 2
  const xtL = (cutW - rawTop) / 2
  const xtR = (cutW + rawTop) / 2
  return [
    { x: r1(cutW / 2), y: 0, label: `${tag} 下沿中点` },
    { x: r1(cutW / 2), y: r1(cutH), label: `${tag} 上沿中点` },
    { x: r1(xbL), y: r1(seam), label: `${tag} 净样左下折角` },
    { x: r1(xbR), y: r1(seam), label: `${tag} 净样右下折角` },
    { x: r1(xtL), y: r1(seam + rawH), label: `${tag} 净样左上折角` },
    { x: r1(xtR), y: r1(seam + rawH), label: `${tag} 净样右上折角` }
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
    // 净样（等边三角形）三个顶点（裁片坐标系，y 向上）：缝份按外接框四边各放 s
    const netHalf = info.edgeMm / 2
    const marks: PanelMark[] = [
      { x: r1(cutW / 2 - netHalf), y: r1(s), label: '净样顶点 A' },
      { x: r1(cutW / 2 + netHalf), y: r1(s), label: '净样顶点 B' },
      { x: r1(cutW / 2), y: r1(s + h), label: '净样顶点 C' },
      { x: r1(cutW / 2), y: 0, label: '裁片下沿中点' }
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
      marksMm: trapezoidMarks(cutW, cutH, rawTop, rawBottom, rawH, s, `${i + 1}层`),
      qty: isPolygon ? g.n : divisions,
      layerIndex: i,
      color,
      note: isPolygon
        ? `上下边各加 ${s}mm 缝份，${g.n} 块围成一圈`
        : `按 ${divisions} 等分近似展开，每块上下边各加 ${s}mm 缝份`
    })
  })

  // 顶盖 / 底盖
  const topR = g.sections[g.sections.length - 1].radiusMm
  const botR = g.sections[0].radiusMm
  const coverPanel = (r: number, label: string, tag: string, color: string) => {
    if (g.polygon) {
      // 盖片按「对边距」给净尺寸（apothem×2 = 2Rcos(π/n)），
      // 裁切对边距 = 净对边距 + 2×缝份：六条边的缝份等宽，六个角对位标记正对每条棱。
      // 角部会多出一圈料（外接圆方向），备料按裁切面积如实计入。
      const n = g.n
      const rawAcross = 2 * r * Math.cos(Math.PI / n)
      const cutAcross = r1(rawAcross + 2 * s)
      const half = cutAcross / 2
      const cutCircumR = half / Math.cos(Math.PI / n)
      // 六个角（顶点）的对位标记：每个角与一条棱（相邻两片侧面的竖棱）对正
      const cornerMarks: PanelMark[] = Array.from({ length: n }, (_, k) => {
        const a = -Math.PI / 2 + (TAU * k) / n
        return {
          x: r1(half + cutCircumR * Math.cos(a)),
          y: r1(half + cutCircumR * Math.sin(a)),
          label: `${tag} 角 ${k + 1}（对第 ${k + 1} 条棱）`
        }
      })
      // 六条边中点：缝份折线中点，与侧面竖缝/棱间中点对齐
      const edgeMarks: PanelMark[] = Array.from({ length: n }, (_, k) => {
        const a = -Math.PI / 2 + (TAU * (k + 0.5)) / n
        return {
          x: r1(half + half * Math.cos(a)),
          y: r1(half + half * Math.sin(a)),
          label: `${tag} 边 ${k + 1} 中（净样折点）`
        }
      })
      const marks: PanelMark[] = [
        { x: r1(half), y: r1(half), label: `${tag} 中心` },
        ...cornerMarks,
        ...edgeMarks
      ]
      push({
        shape: 'circle',
        label,
        rawWidthTopMm: r1(rawAcross),
        rawWidthBottomMm: r1(rawAcross),
        rawHeightMm: r1(rawAcross),
        widthTopMm: cutAcross,
        widthBottomMm: cutAcross,
        heightMm: cutAcross,
        seamAllowanceMm: s,
        marksMm: marks,
        qty: 1,
        radiusMm: r1(r),
        polySides: n,
        layerIndex: -1,
        color,
        note: `正 ${n} 边形裁片，净对边距 ${r1(rawAcross)}mm，按对边距四边各放 ${s}mm 缝份（裁切对边距 ${cutAcross}mm；角部多出的料已计入备料）`
      })
    } else {
      const cutD = r1(2 * r + 2 * s)
      const marks: PanelMark[] = [
        { x: r1(cutD / 2), y: r1(cutD / 2), label: `${tag} 中心` },
        { x: r1(cutD / 2), y: 0, label: `${tag} 0°` },
        { x: r1(cutD / 2), y: r1(cutD), label: `${tag} 180°` },
        { x: 0, y: r1(cutD / 2), label: `${tag} 270°` },
        { x: r1(cutD), y: r1(cutD / 2), label: `${tag} 90°` }
      ]
      push({
        shape: 'circle',
        label,
        rawWidthTopMm: r1(2 * r),
        rawWidthBottomMm: r1(2 * r),
        rawHeightMm: r1(2 * r),
        widthTopMm: cutD,
        widthBottomMm: cutD,
        heightMm: cutD,
        seamAllowanceMm: s,
        marksMm: marks,
        qty: 1,
        radiusMm: r1(r),
        layerIndex: -1,
        color,
        note: `圆形裁片，净直径 ${r1(2 * r)}mm，四周各放 ${s}mm 缝份，裁切直径 ${cutD}mm`
      })
    }
  }
  coverPanel(topR, g.polygon ? '顶盖片' : '顶盖圆片', '顶盖', l.layerColors[l.layerColors.length - 1] || l.color)
  coverPanel(botR, g.polygon ? '底盖片' : '底盖圆片', '底盘', l.layerColors[0] || l.color)

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
