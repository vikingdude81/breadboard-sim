/**
 * Connectivity layer — the single source of truth for "what is wired to what".
 *
 * Historically the simulator, ERC, and SPICE export each derived nets only from
 * component pin node-names, which meant drawn WIRES had no electrical effect.
 * This module fixes that: it runs union-find over
 *     {component pin nodes} ∪ {wire endpoints} ∪ {ground aliases}
 * and collapses every electrically-common net to one canonical node name.
 *
 * Everything that needs a netlist (buildSimRequest, runERC, generateSpice,
 * transient probes, on-board voltage display) goes through computeNodeMap()
 * so they all agree.
 *
 * Self-contained on purpose: depends on nothing from the store to avoid an
 * import cycle. It works purely on the node-name strings already carried by
 * components (`c.nodes`) and wires (`w.fromNode` / `w.toNode`).
 */

// ── Union-Find over arbitrary string keys ─────────────────────────────────────
function makeUF() {
  const parent = new Map()
  const add = (x) => { if (!parent.has(x)) parent.set(x, x) }
  const find = (x) => {
    add(x)
    let r = x
    while (parent.get(r) !== r) r = parent.get(r)
    // path compression
    while (parent.get(x) !== r) { const nx = parent.get(x); parent.set(x, r); x = nx }
    return r
  }
  const union = (a, b) => {
    add(a); add(b)
    const ra = find(a), rb = find(b)
    if (ra !== rb) parent.set(ra, rb)
  }
  return { add, find, union, keys: () => parent.keys() }
}

// Canonical-name preference: ground wins, then power rails (for readable output),
// then lexicographically smallest. Deterministic so results are stable.
function pickCanon(names) {
  if (names.includes('GND') || names.includes('0')) return 'GND'
  const sorted = [...names].sort()
  const powerPos = sorted.find(n => /POS$/.test(n))
  return powerPos || sorted[0]
}

/**
 * Build the canonical-node resolver for the current board.
 * @returns {(node: string) => string} maps any original node name to its net's canonical name
 */
export function computeNodeMap(components = [], wires = []) {
  const uf = makeUF()

  for (const c of components) {
    for (const n of Object.values(c.nodes || {})) if (n) uf.add(n)
  }
  for (const w of wires) {
    if (w.fromNode) uf.add(w.fromNode)
    if (w.toNode)   uf.add(w.toNode)
  }
  // Ground aliases are the same net.
  uf.union('GND', '0')

  // Wires merge nets — this is the whole point.
  for (const w of wires) {
    if (w.fromNode && w.toNode) uf.union(w.fromNode, w.toNode)
  }

  // Group every known name by its root, then choose one canonical name per group.
  const groups = new Map()
  for (const name of uf.keys()) {
    const r = uf.find(name)
    if (!groups.has(r)) groups.set(r, [])
    groups.get(r).push(name)
  }
  const canonOf = new Map()
  for (const names of groups.values()) {
    const canon = pickCanon(names)
    for (const n of names) canonOf.set(n, canon)
  }

  return (n) => canonOf.get(n) ?? n
}

/**
 * Return components with their pin nodes rewritten to canonical net names,
 * ready to send to the backend /simulate endpoints.
 */
export function remapComponents(components = [], wires = []) {
  const canon = computeNodeMap(components, wires)
  return components.map(c => ({
    id: c.id,
    type: c.type,
    params: c.params,
    nodes: Object.fromEntries(
      Object.entries(c.nodes || {}).map(([pin, node]) => [pin, canon(node)])
    ),
  }))
}
