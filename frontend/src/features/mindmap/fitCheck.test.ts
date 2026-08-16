import { describe, expect, it } from 'vitest'
import { contentExceedsViewport } from './fitCheck'

describe('自适应缩放判定（v1.1 P1）', () => {
  // 视口 1000×600、zoom=1、viewport {x:0,y:0} → 可见区 left=0 top=0 w=1000 h=600；pad=80/48
  const vp = { x: 0, y: 0, zoom: 1 }

  it('内容完全在视口内：不触发适应', () => {
    expect(
      contentExceedsViewport({ minX: 100, minY: 100, maxX: 900, maxY: 500 }, vp, 1000, 600),
    ).toBe(false)
  })

  it('内容在边距内：不触发适应（不打扰正常编辑视野）', () => {
    expect(
      contentExceedsViewport({ minX: -70, minY: -40, maxX: 1070, maxY: 640 }, vp, 1000, 600),
    ).toBe(false) // -70 > -80、1070 < 1080
  })

  it('右侧超出边距：触发适应', () => {
    expect(
      contentExceedsViewport({ minX: -70, minY: -40, maxX: 1100, maxY: 640 }, vp, 1000, 600),
    ).toBe(true) // 1100 > 1080
  })

  it('下侧超出边距：触发适应', () => {
    expect(
      contentExceedsViewport({ minX: -70, minY: -40, maxX: 1070, maxY: 700 }, vp, 1000, 600),
    ).toBe(true) // 700 > 648
  })

  it('左侧/上侧超出边距：触发适应', () => {
    expect(
      contentExceedsViewport({ minX: -200, minY: -40, maxX: 900, maxY: 500 }, vp, 1000, 600),
    ).toBe(true)
    expect(
      contentExceedsViewport({ minX: -70, minY: -300, maxX: 900, maxY: 500 }, vp, 1000, 600),
    ).toBe(true)
  })

  it('缩小视图（zoom<1）时可见区按 zoom 放大：原内容不触发', () => {
    // zoom=0.5 → 可见区 w=2000 h=1200，内容 100..900 完全在内
    expect(
      contentExceedsViewport({ minX: 100, minY: 100, maxX: 900, maxY: 500 }, { x: 0, y: 0, zoom: 0.5 }, 1000, 600),
    ).toBe(false)
  })

  it('平移后可见区偏移：超出判定随 viewport 变化', () => {
    // viewport.x=300 → 可见区 left=-300 right=700（pad 后 -380..780），内容 0..600 完全可见
    expect(
      contentExceedsViewport({ minX: 0, minY: 100, maxX: 600, maxY: 500 }, { x: 300, y: 0, zoom: 1 }, 1000, 600),
    ).toBe(false)
    // 同视口下内容延展到 900：超过可见区右侧 → 触发
    expect(
      contentExceedsViewport({ minX: 0, minY: 100, maxX: 900, maxY: 500 }, { x: 300, y: 0, zoom: 1 }, 1000, 600),
    ).toBe(true)
    // viewport.x=-1500 → 可见区 left=1500，内容整体在视野外
    expect(
      contentExceedsViewport({ minX: 100, minY: 100, maxX: 900, maxY: 500 }, { x: -1500, y: 0, zoom: 1 }, 1000, 600),
    ).toBe(true)
  })

  it('zoom 为 0 或负数时按 1 兜底（防御）', () => {
    expect(
      contentExceedsViewport({ minX: 100, minY: 100, maxX: 900, maxY: 500 }, { x: 0, y: 0, zoom: 0 }, 1000, 600),
    ).toBe(false)
  })

  it('自定义边距比例生效', () => {
    // padRatio=0.2 → 右侧边距 200：1070 不触发（<1200）
    expect(
      contentExceedsViewport({ minX: -70, minY: -40, maxX: 1070, maxY: 640 }, vp, 1000, 600, 0.2),
    ).toBe(false)
    // padRatio=0.05 → 右侧边距 50：1070 触发（>1050）
    expect(
      contentExceedsViewport({ minX: -70, minY: -40, maxX: 1070, maxY: 640 }, vp, 1000, 600, 0.05),
    ).toBe(true)
  })
})
