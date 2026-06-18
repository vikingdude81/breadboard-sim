/**
 * Ratsnest — Kruskal MST wire suggestions.
 *
 * Algorithm ported from KiCad pcbnew/ratsnest/ratsnest_data.cpp kruskalMST().
 *
 * Given placed components and existing wires, computes the minimum spanning
 * tree over all disconnected electrical clusters.  Each MST edge becomes a
 * "ghost wire" suggestion drawn on the breadboard as a dashed line.
 *
 * getXY(col, row) → {x, y}  must be provided by the caller (avoids circular
 * import with Breadboard.jsx).
 */

// ── Union-Find (path-compressed) ─────────────────────────────────────────────
function makeUF(n) {
  const parent = Array.from({ length: n }, (_, i) => i)
  const rank   = new Array(n).fill(0)
  function find(x) {
    if (parent[x] !== x) parent[x] = find(parent[x])
    return parent[x]
  }
  function union(x, y) {
    const px = find(x), py = find(y)
    if (px === py) return false
    if (rank[px] < rank[py]) parent[px] = py
    else if (rank[px] > rank[py]) parent[py] = px
    else { parent[py] = px; rank[px]++ }
    return true
  }
  return { find, union }
}

// ── Build a flat list of pin-anchors from placed components ──────────────────
function buildAnchors(components, getXY) {
  const anchors = []
  for (const comp of components) {
    // Map every pin (pin1..pin5) to its corresponding node entry by index,
    // so multi-terminal parts (BJT=3, op-amp=5) are fully anchored.
    const pinSlots = []
    const nodeEntries = Object.entries(comp.nodes || {})

    ;['pin1', 'pin2', 'pin3', 'pin4', 'pin5'].forEach((pk, i) => {
      if (comp[pk]) pinSlots.push({ pos: comp[pk], entry: nodeEntries[i] })
    })

    for (const { pos, entry } of pinSlots) {
      if (!pos || !entry) continue
      const node = entry[1]
      if (!node) continue
      const { x, y } = getXY(pos.col, pos.row)
      anchors.push({ x, y, node, compId: comp.id, pos })
    }
  }
  return anchors
}

// ── Merge node clusters through wires ────────────────────────────────────────
function buildNodeClusters(anchors, wires) {
  // Unique nodes
  const nodeSet  = new Set(anchors.map(a => a.node))
  const nodeList = [...nodeSet]
  const nodeIdx  = Object.fromEntries(nodeList.map((n, i) => [n, i]))
  const uf = makeUF(nodeList.length)

  // Wire connections merge clusters
  for (const w of wires) {
    const fi = nodeIdx[w.fromNode], ti = nodeIdx[w.toNode]
    if (fi !== undefined && ti !== undefined) uf.union(fi, ti)
  }

  // Group anchors by cluster root
  const clusters = {}
  for (const anchor of anchors) {
    const root = uf.find(nodeIdx[anchor.node])
    if (!clusters[root]) clusters[root] = []
    clusters[root].push(anchor)
  }

  return Object.values(clusters)
}

/**
 * Compute ratsnest MST.
 *
 * @param  {Array}    components  — from store
 * @param  {Array}    wires       — from store
 * @param  {Function} getXY       — (col, row) → {x, y}
 * @returns {Array} edges — [{fromX,fromY,toX,toY,fromPin,toPin,weight}]
 */
export function computeRatsnest(components, wires, getXY) {
  if (components.length === 0) return []

  const anchors  = buildAnchors(components, getXY)
  const clusters = buildNodeClusters(anchors, wires)

  if (clusters.length <= 1) return []  // everything already connected

  // Representative anchor per cluster = pin closest to cluster centroid
  const reps = clusters.map(pins => {
    const cx = pins.reduce((s, p) => s + p.x, 0) / pins.length
    const cy = pins.reduce((s, p) => s + p.y, 0) / pins.length
    // Pick the actual pin closest to centroid as drawing endpoint
    let best = pins[0], bestD = Infinity
    for (const p of pins) {
      const d = (p.x-cx)**2 + (p.y-cy)**2
      if (d < bestD) { bestD = d; best = p }
    }
    return { cx, cy, rep: best, pins }
  })

  // Build complete graph of cluster-to-cluster edges
  const edges = []
  for (let i = 0; i < reps.length; i++) {
    for (let j = i + 1; j < reps.length; j++) {
      // Find the closest pair of actual anchors between the two clusters
      let minD = Infinity, fromPin = reps[i].rep, toPin = reps[j].rep
      for (const a of reps[i].pins) {
        for (const b of reps[j].pins) {
          const d = (a.x-b.x)**2 + (a.y-b.y)**2
          if (d < minD) { minD = d; fromPin = a; toPin = b }
        }
      }
      edges.push({ from: i, to: j, weight: Math.sqrt(minD), fromPin, toPin })
    }
  }

  // Sort by weight ascending (Kruskal step)
  edges.sort((a, b) => a.weight - b.weight)

  // Kruskal MST
  const uf = makeUF(reps.length)
  const mst = []
  for (const e of edges) {
    if (uf.union(e.from, e.to)) {
      mst.push({
        fromX:   e.fromPin.x,
        fromY:   e.fromPin.y,
        toX:     e.toPin.x,
        toY:     e.toPin.y,
        weight:  e.weight,
        fromNode: e.fromPin.node,
        toNode:   e.toPin.node,
        fromPos:  e.fromPin.pos,
        toPos:    e.toPin.pos,
      })
    }
  }

  return mst
}
