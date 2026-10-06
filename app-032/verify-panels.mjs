/**
 * 裁片一致性核对脚本（临时工具，随改随跑）
 * 用法: node verify-panels.mjs
 * 模拟四处页面对同一块裁片的取数路径：裁片页两行尺寸、裁片图净样线、材料页用量、1:1 图纸。
 */
import { build } from 'esbuild'
import { writeFileSync } from 'node:fs'

writeFileSync('/tmp/verify-entry.ts', `
export { buildPanels, panelNetArea, panelCutArea, panelNetPoints } from '/workspace/app-032/src/core/panels'
export { computeAll } from '/workspace/app-032/src/core/checks'
export { DEFAULT_LOFT_OPTIONS } from '/workspace/app-032/src/core/paginate'
`)
const out = await build({
  entryPoints: ['/tmp/verify-entry.ts'],
  bundle: true,
  format: 'esm',
  write: false,
  platform: 'node',
  loader: { '.json': 'json' }
})
writeFileSync('/tmp/core-bundle.mjs', out.outputFiles[0].text)
const core = await import('/tmp/core-bundle.mjs')

const { buildPanels, panelNetArea, panelCutArea, panelNetPoints, computeAll, DEFAULT_LOFT_OPTIONS } = core

// 六角宫灯预设（prism, n=6）+ 圆形灯笼（revolution）
const base = {
  id: 'T1', kind: 'prism', name: '六角宫灯', maxDiameterMm: 320, totalHeightMm: 420,
  mouthDiameterMm: 140, baseDiameterMm: 140, sides: 6,
  layers: [
    { heightMm: 105, diameterMm: 0 }, { heightMm: 105, diameterMm: 0 },
    { heightMm: 105, diameterMm: 0 }, { heightMm: 105, diameterMm: 0 }
  ],
  mouthStyle: 'taper', bottomStyle: 'taper', smoothness: 0.45,
  ctrl1: { x: 0.12, y: 0.3 }, ctrl2: { x: 0.85, y: 0.78 },
  divisions: 24, covering: 'silk', seamAllowanceMm: 10, lashAllowanceMm: 20,
  layerColors: ['#b3241f', '#c8452c', '#c8452c', '#b3241f'], color: '#b3241f',
  batchCount: 20, wasteRatio: 0.1, pageSize: 'A4', overlapMm: 10,
  createdAt: '', updatedAt: ''
}
const round = { ...base, id: 'T2', kind: 'revolution', name: '圆形灯笼', sides: 8,
  maxDiameterMm: 300, totalHeightMm: 300, mouthDiameterMm: 90, baseDiameterMm: 90,
  layers: [{ heightMm: 100, diameterMm: 0 }, { heightMm: 100, diameterMm: 0 }, { heightMm: 100, diameterMm: 0 }],
  divisions: 24, covering: 'xuan', layerColors: ['#d94a2a'], color: '#d94a2a' }

let failures = 0
const ok = (cond, msg) => {
  console.log(`${cond ? '  ✓' : '  ✗ FAIL'} ${msg}`)
  if (!cond) failures++
}

for (const [name, l0] of [['六角宫灯', base], ['圆形灯笼', round]]) {
  for (const seam of [10, 20, 0]) {
    const l = { ...l0, seamAllowanceMm: seam }
    const res = buildPanels(l)
    console.log(`\n== ${name} · 缝份 ${seam}mm ==`)
    for (const p of res.panels) {
      const s = seam
      const tol = 0.06
      const dW = p.widthTopMm - p.rawWidthTopMm
      const dB = p.widthBottomMm - p.rawWidthBottomMm
      const dH = p.heightMm - p.rawHeightMm
      ok(Math.abs(dW - 2 * s) <= tol && Math.abs(dB - 2 * s) <= tol && Math.abs(dH - 2 * s) <= tol,
        `${p.label}: 裁切-净 = ${dW.toFixed(1)}/${dB.toFixed(1)}/${dH.toFixed(1)}（应 ${2 * s}）`)
      const net = panelNetArea(p)
      const cut = panelCutArea(p)
      ok(s === 0 ? net === cut : cut > net, `${p.label}: 净面积 ${net.toFixed(1)}mm² ${s === 0 ? '===' : '<'} 裁切面积 ${cut.toFixed(1)}mm²`)
      if (p.polySides) {
        const r = p.radiusMm
        const expectAF = Math.round(2 * r * Math.cos(Math.PI / p.polySides))
        ok(Math.abs(p.rawWidthTopMm - expectAF) <= 0.06,
          `${p.label}: 净对边距 ${p.rawWidthTopMm}（外接圆 ${2 * r} 换算应 ${expectAF}）`)
        ok(p.marksMm.length === p.polySides + 1, `${p.label}: 对位标记 ${p.marksMm.length} 处（应 ${p.polySides} 角 + 中心）`)
      }
    }
    // 材料页用量 == 裁片含缝份面积（同源）
    const full = computeAll(l, { ...DEFAULT_LOFT_OPTIONS, paper: 'A4', overlapMm: 10 })
    ok(Math.abs(full.materials.coveringM2 - res.cutAreaMm2 / 1e6) <= 0.0011,
      `材料页蒙面用量 ${full.materials.coveringM2}m² == 含缝份裁片面积 ${(res.cutAreaMm2 / 1e6).toFixed(3)}m²`)
    ok(Math.abs(full.materials.coveringNetM2 - res.netAreaMm2 / 1e6) <= 0.0011,
      `材料页净面积 ${full.materials.coveringNetM2}m² == 裁片净面积 ${(res.netAreaMm2 / 1e6).toFixed(3)}m²`)
    ok(res.netAreaMm2 !== res.cutAreaMm2 || seam === 0,
      `净面积(${(res.netAreaMm2 / 1e6).toFixed(3)}) 与含缝份面积(${(res.cutAreaMm2 / 1e6).toFixed(3)}) ${seam === 0 ? '缝份为 0 应相等' : '不得写成同一个数'}`)
    const bad = full.checks.filter((c) => !c.pass)
    ok(bad.length === 0, `自检全部通过${bad.length ? '（未过: ' + bad.map((c) => c.id).join(',') + '）' : ''}`)
  }
}

// 裁片图净样线必须跟着缝份走（同一裁片，缝份 10 vs 20，净样点不能相同）
if (panelNetPoints) {
  const l10 = buildPanels({ ...base, seamAllowanceMm: 10 }).panels[0]
  const l20 = buildPanels({ ...base, seamAllowanceMm: 20 }).panels[0]
  console.log('\n== 裁片图净样线跟随缝份 ==')
  ok(panelNetPoints(l10) !== panelNetPoints(l20), '缝份 10 与 20 的净样线不同')
  ok(!panelNetPoints(l10).includes('5,5 '), '净样线不是固定内缩 5mm 的矩形')
} else {
  console.log('\n（panelNetPoints 尚未导出——裁片图净样线仍为组件内硬编码）')
  failures++
}

console.log(`\n${failures === 0 ? '全部通过' : `共 ${failures} 项未过`}`)
process.exit(failures === 0 ? 0 : 1)
