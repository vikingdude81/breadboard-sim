/**
 * Local LLM client — LM Studio / Ollama OpenAI-compatible endpoint.
 * Falls back gracefully if the server is unreachable.
 */
import { runERC } from './erc'

const LLM_BASE  = 'http://192.168.50.150:1234/v1'
export const DEBUG_MODEL = 'google/gemma-4-26b-a4b'

export async function streamChat(messages, onChunk, onDone, signal, model = null) {
  const res = await fetch(`${LLM_BASE}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal,
    body: JSON.stringify({
      model: model || undefined,
      messages,
      temperature: 0.6,
      max_tokens: 3000,
      stream: true,
    }),
  })

  if (!res.ok) throw new Error(`LLM error ${res.status}: ${await res.text()}`)

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let full = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    const chunk = decoder.decode(value, { stream: true })
    for (const line of chunk.split('\n')) {
      if (!line.startsWith('data: ')) continue
      const payload = line.slice(6).trim()
      if (payload === '[DONE]') { onDone?.(full); return full }
      try {
        const delta = JSON.parse(payload).choices?.[0]?.delta?.content || ''
        if (delta) { full += delta; onChunk?.(delta, full) }
      } catch {}
    }
  }
  onDone?.(full)
  return full
}

export async function listModels() {
  try {
    const res = await fetch(`${LLM_BASE}/models`, { signal: AbortSignal.timeout(3000) })
    if (!res.ok) return []
    const data = await res.json()
    return (data.data || []).map(m => m.id)
  } catch {
    return []
  }
}

// ── Board serializer ──────────────────────────────────────────────────────────

export function serializeBoard(components, wires, simResult) {
  const lines = [
    'BREADBOARD STATE',
    '────────────────',
    'Board: 30 rows × 10 cols (a–e left half, f–j right half).',
    'Rows a–e on same row share one electrical node (LE{row}).',
    'Rows f–j on same row share one electrical node (RE{row}).',
    'Power rails: rail_l+ = PWR_L_POS, rail_l- = PWR_L_NEG (left side).',
    '',
  ]

  if (components.length === 0) {
    lines.push('No components placed yet.')
  } else {
    lines.push('COMPONENTS:')
    for (const c of components) {
      const pos = `${c.pin1.col}${c.pin1.row}` + (c.pin2 ? `→${c.pin2.col}${c.pin2.row}` : '')
      const params = Object.entries(c.params || {})
        .filter(([k]) => !['label','type','icon'].includes(k))
        .map(([k,v]) => `${k}=${v}`).join(', ')
      lines.push(`  ${c.id} [${c.label}] @ ${pos}  params: ${params}`)
      lines.push(`     nodes: ${JSON.stringify(c.nodes)}`)
    }
  }

  if (wires.length > 0) {
    lines.push('')
    lines.push('WIRES:')
    for (const w of wires) {
      lines.push(`  ${w.from.col}${w.from.row} ↔ ${w.to.col}${w.to.row}  (${w.fromNode} ↔ ${w.toNode})`)
    }
  }

  if (simResult) {
    lines.push('')
    lines.push('SIMULATION RESULTS (DC operating point):')
    const vEntries = Object.entries(simResult.node_voltages).filter(([n]) => n !== '0')
    for (const [n, v] of vEntries) lines.push(`  ${n} = ${v.toFixed(4)} V`)
    for (const [id, s] of Object.entries(simResult.led_states || {})) {
      lines.push(`  LED ${id}: ${s.on ? 'ON' : 'OFF'} Vd=${s.vd.toFixed(3)}V`)
    }
    for (const [id, i] of Object.entries(simResult.branch_currents || {})) {
      lines.push(`  Branch ${id}: ${(i*1000).toFixed(3)} mA`)
    }
  }

  return lines.join('\n')
}

// ── System prompts ────────────────────────────────────────────────────────────

export const SYSTEM_ANALYST = `You are an expert electronics engineer and circuit design assistant embedded in an interactive breadboard simulator.

The breadboard has 30 rows (1–30) and 10 columns (a–j).
- Columns a,b,c,d,e share a node per row (left half): node name LE{row}
- Columns f,g,h,i,j share a node per row (right half): node name RE{row}
- Left power rails: rail_l+ (red, PWR_L_POS) and rail_l- (blue, PWR_L_NEG)
- Right power rails: rail_r+ (red, PWR_R_POS) and rail_r- (blue, PWR_R_NEG)
- Components span 2 rows in the same column. BJTs span 3 rows.

When analyzing a circuit:
1. Identify what the circuit is trying to do
2. Check for problems (missing ground, floating nodes, wrong polarity, exceeding component ratings)
3. Suggest improvements or next steps
4. Be concise but technically precise. Use mA, V, Ω units.`

export const SYSTEM_GUIDE = `You are a hands-on electronics lab instructor embedded in a breadboard simulator.

The breadboard has 30 rows (1–30) and 10 columns (a–j). Left half a–e, right half f–j share nodes per row. Power rails on left and right sides.

When giving a step-by-step guide:
- Number each step clearly
- Specify exact hole positions (e.g. "place the resistor with pin 1 in a5, pin 2 in a7")
- Explain WHY each connection is made
- Include safety notes for higher voltages
- End with what to expect from the simulation and visually on the board`

export const SYSTEM_RESEARCHER = `You are an autonomous circuit research agent embedded in a breadboard simulator.

The breadboard: 30 rows × 10 cols (a–j). Columns a–e share a node per row (LE{row}), f–j share a node (RE{row}).
Power rails: rail_l+, rail_l-, rail_r+, rail_r-.

When asked to prototype a circuit, respond with ONLY valid JSON in this exact schema:
{
  "title": "Circuit name",
  "description": "What this circuit does",
  "analysis": "Why this design was chosen",
  "steps": ["Step 1 description", "Step 2 description"],
  "components": [
    {
      "id": "B1", "type": "battery", "label": "9V Battery",
      "params": {"voltage": 9},
      "pin1": {"col": "a", "row": 1},
      "pin2": {"col": "a", "row": 3},
      "nodes": {"pos": "LE1", "neg": "GND"}
    }
  ],
  "wires": [
    {
      "id": "W1",
      "from": {"col": "rail_l+", "row": 1},
      "to": {"col": "a", "row": 1},
      "fromNode": "PWR_L_POS",
      "toNode": "LE1",
      "color": "#dc2626"
    }
  ]
}

Component types: battery (params: voltage), resistor (params: resistance), led (params: vf, color), zener (params: vf, vz), diode (params: vf), bjt (params: bjt_type NPN/PNP, hfe, vbe), capacitor (params: capacitance).
For BJTs add pin3: {col, row} and nodes.base, nodes.collector, nodes.emitter.
Keep circuits within rows 1–28, cols a–j. Use col 'a' or 'b' for components, 'c'–'e' for connections.
Respond with ONLY the JSON object, no markdown, no explanation outside it.`

// ── Auto-Debug system prompt ──────────────────────────────────────────────────

export const SYSTEM_DEBUGGER = `You are an expert circuit debugger embedded in a breadboard simulator.
You receive a description of a circuit, its simulation results, and a list of detected anomalies.
Your job is to diagnose the root cause and return a precise, machine-executable fix plan as JSON.

Board layout:
- 30 rows × 10 cols (a–j). Cols a–e = left half (node LE{row}), f–j = right half (node RE{row}).
- Power rails: rail_l+ (PWR_L_POS), rail_l- (PWR_L_NEG), rail_r+ (PWR_R_POS), rail_r- (PWR_R_NEG).
- Components span 2 rows in same col. BJTs span 3 rows.

You MUST respond with ONLY a single valid JSON object in this exact schema — no markdown, no prose outside it:

{
  "diagnosis": "One-sentence root cause explanation",
  "confidence": 0.85,
  "fixes": [
    {
      "action": "change_param",
      "component_id": "R1",
      "param": "resistance",
      "value": 330,
      "reason": "Why this change fixes the problem"
    },
    {
      "action": "add_wire",
      "from": {"col": "e", "row": 5},
      "to": {"col": "rail_l-", "row": 5},
      "reason": "Connect LED cathode to ground rail"
    },
    {
      "action": "add_component",
      "type": "resistor",
      "label": "330Ω current limiter",
      "params": {"resistance": 330},
      "pin1": {"col": "a", "row": 3},
      "pin2": {"col": "a", "row": 5},
      "reason": "Missing current-limiting resistor"
    },
    {
      "action": "remove_component",
      "component_id": "R2",
      "reason": "Redundant resistor causing too much voltage drop"
    },
    {
      "action": "remove_wire",
      "wire_id": "W3",
      "reason": "Short circuit wire"
    }
  ],
  "expected_after_fix": "LED should turn on at ~2V, ~20mA through R1"
}

Rules:
- Only include fixes that directly address the anomalies. Do not redesign the whole circuit.
- Prefer changing a param over adding/removing components when possible.
- Keep component positions within rows 1–28, cols a–j.
- If the circuit has no fixable problem (everything is correct), return fixes: [] and explain in diagnosis.`

// ── Anomaly detector (deterministic, no LLM) ─────────────────────────────────
// Combines simulation-based checks WITH full ERC pin-type analysis.

export function detectAnomalies(components, wires, simResult) {
  const anomalies = []

  // ── ERC structural checks (no sim required) ───────────────────────────────
  runERC(components, wires).forEach(v => anomalies.push({
    type: v.type, severity: v.severity, detail: v.detail, node: v.node,
  }))

  if (!simResult) return anomalies
  const { node_voltages = {}, led_states = {}, branch_currents = {} } = simResult

  const hasPower = Object.entries(node_voltages)
    .some(([n, v]) => n !== '0' && n !== 'GND' && Math.abs(v) > 0.5)

  // ── Simulation-result checks ──────────────────────────────────────────────

  // LEDs off despite power present in circuit
  for (const [id, state] of Object.entries(led_states)) {
    if (!state.on && hasPower) {
      anomalies.push({
        type: 'led_off', severity: 'error', component: id,
        detail: `${id} is OFF (Vd=${state.vd.toFixed(3)}V) but power is present — missing resistor or ground wire?`,
      })
    }
    if (state.on && state.vd > 4.5) {
      anomalies.push({
        type: 'led_overvoltage', severity: 'warning', component: id,
        detail: `${id} Vd=${state.vd.toFixed(2)}V is unusually high — may be missing current-limiting resistor`,
      })
    }
  }

  // Floating nodes: signal nodes sitting at 0V when there's power
  Object.entries(node_voltages)
    .filter(([n, v]) => n !== '0' && n !== 'GND' && Math.abs(v) < 0.01)
    .forEach(([n]) => {
      const isBatNeg = components.some(c => c.type === 'battery' && c.nodes?.neg === n)
      if (!isBatNeg) anomalies.push({
        type: 'floating_node', severity: 'warning', node: n,
        detail: `Node ${n} reads 0V with power present — may be floating or missing a wire`,
      })
    })

  // Short circuit: voltage source supplying > 5A
  for (const [id, cur] of Object.entries(branch_currents)) {
    if (Math.abs(cur) > 5) anomalies.push({
      type: 'short_circuit', severity: 'error', component: id,
      detail: `${id} is sourcing ${(cur*1000).toFixed(0)}mA — likely a short circuit`,
    })
  }

  // Deduplicate by type+detail prefix
  const seen = new Set()
  return anomalies.filter(a => {
    const key = `${a.type}:${a.node || a.component || ''}:${a.detail.slice(0, 40)}`
    if (seen.has(key)) return false
    seen.add(key); return true
  })
}

// ── LLM debug-fix request ─────────────────────────────────────────────────────

export async function requestDebugFix(components, wires, simResult, anomalies, onChunk, signal) {
  const boardDesc = serializeBoard(components, wires, simResult)

  const anomalyDesc = anomalies.map((a, i) =>
    `${i+1}. [${a.severity.toUpperCase()}] ${a.detail}`
  ).join('\n')

  const userMsg = `CIRCUIT DESCRIPTION:\n${boardDesc}\n\nDETECTED ANOMALIES:\n${anomalyDesc}\n\nPlease diagnose and return the fix JSON.`

  let full = ''
  await streamChat(
    [
      { role: 'system', content: SYSTEM_DEBUGGER },
      { role: 'user',   content: userMsg },
    ],
    (delta, acc) => { full = acc; onChunk?.(delta, acc) },
    null,
    signal,
    DEBUG_MODEL,
  )
  return full
}

// ── Fix JSON parser (handles markdown-wrapped responses) ──────────────────────

export function parseFixJson(raw) {
  // Strip markdown code fences if present
  const stripped = raw
    .replace(/^```(?:json)?\s*/im, '')
    .replace(/\s*```\s*$/im, '')
    .trim()
  // Find first { ... } block
  const start = stripped.indexOf('{')
  const end   = stripped.lastIndexOf('}')
  if (start === -1 || end === -1) throw new Error('No JSON object found in response')
  return JSON.parse(stripped.slice(start, end + 1))
}
