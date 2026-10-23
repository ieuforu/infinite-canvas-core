import { QuadTree, type Shape, type Rect } from './quadtree'

const canvas = document.getElementById('canvas') as HTMLCanvasElement
const ctx = canvas.getContext('2d')!

// 视口状态
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

// 1. 初始化空间
const WORLD_SIZE = 12_000
const quadTree = new QuadTree(
  { x: -WORLD_SIZE / 2, y: -WORLD_SIZE / 2, w: WORLD_SIZE, h: WORLD_SIZE },
  24,
  8,
)

const TOTAL_SHAPES = 10_000
let hoveredShape: Shape | null = null
let selectedShape: Shape | null = null
let showDebugTree = false // 默认关闭调试线以换取极致帧率

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

// 2. 坐标转换工具
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

// 3. 调度机制
let isPendingFrame = false
function requestRender() {
  if (isPendingFrame) return
  isPendingFrame = true
  requestAnimationFrame(() => {
    render()
    isPendingFrame = false
  })
}

// 4. 渲染主循环
let renderedCount = 0
let queryTimeMs = 0
let lastFpsTime = performance.now()
let frameCount = 0
let fps = 0
const visibleShapesBuffer: Shape[] = []

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

  visibleShapesBuffer.length = 0
  const t0 = performance.now()
  quadTree.queryRange(viewBounds, visibleShapesBuffer)
  queryTimeMs = performance.now() - t0

  ctx.save()
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.clearRect(0, 0, canvas.width, canvas.height)

  ctx.scale(dpr, dpr)
  ctx.translate(viewport.x, viewport.y)
  ctx.scale(viewport.scale, viewport.scale)

  drawAdaptiveGrid()

  if (showDebugTree) {
    quadTree.drawDebug(ctx, viewBounds, viewport.scale)
  }

  // 绘制可见图元
  renderedCount = 0
  for (let i = 0; i < visibleShapesBuffer.length; i++) {
    const shape = visibleShapesBuffer[i]

    if (shape.w * viewport.scale < 0.5 || shape.h * viewport.scale < 0.5) {
      continue
    }

    renderedCount++
    ctx.fillStyle = shape.color
    ctx.fillRect(shape.x, shape.y, shape.w, shape.h)

    // 悬停态外框
    if (hoveredShape && hoveredShape.id === shape.id && selectedShape?.id !== shape.id) {
      ctx.lineWidth = 2 / viewport.scale
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)'
      ctx.strokeRect(shape.x, shape.y, shape.w, shape.h)
    }
  }

  // 绘制选中态外框（常驻显示在最顶层）
  if (selectedShape) {
    ctx.lineWidth = 2 / viewport.scale
    ctx.strokeStyle = '#38bdf8' // 高亮天蓝
    ctx.strokeRect(
      selectedShape.x - 2,
      selectedShape.y - 2,
      selectedShape.w + 4,
      selectedShape.h + 4,
    )

    // 绘制四个角控制手柄
    const handleSize = 6 / viewport.scale
    ctx.fillStyle = '#ffffff'
    const corners = [
      { x: selectedShape.x - 2, y: selectedShape.y - 2 },
      { x: selectedShape.x + selectedShape.w + 2, y: selectedShape.y - 2 },
      { x: selectedShape.x - 2, y: selectedShape.y + selectedShape.h + 2 },
      { x: selectedShape.x + selectedShape.w + 2, y: selectedShape.y + selectedShape.h + 2 },
    ]
    for (const c of corners) {
      ctx.fillRect(c.x - handleSize / 2, c.y - handleSize / 2, handleSize, handleSize)
    }
  }

  ctx.restore()
  drawHUD()
}

// 5. 自适应网格
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

  ctx.lineWidth = 2 / viewport.scale
  ctx.strokeStyle = 'rgba(239, 68, 68, 0.8)'
  ctx.beginPath()
  ctx.moveTo(Math.max(-100, bounds.x), 0)
  ctx.lineTo(Math.min(100, bounds.x + bounds.w), 0)
  ctx.moveTo(0, Math.max(-100, bounds.y))
  ctx.lineTo(0, Math.min(100, bounds.y + bounds.h))
  ctx.stroke()
}

// 6. HUD 面板
function drawHUD() {
  ctx.save()
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.scale(window.devicePixelRatio || 1, window.devicePixelRatio || 1)

  ctx.fillStyle = 'rgba(0, 0, 0, 0.8)'
  ctx.fillRect(16, 16, 280, 155)
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)'
  ctx.strokeRect(16, 16, 280, 155)

  ctx.fillStyle = '#00ffcc'
  ctx.font = '13px ui-monospace, SFMono-Regular, Menlo, monospace'
  ctx.fillText(`FPS: ${fps}`, 30, 40)
  ctx.fillText(`Total Shapes: ${TOTAL_SHAPES.toLocaleString()}`, 30, 60)
  ctx.fillText(`QuadTree Query: ${queryTimeMs.toFixed(3)} ms`, 30, 80)
  ctx.fillText(`Rendered / Visible: ${renderedCount.toLocaleString()}`, 30, 100)
  ctx.fillText(`Selected ID: ${selectedShape ? selectedShape.id : 'None'}`, 30, 120)
  ctx.fillText(`Hovered ID: ${hoveredShape ? hoveredShape.id : 'None'}`, 30, 140)
  ctx.fillText(`[D] Debug: ${showDebugTree ? 'ON' : 'OFF'}`, 30, 160)

  ctx.restore()
}

// 7. 交互核心：区分画布拖拽与图元拖拽
type DragMode = 'NONE' | 'PAN_VIEWPORT' | 'DRAG_SHAPE'
let dragMode: DragMode = 'NONE'
let lastPointer = { x: 0, y: 0 }
let shapeDragOffset = { x: 0, y: 0 } // 记录鼠标点击点相对图元左上角的偏移量

window.addEventListener('pointerdown', (e) => {
  if (e.button !== 0 && e.button !== 1) return

  const worldPos = screenToWorld(e.clientX, e.clientY)
  const hit = quadTree.hitTest(worldPos.x, worldPos.y)

  if (hit) {
    // 命中图元：进入图元拖拽模式
    dragMode = 'DRAG_SHAPE'
    selectedShape = hit
    shapeDragOffset = {
      x: worldPos.x - hit.x,
      y: worldPos.y - hit.y,
    }
    canvas.style.cursor = 'move'
  } else {
    // 点击空白处：取消选中，进入视口拖拽模式
    dragMode = 'PAN_VIEWPORT'
    selectedShape = null
    canvas.style.cursor = 'grabbing'
  }

  lastPointer = { x: e.clientX, y: e.clientY }
  requestRender()
})

window.addEventListener('pointermove', (e) => {
  if (dragMode === 'PAN_VIEWPORT') {
    // 1. 平移画布
    viewport.x += e.clientX - lastPointer.x
    viewport.y += e.clientY - lastPointer.y
    lastPointer = { x: e.clientX, y: e.clientY }
    requestRender()
  } else if (dragMode === 'DRAG_SHAPE' && selectedShape) {
    // 2. 拖拽图元并动态更新四叉树
    const currentWorld = screenToWorld(e.clientX, e.clientY)
    const targetX = currentWorld.x - shapeDragOffset.x
    const targetY = currentWorld.y - shapeDragOffset.y

    // 关键操作：在修改坐标之前，先将其从旧象限中彻底抹除
    quadTree.remove(selectedShape)

    // 更新世界坐标
    selectedShape.x = targetX
    selectedShape.y = targetY

    // 重新插入四叉树，触发跨象限重平衡
    quadTree.insert(selectedShape)

    requestRender()
  } else {
    // 3. 静止移动鼠标：常规悬停拾取
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
  dragMode = 'NONE'
  canvas.style.cursor = hoveredShape ? 'pointer' : 'default'
  requestRender()
})

// 缩放
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

// 快捷键
window.addEventListener('keydown', (e) => {
  if (e.key === 'd' || e.key === 'D') {
    showDebugTree = !showDebugTree
    requestRender()
  }
})

function resize() {
  const dpr = window.devicePixelRatio || 1
  canvas.width = Math.floor(window.innerWidth * dpr)
  canvas.height = Math.floor(window.innerHeight * dpr)
  canvas.style.width = `${window.innerWidth}px`
  canvas.style.height = `${window.innerHeight}px`
  requestRender()
}
window.addEventListener('resize', resize)

resize()
