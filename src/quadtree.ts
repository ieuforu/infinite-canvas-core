export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export interface Shape extends Rect {
  id: number
  color: string
  _lastQueryId?: number // 零分配去重标记
}

// AABB 矩形相交判定
export function rectIntersects(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
}

// 点在矩形内判定
export function rectContainsPoint(r: Rect, px: number, py: number): boolean {
  return px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h
}

export class QuadTree {
  private shapes: Shape[] = []
  private children: QuadTree[] | null = null
  private static globalQueryId = 0 // 全局递增查询 ID

  constructor(
    public bounds: Rect,
    public capacity: number = 16,
    public maxDepth: number = 8,
    public depth: number = 0,
  ) {}

  // 插入图元
  insert(shape: Shape): boolean {
    if (!rectIntersects(this.bounds, shape)) {
      return false
    }

    // 若未满或已达最大深度，存入当前节点
    if (!this.children && (this.shapes.length < this.capacity || this.depth >= this.maxDepth)) {
      this.shapes.push(shape)
      return true
    }

    // 超过容量则分裂
    if (!this.children) {
      this.subdivide()
    }

    // 将已有图元向下转移
    if (this.shapes.length > 0) {
      for (const s of this.shapes) {
        for (const child of this.children!) {
          child.insert(s)
        }
      }
      this.shapes.length = 0
    }

    // 插入新图元至可能重叠的子象限
    let inserted = false
    for (const child of this.children!) {
      if (child.insert(shape)) {
        inserted = true
      }
    }
    return inserted
  }

  // 四叉分裂
  private subdivide() {
    const { x, y, w, h } = this.bounds
    const hw = w / 2
    const hh = h / 2
    const nextDepth = this.depth + 1

    this.children = [
      new QuadTree({ x, y, w: hw, h: hh }, this.capacity, this.maxDepth, nextDepth), // NW
      new QuadTree({ x: x + hw, y, w: hw, h: hh }, this.capacity, this.maxDepth, nextDepth), // NE
      new QuadTree({ x, y: y + hh, w: hw, h: hh }, this.capacity, this.maxDepth, nextDepth), // SW
      new QuadTree({ x: x + hw, y: y + hh, w: hw, h: hh }, this.capacity, this.maxDepth, nextDepth), // SE
    ]
  }

  // 1. 区域范围检索（替代视口线性遍历）
  queryRange(range: Rect, out: Shape[] = []): Shape[] {
    QuadTree.globalQueryId++
    this._queryRangeInternal(range, out, QuadTree.globalQueryId)
    return out
  }

  private _queryRangeInternal(range: Rect, out: Shape[], queryId: number) {
    // 整块象限与视口不相交，直接整枝剪掉
    if (!rectIntersects(this.bounds, range)) {
      return
    }

    for (let i = 0; i < this.shapes.length; i++) {
      const shape = this.shapes[i]
      if (shape._lastQueryId !== queryId) {
        shape._lastQueryId = queryId
        if (rectIntersects(shape, range)) {
          out.push(shape)
        }
      }
    }

    if (this.children) {
      for (let i = 0; i < 4; i++) {
        this.children[i]._queryRangeInternal(range, out, queryId)
      }
    }
  }

  // 2. 拾取命中测试（点查询）：直接下钻到对应叶节点
  hitTest(px: number, py: number): Shape | null {
    if (!rectContainsPoint(this.bounds, px, py)) {
      return null
    }

    // 优先深层优先检索子节点（最新图元在顶层）
    if (this.children) {
      for (let i = 3; i >= 0; i--) {
        const hit = this.children[i].hitTest(px, py)
        if (hit) return hit
      }
    }

    // 检查本节点内的图元（逆序检查，优先命中后绘制的图形）
    for (let i = this.shapes.length - 1; i >= 0; i--) {
      const shape = this.shapes[i]
      if (rectContainsPoint(shape, px, py)) {
        return shape
      }
    }

    return null
  }

  drawDebug(ctx: CanvasRenderingContext2D, viewBounds: Rect, scale: number) {
    // 视口外节点直接剪枝，不浪费绘制调用
    if (!rectIntersects(this.bounds, viewBounds)) {
      return
    }

    ctx.save()
    // 深度越深，线条越亮（0: 最外层较暗，8: 细分最深处最亮）
    const alpha = 0.15 + (this.depth / this.maxDepth) * 0.45
    ctx.strokeStyle = `rgba(0, 255, 180, ${alpha})`
    ctx.lineWidth = 1 / scale

    // 绘制当前象限的包围盒
    ctx.strokeRect(this.bounds.x, this.bounds.y, this.bounds.w, this.bounds.h)

    // 可选：在较深节点左上角绘制深度标记
    if (this.depth > 0 && this.bounds.w * scale > 80) {
      ctx.fillStyle = `rgba(0, 255, 180, ${alpha * 0.8})`
      ctx.font = `${Math.max(10 / scale, 8)}px monospace`
      ctx.fillText(
        `d:${this.depth} n:${this.shapes.length}`,
        this.bounds.x + 4 / scale,
        this.bounds.y + 12 / scale,
      )
    }
    ctx.restore()

    // 递归绘制子节点
    if (this.children) {
      for (let i = 0; i < 4; i++) {
        this.children[i].drawDebug(ctx, viewBounds, scale)
      }
    }
  }
}
