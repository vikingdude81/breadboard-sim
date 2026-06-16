/**
 * Local LLM client — LM Studio / Ollama OpenAI-compatible endpoint.
 * Falls back gracefully if the server is unreachable.
 */

const LLM_BASE = 'http://192.168.50.150:1234/v1'

export async function streamChat(messages, onChunk, onDone, signal) {
  const res = await fetch(`${LLM_BASE}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal,
    body: JSON.stringify({
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
