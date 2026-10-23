import { QuadTree, type Shape, type Rect } from './quadtree'

const canvas = document.getElementById('canvas') as HTMLCanvasElement
const ctx = canvas.getContext('2d')!

// 视口相机状态
interface Viewport {
  x: number
  y: number
  scale: number
}

const viewport: Viewport = {
  x: window.innerWidth / 2,
  y: window.innerHeight / 2,
  scale: 1,
}

// 1. 初始化世界边界与四叉树 (空间范围 [-6000, -6000] 至 [6000, 6000])
const WORLD_SIZE = 12_000
const quadTree = new QuadTree(
  { x: -WORLD_SIZE / 2, y: -WORLD_SIZE / 2, w: WORLD_SIZE, h: WORLD_SIZE },
  24, // 单节点图元上限，超过则分裂
  8, // 最大细分深度
)

const TOTAL_SHAPES = 10_000
let hoveredShape: Shape | null = null
let showDebugTree = true

function populateShapes() {
  const colors = [
    '#ef4444',
    '#f97316',
    '#eab308',
    '#10b981',
    '#06b6d4',
    '#3b82f6',
    '#8b5cf6',
    '#ec4899',
  ]
  const range = 10_000

  for (let i = 0; i < TOTAL_SHAPES; i++) {
    const w = 20 + Math.random() * 80
    const h = 20 + Math.random() * 80
    const shape: Shape = {
      id: i,
      x: (Math.random() - 0.5) * range,
      y: (Math.random() - 0.5) * range,
      w,
      h,
      color: colors[Math.floor(Math.random() * colors.length)],
    }
    quadTree.insert(shape)
  }
}
populateShapes()

// 2. 坐标转换与边界计算
function screenToWorld(sx: number, sy: number) {
  return {
    x: (sx - viewport.x) / viewport.scale,
    y: (sy - viewport.y) / viewport.scale,
  }
}

function getVisibleWorldBounds(): Rect {
  return {
    x: -viewport.x / viewport.scale,
    y: -viewport.y / viewport.scale,
    w: window.innerWidth / viewport.scale,
    h: window.innerHeight / viewport.scale,
  }
}

// 3. rAF 脏标记调度
let isPendingFrame = false
function requestRender() {
  if (isPendingFrame) return
  isPendingFrame = true
  requestAnimationFrame(() => {
    render()
    isPendingFrame = false
  })
}

// 4. 渲染度量指标
let renderedCount = 0
let queryTimeMs = 0
let lastFpsTime = performance.now()
let frameCount = 0
let fps = 0

// 查询复用数组，消除 GC 压力
const visibleShapesBuffer: Shape[] = []

// 5. 渲染主循环
function render() {
  frameCount++
  const now = performance.now()
  if (now - lastFpsTime >= 500) {
    fps = Math.round((frameCount * 1000) / (now - lastFpsTime))
    frameCount = 0
    lastFpsTime = now
  }

  const dpr = window.devicePixelRatio || 1
  const viewBounds = getVisibleWorldBounds()

  // 四叉树空间范围检索
  visibleShapesBuffer.length = 0
  const t0 = performance.now()
  quadTree.queryRange(viewBounds, visibleShapesBuffer)
  queryTimeMs = performance.now() - t0

  ctx.save()
  // 重置矩阵并清屏
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.clearRect(0, 0, canvas.width, canvas.height)

  // 流水线变换：DPR 缩放 -> 相机平移 -> 相机缩放
  ctx.scale(dpr, dpr)
  ctx.translate(viewport.x, viewport.y)
  ctx.scale(viewport.scale, viewport.scale)

  // 绘制动态网格
  drawAdaptiveGrid()

  // 绘制四叉树象限分割边界
  if (showDebugTree) {
    quadTree.drawDebug(ctx, viewBounds, viewport.scale)
  }

  // 绘制可见图元
  renderedCount = 0
  for (let i = 0; i < visibleShapesBuffer.length; i++) {
    const shape = visibleShapesBuffer[i]

    // 剔除小于半像素的杂点
    if (shape.w * viewport.scale < 0.5 || shape.h * viewport.scale < 0.5) {
      continue
    }

    renderedCount++
    ctx.fillStyle = shape.color
    ctx.fillRect(shape.x, shape.y, shape.w, shape.h)

    // 悬停高亮外轮廓
    if (hoveredShape && hoveredShape.id === shape.id) {
      ctx.lineWidth = 3 / viewport.scale
      ctx.strokeStyle = '#ffffff'
      ctx.strokeRect(shape.x - 2, shape.y - 2, shape.w + 4, shape.h + 4)
    }
  }

  ctx.restore()

  // 绘制固定 HUD
  drawHUD()
}

// 6. 自适应 LOD 网格
function drawAdaptiveGrid() {
  const bounds = getVisibleWorldBounds()
  const minScreenPx = 60
  let step = 100

  while (step * viewport.scale < minScreenPx) step *= 2
  while (step * viewport.scale > minScreenPx * 2) step /= 2

  const startX = Math.floor(bounds.x / step) * step
  const endX = Math.ceil((bounds.x + bounds.w) / step) * step
  const startY = Math.floor(bounds.y / step) * step
  const endY = Math.ceil((bounds.y + bounds.h) / step) * step

  ctx.lineWidth = 1 / viewport.scale
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)'
  ctx.beginPath()

  for (let x = startX; x <= endX; x += step) {
    ctx.moveTo(x, bounds.y)
    ctx.lineTo(x, bounds.y + bounds.h)
  }
  for (let y = startY; y <= endY; y += step) {
    ctx.moveTo(bounds.x, y)
    ctx.lineTo(bounds.x + bounds.w, y)
  }
  ctx.stroke()

  // 原点十字红轴
  ctx.lineWidth = 2 / viewport.scale
  ctx.strokeStyle = 'rgba(239, 68, 68, 0.8)'
  ctx.beginPath()
  ctx.moveTo(Math.max(-100, bounds.x), 0)
  ctx.lineTo(Math.min(100, bounds.x + bounds.w), 0)
  ctx.moveTo(0, Math.max(-100, bounds.y))
  ctx.lineTo(0, Math.min(100, bounds.y + bounds.h))
  ctx.stroke()
}

// 7. HUD 调试面板
function drawHUD() {
  ctx.save()
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.scale(window.devicePixelRatio || 1, window.devicePixelRatio || 1)

  ctx.fillStyle = 'rgba(0, 0, 0, 0.8)'
  ctx.fillRect(16, 16, 280, 150)
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)'
  ctx.strokeRect(16, 16, 280, 150)

  ctx.fillStyle = '#00ffcc'
  ctx.font = '13px ui-monospace, SFMono-Regular, Menlo, monospace'
  ctx.fillText(`FPS: ${fps}`, 30, 42)
  ctx.fillText(`Total Shapes: ${TOTAL_SHAPES.toLocaleString()}`, 30, 64)
  ctx.fillText(`QuadTree Query: ${queryTimeMs.toFixed(3)} ms`, 30, 86)
  ctx.fillText(`Rendered / Visible: ${renderedCount.toLocaleString()}`, 30, 108)
  ctx.fillText(`Hovered ID: ${hoveredShape ? hoveredShape.id : 'None'}`, 30, 130)

  ctx.fillStyle = showDebugTree ? '#00ffcc' : '#666666'
  ctx.fillText(`[D] Debug QuadTree: ${showDebugTree ? 'ON' : 'OFF'}`, 30, 152)

  ctx.restore()
}

// 8. 视口与分辨率适配
function resize() {
  const dpr = window.devicePixelRatio || 1
  canvas.width = Math.floor(window.innerWidth * dpr)
  canvas.height = Math.floor(window.innerHeight * dpr)
  canvas.style.width = `${window.innerWidth}px`
  canvas.style.height = `${window.innerHeight}px`
  requestRender()
}
window.addEventListener('resize', resize)

// 9. 输入交互处理
let isDragging = false
let lastPointer = { x: 0, y: 0 }

window.addEventListener('pointerdown', (e) => {
  if (e.button === 0 || e.button === 1) {
    isDragging = true
    lastPointer = { x: e.clientX, y: e.clientY }
  }
})

window.addEventListener('pointermove', (e) => {
  if (isDragging) {
    viewport.x += e.clientX - lastPointer.x
    viewport.y += e.clientY - lastPointer.y
    lastPointer = { x: e.clientX, y: e.clientY }
    requestRender()
  } else {
    // 鼠标悬停拾取
    const worldPos = screenToWorld(e.clientX, e.clientY)
    const hit = quadTree.hitTest(worldPos.x, worldPos.y)

    if (hit !== hoveredShape) {
      hoveredShape = hit
      canvas.style.cursor = hit ? 'pointer' : 'default'
      requestRender()
    }
  }
})

window.addEventListener('pointerup', () => {
  isDragging = false
})

window.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault()
    const zoomFactor = 1.08
    const isZoomIn = e.deltaY < 0
    const newScale = isZoomIn ? viewport.scale * zoomFactor : viewport.scale / zoomFactor
    const clampedScale = Math.min(Math.max(newScale, 0.02), 30)

    viewport.x = e.clientX - (e.clientX - viewport.x) * (clampedScale / viewport.scale)
    viewport.y = e.clientY - (e.clientY - viewport.y) * (clampedScale / viewport.scale)
    viewport.scale = clampedScale

    requestRender()
  },
  { passive: false },
)

// 快捷键监听
window.addEventListener('keydown', (e) => {
  if (e.key === 'd' || e.key === 'D') {
    showDebugTree = !showDebugTree
    requestRender()
  }
})

// 初始化启动
resize()
