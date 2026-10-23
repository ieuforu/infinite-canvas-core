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
const selectedShapes = new Set<Shape>() // 支持批量多选
let showDebugTree = false

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

// 标准化任意两点构成的矩形 (处理反向拖拽)
function normalizeRect(x1: number, y1: number, x2: number, y2: number): Rect {
  return {
    x: Math.min(x1, x2),
    y: Math.min(y1, y2),
    w: Math.abs(x1 - x2),
    h: Math.abs(y1 - y2),
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

// 4. 渲染主循环
let renderedCount = 0
let queryTimeMs = 0
let lastFpsTime = performance.now()
let frameCount = 0
let fps = 0
const visibleShapesBuffer: Shape[] = []

// 橡皮筋选框 (屏幕坐标)
interface SelectionBox {
  startX: number
  startY: number
  currentX: number
  currentY: number
}
let selectionBox: SelectionBox | null = null

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

    // 悬停未选中的图元绘制白色弱外框
    if (hoveredShape && hoveredShape.id === shape.id && !selectedShapes.has(shape)) {
      ctx.lineWidth = 2 / viewport.scale
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)'
      ctx.strokeRect(shape.x, shape.y, shape.w, shape.h)
    }
  }

  // 绘制所有被选中的图元外轮廓与角标
  for (const selected of selectedShapes) {
    ctx.lineWidth = 2 / viewport.scale
    ctx.strokeStyle = '#38bdf8' // 天蓝高亮
    ctx.strokeRect(selected.x - 2, selected.y - 2, selected.w + 4, selected.h + 4)

    const handleSize = 5 / viewport.scale
    ctx.fillStyle = '#ffffff'
    const corners = [
      { x: selected.x - 2, y: selected.y - 2 },
      { x: selected.x + selected.w + 2, y: selected.y - 2 },
      { x: selected.x - 2, y: selected.y + selected.h + 2 },
      { x: selected.x + selected.w + 2, y: selected.y + selected.h + 2 },
    ]
    for (const c of corners) {
      ctx.fillRect(c.x - handleSize / 2, c.y - handleSize / 2, handleSize, handleSize)
    }
  }

  ctx.restore()

  // 在屏幕最顶层直接绘制橡皮筋框选框 (避免受缩放比例影响线宽)
  if (selectionBox) {
    drawMarqueeBox(selectionBox)
  }

  drawHUD()
}

// 5. 绘制屏幕坐标系下的框选指示器
function drawMarqueeBox(box: SelectionBox) {
  const dpr = window.devicePixelRatio || 1
  const rect = normalizeRect(box.startX, box.startY, box.currentX, box.currentY)

  ctx.save()
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.scale(dpr, dpr)

  ctx.fillStyle = 'rgba(56, 189, 248, 0.15)'
  ctx.fillRect(rect.x, rect.y, rect.w, rect.h)

  ctx.lineWidth = 1
  ctx.setLineDash([4, 4])
  ctx.strokeStyle = '#38bdf8'
  ctx.strokeRect(rect.x, rect.y, rect.w, rect.h)

  ctx.restore()
}

// 6. 自适应网格
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

// 7. HUD 状态面板
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
  ctx.fillText(`Selected Shapes: ${selectedShapes.size}`, 30, 120)
  ctx.fillText(`Hovered ID: ${hoveredShape ? hoveredShape.id : 'None'}`, 30, 140)
  ctx.fillText(`[Shift+Drag] Marquee Select`, 30, 160)

  ctx.restore()
}

// 8. 交互核心：分流 (平移 / 拖动图元 / 框选)
type DragMode = 'NONE' | 'PAN_VIEWPORT' | 'DRAG_SHAPES' | 'MARQUEE_SELECT'
let dragMode: DragMode = 'NONE'
let lastPointer = { x: 0, y: 0 }
let activeDragShape: Shape | null = null
let shapeDragOffset = { x: 0, y: 0 }

window.addEventListener('pointerdown', (e) => {
  if (e.button !== 0 && e.button !== 1) return

  const worldPos = screenToWorld(e.clientX, e.clientY)
  const hit = quadTree.hitTest(worldPos.x, worldPos.y)

  if (e.shiftKey) {
    // 按住 Shift 强制进入框选模式
    dragMode = 'MARQUEE_SELECT'
    selectionBox = {
      startX: e.clientX,
      startY: e.clientY,
      currentX: e.clientX,
      currentY: e.clientY,
    }
    canvas.style.cursor = 'crosshair'
  } else if (hit) {
    // 命中图元
    dragMode = 'DRAG_SHAPES'
    activeDragShape = hit

    // 如果点的图元不在当前已选集合内，则单选该图元
    if (!selectedShapes.has(hit)) {
      selectedShapes.clear()
      selectedShapes.add(hit)
    }

    shapeDragOffset = {
      x: worldPos.x - hit.x,
      y: worldPos.y - hit.y,
    }
    canvas.style.cursor = 'move'
  } else {
    // 空白处拖拽：平移画布，并清空多选
    dragMode = 'PAN_VIEWPORT'
    selectedShapes.clear()
    canvas.style.cursor = 'grabbing'
  }

  lastPointer = { x: e.clientX, y: e.clientY }
  requestRender()
})

window.addEventListener('pointermove', (e) => {
  if (dragMode === 'PAN_VIEWPORT') {
    viewport.x += e.clientX - lastPointer.x
    viewport.y += e.clientY - lastPointer.y
    lastPointer = { x: e.clientX, y: e.clientY }
    requestRender()
  } else if (dragMode === 'DRAG_SHAPES' && activeDragShape) {
    // 批量平移选中的所有图元
    const currentWorld = screenToWorld(e.clientX, e.clientY)
    const deltaX = currentWorld.x - shapeDragOffset.x - activeDragShape.x
    const deltaY = currentWorld.y - shapeDragOffset.y - activeDragShape.y

    if (deltaX !== 0 || deltaY !== 0) {
      for (const shape of selectedShapes) {
        quadTree.remove(shape)
        shape.x += deltaX
        shape.y += deltaY
        quadTree.insert(shape)
      }
    }

    requestRender()
  } else if (dragMode === 'MARQUEE_SELECT' && selectionBox) {
    // 更新框选终点
    selectionBox.currentX = e.clientX
    selectionBox.currentY = e.clientY

    // 计算框选区域对应的世界坐标矩形
    const p1 = screenToWorld(selectionBox.startX, selectionBox.startY)
    const p2 = screenToWorld(selectionBox.currentX, selectionBox.currentY)
    const worldSelectRect = normalizeRect(p1.x, p1.y, p2.x, p2.y)

    // 用四叉树极速范围相交检索
    selectedShapes.clear()
    const hitResults: Shape[] = []
    quadTree.queryRange(worldSelectRect, hitResults)

    for (const s of hitResults) {
      selectedShapes.add(s)
    }

    requestRender()
  } else {
    // 悬停检测
    const worldPos = screenToWorld(e.clientX, e.clientY)
    const hit = quadTree.hitTest(worldPos.x, worldPos.y)

    if (hit !== hoveredShape) {
      hoveredShape = hit
      canvas.style.cursor = e.shiftKey ? 'crosshair' : hit ? 'pointer' : 'default'
      requestRender()
    }
  }
})

window.addEventListener('pointerup', () => {
  dragMode = 'NONE'
  activeDragShape = null
  selectionBox = null
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
  if (e.key === 'Shift') {
    canvas.style.cursor = 'crosshair'
  }
})

window.addEventListener('keyup', (e) => {
  if (e.key === 'Shift') {
    canvas.style.cursor = hoveredShape ? 'pointer' : 'default'
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
