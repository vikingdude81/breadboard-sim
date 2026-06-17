/**
 * Electrical Rules Check (ERC)
 * Ported from KiCad eeschema/erc/erc.cpp — TestPinToPin(), TestGroundPins(),
 * TestNoConnectPins() — adapted for breadboard flat netlists.
 *
 * Pin types mirror KiCad's ELECTRICAL_PINTYPE enum (simplified):
 *   POWER_OUT  — drives a net  (battery+, regulator output)
 *   POWER_IN   — receives power (IC VCC/GND, MCU supply)
 *   OUTPUT     — signal driver  (BJT collector, opamp out)
 *   INPUT      — signal receiver (BJT base, gate, opamp inputs)
 *   PASSIVE    — bidirectional / no drive (resistor, cap, LED pins)
 *   NC         — intentionally unconnected
 */

export const PIN_TYPE = {
  POWER_OUT: 'POWER_OUT',
  POWER_IN:  'POWER_IN',
  OUTPUT:    'OUTPUT',
  INPUT:     'INPUT',
  PASSIVE:   'PASSIVE',
  NC:        'NC',
}

// Per-component pin type definitions (pinName → PIN_TYPE)
const COMP_PINS = {
  battery:       { pos: 'POWER_OUT', neg: 'POWER_IN'  },
  resistor:      { p:   'PASSIVE',   n:   'PASSIVE'   },
  capacitor:     { p:   'PASSIVE',   n:   'PASSIVE'   },
  led:           { anode: 'PASSIVE', cathode: 'PASSIVE' },
  diode:         { anode: 'PASSIVE', cathode: 'PASSIVE' },
  zener:         { anode: 'PASSIVE', cathode: 'PASSIVE' },
  bjt:           { collector: 'OUTPUT', base: 'INPUT', emitter: 'PASSIVE' },
  mosfet:        { gate: 'INPUT', drain: 'OUTPUT', source: 'PASSIVE' },
  opamp:         { non_inv: 'INPUT', inv: 'INPUT', out: 'OUTPUT',
                   v_neg: 'POWER_IN', v_pos: 'POWER_IN' },
  potentiometer: { a: 'PASSIVE', wiper: 'OUTPUT', b: 'PASSIVE' },
  ldr:           { p: 'PASSIVE', n: 'PASSIVE' },
  current_source:{ pos: 'OUTPUT', neg: 'POWER_IN' },
  mcu:           { GND: 'POWER_IN', '3V3': 'POWER_OUT', VCC: 'POWER_OUT', A0: 'INPUT' },
}

// KiCad-style ERC compatibility matrix.
// [driverType][receiverType] = null | 'warning' | 'error'
// null  = OK
// warn  = possible issue
// error = definite conflict
const ERC_MATRIX = {
  POWER_OUT: { POWER_OUT: 'error',   POWER_IN: null,    OUTPUT: 'warning', INPUT: null,     PASSIVE: null    },
  POWER_IN:  { POWER_OUT: null,      POWER_IN: null,    OUTPUT: null,      INPUT: null,     PASSIVE: null    },
  OUTPUT:    { POWER_OUT: 'warning', POWER_IN: null,    OUTPUT: 'error',   INPUT: null,     PASSIVE: null    },
  INPUT:     { POWER_OUT: null,      POWER_IN: null,    OUTPUT: null,      INPUT: 'warning',PASSIVE: null    },
  PASSIVE:   { POWER_OUT: null,      POWER_IN: null,    OUTPUT: null,      INPUT: null,     PASSIVE: null    },
  NC:        { POWER_OUT: 'warning', POWER_IN: 'warning',OUTPUT:'warning', INPUT: 'warning',PASSIVE:'warning'},
}

export function getPinType(compType, pinName) {
  return COMP_PINS[compType]?.[pinName] ?? 'PASSIVE'
}

/**
 * Run full ERC on the placed components.
 * Returns array of { type, severity, node?, detail, components? }
 */
export function runERC(components) {
  const violations = []
  const GROUND_NODES = new Set(['0', 'GND', 'PWR_L_NEG', 'PWR_R_NEG'])
  const POWER_NODES  = new Set(['PWR_L_POS', 'PWR_R_POS'])

  if (components.length === 0) return violations

  // ── Build net → pins map ─────────────────────────────────────────────────
  // net_name → [{ comp, pinName, pinType }]
  const netPins = {}

  for (const comp of components) {
    const pinDefs = COMP_PINS[comp.type] || {}
    for (const [pinName, pinType] of Object.entries(pinDefs)) {
      const node = comp.nodes?.[pinName]
      if (!node) continue
      if (GROUND_NODES.has(node)) continue   // ground is a valid sink, skip
      if (!netPins[node]) netPins[node] = []
      netPins[node].push({ comp, pinName, pinType })
    }
  }

  // ── Per-net checks ────────────────────────────────────────────────────────
  for (const [node, pins] of Object.entries(netPins)) {
    const drivers  = pins.filter(p => p.pinType === 'POWER_OUT' || p.pinType === 'OUTPUT')
    const inputs   = pins.filter(p => p.pinType === 'INPUT')
    const powerIns = pins.filter(p => p.pinType === 'POWER_IN')

    // 1. Undriven INPUT pins
    if (inputs.length > 0 && drivers.length === 0 && !POWER_NODES.has(node)) {
      inputs.forEach(p => violations.push({
        type: 'undriven_input', severity: 'error', node,
        detail: `${p.comp.id} pin "${p.pinName}" (INPUT) on node ${node} has no driver — connect to a power rail or output`,
        components: [p.comp.id],
      }))
    }

    // 2. Output-to-output conflict (two drivers on same net)
    if (drivers.length > 1) {
      const ids = drivers.map(p => `${p.comp.id}.${p.pinName}`)
      violations.push({
        type: 'output_conflict', severity: 'error', node,
        detail: `Conflicting drivers on node ${node}: ${ids.join(', ')} — outputs shorted`,
        components: drivers.map(p => p.comp.id),
      })
    }

    // 3. Pin-to-pin compatibility (KiCad TestPinToPin style)
    for (let i = 0; i < pins.length; i++) {
      for (let j = i + 1; j < pins.length; j++) {
        const res = ERC_MATRIX[pins[i].pinType]?.[pins[j].pinType]
        if (res === 'error') {
          violations.push({
            type: 'pin_conflict', severity: 'error', node,
            detail: `${pins[i].comp.id}.${pins[i].pinName} (${pins[i].pinType}) conflicts with ${pins[j].comp.id}.${pins[j].pinName} (${pins[j].pinType}) on node ${node}`,
            components: [pins[i].comp.id, pins[j].comp.id],
          })
        }
      }
    }

    // 4. Floating single-pin net (component pin connected to nothing else)
    if (pins.length === 1 && pins[0].pinType !== 'NC' && !POWER_NODES.has(node)) {
      violations.push({
        type: 'floating_pin', severity: 'warning', node,
        detail: `Node ${node}: ${pins[0].comp.id} pin "${pins[0].pinName}" is not connected to any other component — add a wire`,
        components: [pins[0].comp.id],
      })
    }
  }

  // ── Global checks ─────────────────────────────────────────────────────────

  // 5. No ground reference
  const hasGround = components.some(c =>
    Object.values(c.nodes || {}).some(n => GROUND_NODES.has(n))
  )
  if (!hasGround) {
    violations.push({
      type: 'no_ground', severity: 'error',
      detail: 'No ground reference — at least one component must connect to GND/0 or the − rail',
    })
  }

  // 6. No power source
  const hasPower = components.some(c => c.type === 'battery' || c.type === 'current_source')
  if (!hasPower) {
    violations.push({
      type: 'no_power', severity: 'warning',
      detail: 'No voltage or current source placed — circuit has no power',
    })
  }

  // 7. Components with ALL pins floating (zero connections)
  for (const comp of components) {
    const pinDefs = COMP_PINS[comp.type]
    if (!pinDefs) continue
    const pinNames = Object.keys(pinDefs)
    const connectedPins = pinNames.filter(pn => {
      const node = comp.nodes?.[pn]
      return node && node !== '0' && node !== 'GND'
    })
    if (connectedPins.length === 0 && pinNames.length > 0) {
      violations.push({
        type: 'unconnected_component', severity: 'warning',
        detail: `${comp.id} (${comp.label || comp.type}) has no connected pins — place wires to integrate it`,
        components: [comp.id],
      })
    }
  }

  // Deduplicate (same node + same type)
  const seen = new Set()
  return violations.filter(v => {
    const key = `${v.type}:${v.node || ''}:${(v.components || []).sort().join(',')}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}
