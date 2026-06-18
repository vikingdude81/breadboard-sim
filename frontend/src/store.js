import { create } from 'zustand'
import { computeNodeMap, remapComponents } from './netlist'

export const ROWS = 30
export const LEFT_COLS  = ['a','b','c','d','e']
export const RIGHT_COLS = ['f','g','h','i','j']
export const ALL_COLS   = [...LEFT_COLS, ...RIGHT_COLS]

export const CELL   = 34
export const RAIL_W = 44

export function posToNode(col, row) {
  if (col === 'rail_l+') return 'PWR_L_POS'
  if (col === 'rail_l-') return 'PWR_L_NEG'
  if (col === 'rail_r+') return 'PWR_R_POS'
  if (col === 'rail_r-') return 'PWR_R_NEG'
  if (LEFT_COLS.includes(col))  return `LE${row}`
  if (RIGHT_COLS.includes(col)) return `RE${row}`
  return `N_${col}_${row}`
}

let _idCounter = 0
export function nextId(prefix = 'C') { return `${prefix}${++_idCounter}` }

// Keep nextId() from colliding with ids restored from a saved/autosaved board.
function bumpIdCounter(items) {
  for (const it of items) {
    const m = String(it?.id ?? '').match(/(\d+)\s*$/)
    if (m) _idCounter = Math.max(_idCounter, parseInt(m[1], 10))
  }
}

// Rebuild the action log from a bare components/wires snapshot (timestamps lost).
function rebuildHistory(components, wires) {
  const h = []
  for (const c of components) {
    h.push({ type: 'component', id: c.id,
             label: `${c.label} (${c.pin1?.col ?? '?'}${c.pin1?.row ?? ''})`,
             timestamp: 0 })
  }
  for (const w of wires) {
    h.push({ type: 'wire', id: w.id,
             label: `Wire ${w.from?.col}${w.from?.row} → ${w.to?.col}${w.to?.row}`,
             color: w.color, timestamp: 0 })
  }
  return h
}

const AUTOSAVE_KEY = 'breadboard:autosave:v1'

function loadAutosave() {
  try {
    const raw = localStorage.getItem(AUTOSAVE_KEY)
    if (!raw) return { components: [], wires: [] }
    const d = JSON.parse(raw)
    return { components: d.components || [], wires: d.wires || [] }
  } catch { return { components: [], wires: [] } }
}

const _init = loadAutosave()
bumpIdCounter([..._init.components, ..._init.wires])

const useStore = create((set, get) => ({
  components: _init.components,
  wires: _init.wires,
  history: rebuildHistory(_init.components, _init.wires),
  simResult: null,
  simError: null,
  simLoading: false,
  selectedPaletteItem: null,
  selectedComponentId: null,
  wireStart: null,

  setSelectedPaletteItem: (item) => set({ selectedPaletteItem: item }),
  setWireStart: (h) => set({ wireStart: h }),

  addComponent: (comp) => set(s => ({
    components: [...s.components, comp],
    history: [...s.history, {
      type: 'component', id: comp.id,
      label: `${comp.label} (${comp.pin1.col}${comp.pin1.row})`,
      timestamp: Date.now(),
    }],
  })),

  removeComponent: (id) => set(s => ({
    components: s.components.filter(c => c.id !== id),
    wires: s.wires.filter(w => w.fromCompId !== id && w.toCompId !== id),
    history: s.history.filter(h => h.id !== id),
  })),

  addWire: (wire) => set(s => ({
    wires: [...s.wires, wire],
    history: [...s.history, {
      type: 'wire', id: wire.id,
      label: `Wire ${wire.from.col}${wire.from.row} → ${wire.to.col}${wire.to.row}`,
      color: wire.color,
      timestamp: Date.now(),
    }],
  })),

  removeWire: (id) => set(s => ({
    wires: s.wires.filter(w => w.id !== id),
    history: s.history.filter(h => h.id !== id),
  })),

  undoLast: () => {
    const { history, components, wires } = get()
    if (!history.length) return
    const last = history[history.length - 1]
    if (last.type === 'component') {
      set({
        components: components.filter(c => c.id !== last.id),
        wires: wires.filter(w => w.fromCompId !== last.id && w.toCompId !== last.id),
        history: history.slice(0, -1),
      })
    } else {
      set({
        wires: wires.filter(w => w.id !== last.id),
        history: history.slice(0, -1),
      })
    }
  },

  removeHistoryItem: (id) => {
    const { history, components, wires } = get()
    const item = history.find(h => h.id === id)
    if (!item) return
    if (item.type === 'component') {
      set({
        components: components.filter(c => c.id !== id),
        wires: wires.filter(w => w.fromCompId !== id && w.toCompId !== id),
        history: history.filter(h => h.id !== id),
      })
    } else {
      set({
        wires: wires.filter(w => w.id !== id),
        history: history.filter(h => h.id !== id),
      })
    }
  },

  clearBoard: () => set({
    components: [], wires: [], history: [],
    simResult: null, simError: null, wireStart: null,
    selectedComponentId: null,
  }),

  setSimResult: (r) => set({ simResult: r, simError: null, simLoading: false }),
  setSimError:  (e) => set({ simError: e, simResult: null, simLoading: false }),
  setSimLoading: (v) => set({ simLoading: v }),

  // Ratsnest toggle
  showRatsnest: false,
  setShowRatsnest: (v) => set({ showRatsnest: v }),

  // Transient / oscilloscope state
  transientResult: null,
  transientLoading: false,
  transientError: null,
  probeNodes: [],         // nodes being probed (clicked on board)
  setProbeNodes: (ns) => set({ probeNodes: ns }),
  addProbeNode: (n) => set(s => ({ probeNodes: s.probeNodes.includes(n) ? s.probeNodes : [...s.probeNodes, n] })),
  removeProbeNode: (n) => set(s => ({ probeNodes: s.probeNodes.filter(p => p !== n) })),
  setTransientResult: (r) => set({ transientResult: r, transientError: null, transientLoading: false }),
  setTransientError:  (e) => set({ transientError: e, transientResult: null, transientLoading: false }),
  setTransientLoading: (v) => set({ transientLoading: v }),

  // Canonical-node resolver for the current board (wires + implicit rails merged).
  // Refreshed whenever a sim request is built so result lookups stay in sync.
  nodeMap: (n) => n,
  refreshNodeMap: () => {
    const { components, wires } = get()
    const canon = computeNodeMap(components, wires)
    set({ nodeMap: canon })
    return canon
  },

  buildSimRequest: () => {
    const { components, wires } = get()
    set({ nodeMap: computeNodeMap(components, wires) })
    return { components: remapComponents(components, wires) }
  },

  // Update a param on an existing component (AI fix engine + Inspector panel)
  changeParam: (compId, param, value) => set(s => ({
    components: s.components.map(c =>
      c.id === compId ? { ...c, params: { ...c.params, [param]: value } } : c
    ),
  })),

  // ── Selection (click-to-edit) ───────────────────────────────────────────────
  setSelectedComponent: (id) => set({ selectedComponentId: id }),

  // ── Save / Load ─────────────────────────────────────────────────────────────
  exportBoard: () => {
    const { components, wires } = get()
    return { format: 'breadboard-sim', version: 1,
             savedAt: new Date().toISOString(), components, wires }
  },
  loadBoard: (data) => {
    const components = Array.isArray(data?.components) ? data.components : []
    const wires      = Array.isArray(data?.wires) ? data.wires : []
    bumpIdCounter([...components, ...wires])
    set({
      components, wires,
      history: rebuildHistory(components, wires),
      simResult: null, simError: null, transientResult: null,
      selectedComponentId: null, wireStart: null,
      nodeMap: computeNodeMap(components, wires),
    })
  },

  // Auto-debug state
  autoDebugLog: [],       // [{iteration, anomalies, diagnosis, fixes, status}]
  autoDebugRunning: false,
  autoDebugIteration: 0,
  appendDebugLog: (entry) => set(s => ({ autoDebugLog: [...s.autoDebugLog, entry] })),
  clearDebugLog: () => set({ autoDebugLog: [], autoDebugIteration: 0 }),
  setAutoDebugRunning: (v) => set({ autoDebugRunning: v }),

  loadQRNGTemplate: async () => {
    const res = await fetch('http://localhost:8000/templates/zener-qrng')
    return await res.json()
  },
}))

// Autosave board layout to localStorage so a refresh doesn't lose work.
useStore.subscribe((state) => {
  try {
    localStorage.setItem(AUTOSAVE_KEY, JSON.stringify({
      components: state.components, wires: state.wires,
    }))
  } catch { /* quota / private mode — ignore */ }
})

export default useStore
