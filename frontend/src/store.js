import { create } from 'zustand'

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

const useStore = create((set, get) => ({
  components: [],
  wires: [],
  history: [],          // [{type:'component'|'wire', id, label, timestamp}]
  simResult: null,
  simError: null,
  simLoading: false,
  selectedPaletteItem: null,
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
  }),

  setSimResult: (r) => set({ simResult: r, simError: null, simLoading: false }),
  setSimError:  (e) => set({ simError: e, simResult: null, simLoading: false }),
  setSimLoading: (v) => set({ simLoading: v }),

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

  buildSimRequest: () => {
    const { components } = get()
    return { components: components.map(c => ({ id: c.id, type: c.type, params: c.params, nodes: c.nodes })) }
  },

  // Update a param on an existing component (used by AI fix engine)
  changeParam: (compId, param, value) => set(s => ({
    components: s.components.map(c =>
      c.id === compId ? { ...c, params: { ...c.params, [param]: value } } : c
    ),
  })),

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

export default useStore
