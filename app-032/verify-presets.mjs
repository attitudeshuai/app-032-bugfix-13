/** 全预设扫一遍 computeAll：所有 CHK 必须通过；并抽查裁片图/1:1 图纸同源 */
import { build } from 'esbuild'
import { writeFileSync } from 'node:fs'

writeFileSync('/tmp/sweep-entry.ts', `
export { computeAll } from '/workspace/app-032/src/core/checks'
export { DEFAULT_LOFT_OPTIONS } from '/workspace/app-032/src/core/paginate'
export { panelCutPoints, panelNetPoints, panelCircle, panelCutBox, rimNetSizeMm } from '/workspace/app-032/src/core/panels'
export { PRESETS, CRAFT, coveringSpec } from '/workspace/app-032/src/core/craft'
`)
const out = await build({
  entryPoints: ['/tmp/sweep-entry.ts'],
  bundle: true, format: 'esm', write: false, platform: 'node', loader: { '.json': 'json' }
})
writeFileSync('/tmp/sweep-bundle.mjs', out.outputFiles[0].text)
const core = await import('/tmp/sweep-bundle.mjs')
const { computeAll, DEFAULT_LOFT_OPTIONS, panelCutPoints, panelNetPoints, panelCircle, panelCutBox, rimNetSizeMm, PRESETS, CRAFT, coveringSpec } = core

let failures = 0
const ok = (cond, msg) => { console.log(`${cond ? '  ✓' : '  ✗ FAIL'} ${msg}`); if (!cond) failures++ }

function mkLantern(preset) {
  const p = preset.params
  const count = Math.max(1, Math.round(p.layerCount))
  const each = p.totalHeightMm / count
  const layers = Array.from({ length: count }, () => ({ heightMm: Math.round(each * 10) / 10, diameterMm: 0 }))
  const sum = layers.reduce((s, x) => s + x.heightMm, 0)
  layers[layers.length - 1].heightMm = Math.round((layers[layers.length - 1].heightMm + (p.totalHeightMm - sum)) * 10) / 10
  return {
    id: 'X', kind: preset.kind, name: preset.name,
    maxDiameterMm: p.maxDiameterMm, totalHeightMm: p.totalHeightMm,
    mouthDiameterMm: p.mouthDiameterMm, baseDiameterMm: p.baseDiameterMm,
    sides: p.sides, layers, mouthStyle: p.mouthStyle, bottomStyle: p.bottomStyle,
    smoothness: p.smoothness, ctrl1: p.ctrl1 ? { ...p.ctrl1 } : { x: 0.12, y: 0.3 },
    ctrl2: p.ctrl2 ? { ...p.ctrl2 } : { x: 0.85, y: 0.78 },
    divisions: p.divisions ?? CRAFT.defaultDivisions, covering: p.covering,
    seamAllowanceMm: CRAFT.defaultSeamAllowanceMm, lashAllowanceMm: CRAFT.defaultLashAllowanceMm,
    layerColors: [...p.layerColors], color: p.color, batchCount: 20,
    wasteRatio: coveringSpec(p.covering).wasteRatio, pageSize: 'A4', overlapMm: 10,
    createdAt: '', updatedAt: ''
  }
}

for (const preset of PRESETS) {
  const l = mkLantern(preset)
  const full = computeAll(l, { ...DEFAULT_LOFT_OPTIONS, paper: 'A4', overlapMm: 10 })
  const bad = full.checks.filter((c) => !c.pass)
  console.log(`\n== ${preset.name}（${preset.kind}）==`)
  ok(bad.length === 0, `CHK-01~09 全部通过${bad.length ? '（未过: ' + bad.map((c) => `${c.id}:${c.value}`).join(' ') + '）' : ''}`)
  console.log(`  净面积 ${(full.panels.netAreaMm2 / 1e6).toFixed(3)}m² / 含缝份 ${(full.panels.cutAreaMm2 / 1e6).toFixed(3)}m² / 材料页 ${full.materials.coveringM2.toFixed(3)}m² / 表面积 ${full.materials.surfaceM2.toFixed(3)}m²`)
  // 裁片图与 1:1 图纸共用同一套点：抽查每块裁片两种取数一致
  for (const p of full.panels.panels) {
    const box = panelCutBox(p)
    const sameBox = box.wMm === Math.max(p.widthTopMm, p.widthBottomMm) && box.hMm === p.heightMm
    const ptsOk = typeof panelCutPoints(p) === 'string' && typeof panelNetPoints(p) === 'string'
    const circleOk = (p.shape === 'circle' && !p.polySides) ? !!panelCircle(p, true) && panelCircle(p, true).r === p.rawWidthTopMm / 2 : panelCircle(p, true) === null
    ok(sameBox && ptsOk && circleOk, `${p.label}：外接框/裁切线/净样线 同源一致`)
  }
  // 口沿净尺寸：打印页校验尺文字与裁片页净尺寸同一取整规则
  if (preset.kind !== 'polyhedron') {
    const g = full.frame.geometry
    const topCover = full.panels.panels.find((p) => p.layerIndex === -1)
    const rim = rimNetSizeMm(g.sections[g.sections.length - 1].radiusMm, g.polygon, g.n)
    ok(topCover && topCover.rawWidthTopMm === rim, `口沿净尺寸 ${rim}mm（毫米取整）与顶盖净尺寸 ${topCover?.rawWidthTopMm}mm 一致`)
  }
}
console.log(`\n${failures === 0 ? '全部通过' : `共 ${failures} 项未过`}`)
process.exit(failures ? 1 : 0)
