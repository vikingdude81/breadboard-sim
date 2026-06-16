import { useState, useRef, useEffect, useCallback } from 'react'
import useStore, { posToNode, nextId } from '../store'
import { streamChat, listModels, serializeBoard,
         SYSTEM_ANALYST, SYSTEM_GUIDE, SYSTEM_RESEARCHER } from '../llm'

const GUIDE_TEMPLATES = [
  { label: 'LED + resistor from 9V', prompt: 'Give me a step-by-step guide to wire a red LED with a current-limiting resistor from a 9V battery on this breadboard. Choose a safe resistor value and explain the calculation.' },
  { label: 'Transistor switch (NPN)', prompt: 'Guide me through building an NPN transistor switch using a 2N2222 that turns on an LED when a signal is applied to the base. Include all resistor values.' },
  { label: 'Zener voltage regulator', prompt: 'Walk me through building a Zener diode voltage regulator circuit that produces 5.1V from a 9V supply. Explain each component\'s role.' },
  { label: 'Zener QRNG (Seeed XIAO)', prompt: 'Give me a complete step-by-step guide to build a Zener avalanche QRNG circuit for the Seeed XIAO ESP32-C3. Include the bias resistor, coupling network, ADC connection, and notes on reading entropy bits in code.' },
  { label: 'Voltage divider', prompt: 'Guide me through building a simple resistor voltage divider to reduce 9V to approximately 3.3V for a microcontroller input.' },
]

const RESEARCH_PROMPTS = [
  'Design a simple LED blinker using a 555 timer in astable mode at ~1Hz',
  'Prototype a Zener QRNG circuit for Seeed XIAO ESP32-C3 with bias resistor and ADC coupling',
  'Design a 2N2222 NPN transistor amplifier with ~100x voltage gain',
  'Build a half-wave rectifier with a 1N4007 diode and smoothing capacitor',
  'Design an LED polarity tester using two LEDs (one red, one green)',
]

export default function LLMPanel({ onClose }) {
  const [tab, setTab] = useState('guide')
  const [modelStatus, setModelStatus] = useState('checking') // 'checking'|'online'|'offline'
  const [output, setOutput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [steps, setSteps] = useState([])      // parsed guide steps
  const [currentStep, setCurrentStep] = useState(0)
  const [researchPrompt, setResearchPrompt] = useState('')
  const [analysisExtra, setAnalysisExtra] = useState('')
  const abortRef = useRef(null)
  const outputRef = useRef(null)

  const { components, wires, simResult, addComponent, addWire, clearBoard } = useStore()

  // Check LLM availability on mount
  useEffect(() => {
    listModels().then(models => setModelStatus(models.length > 0 ? 'online' : 'offline'))
  }, [])

  // Auto-scroll output
  useEffect(() => {
    if (outputRef.current) outputRef.current.scrollTop = outputRef.current.scrollHeight
  }, [output])

  const stopStream = () => { abortRef.current?.abort(); setStreaming(false) }

  const runStream = useCallback(async (systemPrompt, userMessage) => {
    if (streaming) { stopStream(); return }
    setOutput('')
    setSteps([])
    setCurrentStep(0)
    setStreaming(true)
    abortRef.current = new AbortController()
    try {
      await streamChat(
        [{ role: 'system', content: systemPrompt },
         { role: 'user',   content: userMessage }],
        (_delta, full) => setOutput(full),
        (full) => {
          setStreaming(false)
          // Try to extract numbered steps from guide output
          const stepLines = full.match(/^\d+\.\s+.+/gm) || []
          if (stepLines.length > 0) setSteps(stepLines)
        },
        abortRef.current.signal,
      )
    } catch (e) {
      if (e.name !== 'AbortError') {
        setOutput(`⚠️ Cannot reach LLM at 192.168.50.150:1234\n\n${e.message}\n\nMake sure LM Studio is running and the server is started.`)
      }
      setStreaming(false)
    }
  }, [streaming])

  // ── Guide tab ──
  const runGuide = (prompt) => {
    const boardCtx = components.length > 0
      ? `\n\nCurrent board state:\n${serializeBoard(components, wires, simResult)}`
      : ''
    runStream(SYSTEM_GUIDE, prompt + boardCtx)
  }

  // ── Analysis tab ──
  const runAnalysis = () => {
    if (components.length === 0) { setOutput('⚠️ Place some components on the board first.'); return }
    const board = serializeBoard(components, wires, simResult)
    const extra = analysisExtra.trim() ? `\n\nAdditional context: ${analysisExtra}` : ''
    runStream(SYSTEM_ANALYST, `Please analyze this circuit and give detailed feedback:\n\n${board}${extra}`)
  }

  // ── Research Agent tab ──
  const runResearch = async (prompt) => {
    if (streaming) { stopStream(); return }
    setOutput('🔬 Research agent designing circuit...\n')
    setStreaming(true)
    abortRef.current = new AbortController()

    let full = ''
    try {
      await streamChat(
        [{ role: 'system', content: SYSTEM_RESEARCHER },
         { role: 'user',   content: prompt }],
        (_delta, f) => { full = f; setOutput('🔬 Research agent designing circuit...\n\n' + f) },
        async (f) => {
          setStreaming(false)
          await applyResearchResult(f)
        },
        abortRef.current.signal,
      )
    } catch (e) {
      if (e.name !== 'AbortError') {
        setOutput(`⚠️ LLM unreachable: ${e.message}`)
      }
      setStreaming(false)
    }
  }

  const applyResearchResult = async (raw) => {
    // Strip markdown code fences if present
    const cleaned = raw.replace(/^```(?:json)?\s*/m, '').replace(/\s*```\s*$/m, '').trim()
    let data
    try {
      data = JSON.parse(cleaned)
    } catch (e) {
      setOutput(prev => prev + '\n\n⚠️ Could not parse circuit JSON from LLM response.\n\nRaw output:\n' + raw)
      return
    }

    clearBoard()

    // Place components
    const placed = []
    for (const c of (data.components || [])) {
      placed.push({ ...c, id: c.id || nextId(c.type[0].toUpperCase()) })
    }
    placed.forEach(c => addComponent(c))

    // Place wires
    for (const w of (data.wires || [])) {
      addWire({ ...w, id: w.id || `W_${Date.now()}_${Math.random()}` })
    }

    const summary = [
      `✅ Circuit placed: "${data.title}"`,
      ``,
      data.description,
      ``,
      `📋 Analysis: ${data.analysis}`,
      ``,
      data.steps?.length ? `📌 Steps:\n${data.steps.map((s,i) => `${i+1}. ${s}`).join('\n')}` : '',
      ``,
      `⚡ Run Simulation to verify the circuit.`,
    ].filter(Boolean).join('\n')

    setOutput(summary)
    if (data.steps?.length) setSteps(data.steps.map((s,i) => `${i+1}. ${s}`))
  }

  const statusDot = {
    checking: { color: '#9ca3af', label: 'Checking LLM…' },
    online:   { color: '#16a34a', label: 'LLM online' },
    offline:  { color: '#dc2626', label: 'LLM offline' },
  }[modelStatus]

  return (
    <div style={{
      width: 380, background: '#fff', display: 'flex', flexDirection: 'column',
      borderLeft: '1px solid #e5e7eb', fontSize: 12, flexShrink: 0,
    }}>
      {/* Header */}
      <div style={{
        padding: '8px 12px', background: '#f8fafc',
        borderBottom: '1px solid #e5e7eb',
        display: 'flex', alignItems: 'center', gap: 8,
      }}>
        <span style={{ fontWeight: 700, fontSize: 13, color: '#1d4ed8' }}>
          🤖 AI Circuit Assistant
        </span>
        <div style={{ flex: 1 }} />
        <span style={{
          display: 'inline-flex', alignItems: 'center', gap: 4,
          fontSize: 10, color: statusDot.color,
        }}>
          <span style={{
            width: 7, height: 7, borderRadius: '50%',
            background: statusDot.color,
            boxShadow: modelStatus === 'online' ? '0 0 4px #4ade80' : 'none',
          }} />
          {statusDot.label}
        </span>
        <button onClick={onClose} style={{
          border: 'none', background: 'none', cursor: 'pointer',
          color: '#9ca3af', fontSize: 16, padding: '0 2px',
        }}>✕</button>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', borderBottom: '1px solid #e5e7eb', flexShrink: 0 }}>
        {[['guide','📋 Guide'], ['analysis','🔍 Analysis'], ['research','🔬 Research']].map(([t, label]) => (
          <button key={t} onClick={() => setTab(t)} style={{
            flex: 1, padding: '8px 0', border: 'none', cursor: 'pointer',
            fontWeight: 600, fontSize: 11,
            background: tab === t ? '#fff' : '#f9fafb',
            color: tab === t ? '#1d4ed8' : '#6b7280',
            borderBottom: tab === t ? '2px solid #1d4ed8' : '2px solid transparent',
          }}>
            {label}
          </button>
        ))}
      </div>

      {/* ── GUIDE TAB ── */}
      {tab === 'guide' && (
        <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
          <div style={{ padding: 10, borderBottom: '1px solid #f3f4f6' }}>
            <div style={{ fontWeight: 600, color: '#374151', marginBottom: 6, fontSize: 11 }}>
              Quick-start guides:
            </div>
            {GUIDE_TEMPLATES.map(t => (
              <button key={t.label} onClick={() => runGuide(t.prompt)}
                      disabled={streaming}
                      style={templateBtn}>
                {t.label}
              </button>
            ))}
          </div>

          {/* Step tracker */}
          {steps.length > 0 && (
            <div style={{ padding: 10, borderBottom: '1px solid #f3f4f6', background: '#f0fdf4' }}>
              <div style={{ fontWeight: 600, color: '#15803d', marginBottom: 6, fontSize: 11 }}>
                Step tracker ({currentStep + 1}/{steps.length}):
              </div>
              <div style={{ padding: 8, background: '#fff', borderRadius: 4,
                            border: '1px solid #bbf7d0', fontSize: 11, color: '#166534', lineHeight: 1.5 }}>
                {steps[currentStep]}
              </div>
              <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                <button onClick={() => setCurrentStep(s => Math.max(0, s-1))}
                        disabled={currentStep === 0} style={stepBtn}>← Prev</button>
                <button onClick={() => setCurrentStep(s => Math.min(steps.length-1, s+1))}
                        disabled={currentStep === steps.length-1} style={stepBtn}>Next →</button>
                <span style={{ fontSize: 10, color: '#9ca3af', alignSelf: 'center', marginLeft: 4 }}>
                  {steps.length} steps total
                </span>
              </div>
            </div>
          )}

          <OutputArea output={output} streaming={streaming} scrollRef={outputRef} onStop={stopStream} />
        </div>
      )}

      {/* ── ANALYSIS TAB ── */}
      {tab === 'analysis' && (
        <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
          <div style={{ padding: 10, borderBottom: '1px solid #f3f4f6' }}>
            <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 6 }}>
              Sends your current board state + simulation results to the LLM for expert feedback.
            </div>
            <textarea
              value={analysisExtra}
              onChange={e => setAnalysisExtra(e.target.value)}
              placeholder="Optional: add context or questions (e.g. 'Is this safe for 5V logic?')"
              style={{
                width: '100%', height: 52, resize: 'none', fontSize: 11,
                border: '1px solid #e5e7eb', borderRadius: 4, padding: 6,
                fontFamily: 'inherit', color: '#111827', boxSizing: 'border-box',
              }}
            />
            <button onClick={runAnalysis} disabled={streaming} style={primaryBtn('#1d4ed8', 6)}>
              {streaming ? '⟳ Analyzing…' : '🔍 Analyze Circuit'}
            </button>
            {simResult && (
              <div style={{ marginTop: 6, fontSize: 10, color: '#15803d' }}>
                ✓ Includes simulation results
              </div>
            )}
            {!simResult && components.length > 0 && (
              <div style={{ marginTop: 6, fontSize: 10, color: '#a16207' }}>
                ⚠ Run simulation first for deeper analysis
              </div>
            )}
          </div>
          <OutputArea output={output} streaming={streaming} scrollRef={outputRef} onStop={stopStream} />
        </div>
      )}

      {/* ── RESEARCH AGENT TAB ── */}
      {tab === 'research' && (
        <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
          <div style={{ padding: 10, borderBottom: '1px solid #f3f4f6' }}>
            <div style={{ fontSize: 11, color: '#374151', fontWeight: 600, marginBottom: 4 }}>
              Describe a circuit to prototype:
            </div>
            <div style={{ fontSize: 10, color: '#6b7280', marginBottom: 6 }}>
              The agent will design it, place all components on the board, and wire them automatically.
              <span style={{ color: '#dc2626' }}> This clears your current board.</span>
            </div>
            <textarea
              value={researchPrompt}
              onChange={e => setResearchPrompt(e.target.value)}
              placeholder="e.g. Design a Zener QRNG circuit for Seeed XIAO ESP32-C3..."
              style={{
                width: '100%', height: 68, resize: 'none', fontSize: 11,
                border: '1px solid #e5e7eb', borderRadius: 4, padding: 6,
                fontFamily: 'inherit', color: '#111827', boxSizing: 'border-box',
              }}
              onKeyDown={e => { if (e.key === 'Enter' && e.ctrlKey) runResearch(researchPrompt) }}
            />
            <button
              onClick={() => runResearch(researchPrompt)}
              disabled={streaming || !researchPrompt.trim()}
              style={primaryBtn('#6d28d9', 6)}
            >
              {streaming ? '⟳ Designing…' : '🔬 Design & Place Circuit'}
            </button>
            <div style={{ marginTop: 8, fontSize: 10, color: '#6b7280', fontWeight: 600 }}>
              Quick prompts:
            </div>
            {RESEARCH_PROMPTS.map(p => (
              <button key={p} onClick={() => { setResearchPrompt(p); runResearch(p) }}
                      disabled={streaming}
                      style={templateBtn}>
                {p}
              </button>
            ))}
          </div>
          <OutputArea output={output} streaming={streaming} scrollRef={outputRef} onStop={stopStream} />
        </div>
      )}
    </div>
  )
}

// ── Shared output area ────────────────────────────────────────────────────────

function OutputArea({ output, streaming, onStop, scrollRef }) {
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div ref={scrollRef} style={{
        flex: 1, overflowY: 'auto', padding: 12,
        fontFamily: 'monospace', fontSize: 11, lineHeight: 1.65,
        color: '#1f2937', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
        background: '#f9fafb',
      }}>
        {output || (
          <span style={{ color: '#9ca3af', fontFamily: 'system-ui' }}>
            LLM response will appear here…
          </span>
        )}
        {streaming && <span style={{ color: '#1d4ed8' }}>▌</span>}
      </div>
      {streaming && (
        <div style={{ padding: '6px 10px', borderTop: '1px solid #e5e7eb',
                      background: '#fff', display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ flex: 1, fontSize: 10, color: '#6b7280' }}>Streaming from local LLM…</div>
          <button onClick={onStop} style={{
            padding: '3px 10px', background: '#dc2626', color: '#fff',
            border: 'none', borderRadius: 3, cursor: 'pointer', fontSize: 11,
          }}>Stop</button>
        </div>
      )}
    </div>
  )
}

// ── Style helpers ─────────────────────────────────────────────────────────────

const templateBtn = {
  display: 'block', width: '100%', textAlign: 'left',
  padding: '4px 8px', marginTop: 3,
  background: '#f1f5f9', border: '1px solid #e2e8f0',
  borderRadius: 4, cursor: 'pointer', fontSize: 11, color: '#374151',
}

const stepBtn = {
  padding: '3px 10px', background: '#fff', border: '1px solid #d1d5db',
  borderRadius: 4, cursor: 'pointer', fontSize: 11, color: '#374151',
}

function primaryBtn(bg, mt = 0) {
  return {
    display: 'block', width: '100%', padding: '7px 0', marginTop: mt,
    background: bg, color: '#fff', border: 'none',
    borderRadius: 4, cursor: 'pointer', fontWeight: 600, fontSize: 12,
  }
}
