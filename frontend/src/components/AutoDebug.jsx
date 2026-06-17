/**
 * AI Auto-Debug panel — detects circuit anomalies, asks Gemma 4 for fixes,
 * applies them with one click, and optionally loops autonomously until clean.
 *
 * LLM: google/gemma-4-26b-a4b @ http://192.168.50.150:1234
 */
import { useState, useRef, useCallback } from 'react'
import useStore, { nextId, posToNode } from '../store'
import {
  detectAnomalies, requestDebugFix, parseFixJson,
  DEBUG_MODEL,
} from '../llm'

const API = 'http://localhost:8000'
const MAX_AUTO_ITERATIONS = 6

// ── Severity colours ──────────────────────────────────────────────────────────
const SEV = {
  error:   { bg: '#450a0a', border: '#dc2626', text: '#fca5a5', dot: '#ef4444' },
  warning: { bg: '#422006', border: '#d97706', text: '#fcd34d', dot: '#f59e0b' },
  info:    { bg: '#0c1a2e', border: '#3b82f6', text: '#93c5fd', dot: '#60a5fa' },
}

// ── Apply a single fix action to the store ────────────────────────────────────
function useFixer() {
  const store = useStore()
  return useCallback((fix) => {
    switch (fix.action) {
      case 'change_param': {
        store.changeParam(fix.component_id, fix.param, fix.value)
        break
      }
      case 'remove_component': {
        store.removeComponent(fix.component_id)
        break
      }
      case 'remove_wire': {
        store.removeWire(fix.wire_id)
        break
      }
      case 'add_wire': {
        const fromNode = fix.from.col.startsWith('rail')
          ? posToNode(fix.from.col, fix.from.row)
          : posToNode(fix.from.col, fix.from.row)
        const toNode = posToNode(fix.to.col, fix.to.row)
        store.addWire({
          id: nextId('W'),
          from: fix.from, to: fix.to,
          fromNode, toNode,
          color: fix.color || '#6366f1',
        })
        break
      }
      case 'add_component': {
        const pin1 = fix.pin1
        const pin2 = fix.pin2 || { col: pin1.col, row: pin1.row + 2 }
        const nodes = fix.nodes || {
          p: posToNode(pin1.col, pin1.row),
          n: posToNode(pin2.col, pin2.row),
        }
        store.addComponent({
          id: nextId(fix.type?.[0]?.toUpperCase() || 'X'),
          type: fix.type,
          label: fix.label || fix.type,
          params: fix.params || {},
          pin1, pin2,
          nodes,
        })
        break
      }
      default:
        console.warn('Unknown fix action:', fix.action)
    }
  }, [store])
}

// ── Run one simulation and return result ──────────────────────────────────────
async function runSimulate(components) {
  const res = await fetch(`${API}/simulate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      components: components.map(c => ({ id: c.id, type: c.type, params: c.params, nodes: c.nodes })),
    }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(err.detail || 'Simulation failed')
  }
  return res.json()
}

// ── Main panel ────────────────────────────────────────────────────────────────
export default function AutoDebug({ onClose }) {
  const {
    components, wires, simResult, setSimResult, setSimError,
    autoDebugLog, autoDebugRunning, autoDebugIteration,
    appendDebugLog, clearDebugLog, setAutoDebugRunning,
  } = useStore()
  const applyFix = useFixer()

  const [streaming, setStreaming]     = useState(false)
  const [streamText, setStreamText]   = useState('')
  const [pendingFix, setPendingFix]   = useState(null)   // parsed fix JSON waiting for approval
  const [parseError, setParseError]   = useState(null)
  const [autoMode, setAutoMode]       = useState(false)
  const abortRef = useRef(null)

  // ── Detect anomalies from current sim result ────────────────────────────────
  const anomalies = detectAnomalies(components, simResult)

  // ── Ask LLM for a fix ───────────────────────────────────────────────────────
  const askLLM = useCallback(async (comps, wrs, simRes, anoms) => {
    setStreaming(true)
    setStreamText('')
    setPendingFix(null)
    setParseError(null)
    abortRef.current = new AbortController()

    try {
      const raw = await requestDebugFix(
        comps, wrs, simRes, anoms,
        (_, acc) => setStreamText(acc),
        abortRef.current.signal,
      )
      try {
        const fix = parseFixJson(raw)
        setPendingFix(fix)
        return fix
      } catch (e) {
        setParseError(`Could not parse LLM response as JSON: ${e.message}`)
        return null
      }
    } catch (e) {
      if (e.name !== 'AbortError') setParseError(e.message)
      return null
    } finally {
      setStreaming(false)
    }
  }, [])

  // ── Apply all fixes in pendingFix ───────────────────────────────────────────
  const applyAll = useCallback((fixObj) => {
    const fixes = fixObj?.fixes || []
    fixes.forEach(f => applyFix(f))
    setPendingFix(null)
    setStreamText('')
  }, [applyFix])

  // ── One manual debug cycle ──────────────────────────────────────────────────
  const runOnce = useCallback(async () => {
    if (!components.length) return
    const anoms = detectAnomalies(components, simResult)
    if (!anoms.length) return
    await askLLM(components, wires, simResult, anoms)
  }, [components, wires, simResult, askLLM])

  // ── Autonomous loop ─────────────────────────────────────────────────────────
  const runAuto = useCallback(async () => {
    setAutoDebugRunning(true)
    clearDebugLog()
    abortRef.current = new AbortController()
    let iter = 0
    let curComponents = [...components]

    try {
      while (iter < MAX_AUTO_ITERATIONS) {
        iter++
        appendDebugLog({ iteration: iter, status: 'simulating' })

        // 1. Simulate
        let simRes
        try {
          simRes = await runSimulate(curComponents)
          setSimResult(simRes)
        } catch (e) {
          appendDebugLog({ iteration: iter, status: 'sim_error', message: e.message })
          break
        }

        // 2. Detect anomalies
        const anoms = detectAnomalies(curComponents, simRes)
        if (!anoms.length) {
          appendDebugLog({ iteration: iter, status: 'clean', message: 'No anomalies — circuit is healthy!' })
          break
        }
        appendDebugLog({ iteration: iter, status: 'anomalies', anomalies: anoms })

        // 3. Ask LLM
        setStreaming(true)
        setStreamText('')
        let fixObj = null
        try {
          const raw = await requestDebugFix(
            curComponents, wires, simRes, anoms,
            (_, acc) => setStreamText(acc),
            abortRef.current.signal,
          )
          fixObj = parseFixJson(raw)
        } catch (e) {
          if (e.name === 'AbortError') break
          appendDebugLog({ iteration: iter, status: 'llm_error', message: e.message })
          break
        } finally {
          setStreaming(false)
          setStreamText('')
        }

        if (!fixObj?.fixes?.length) {
          appendDebugLog({ iteration: iter, status: 'no_fix', diagnosis: fixObj?.diagnosis })
          break
        }

        appendDebugLog({ iteration: iter, status: 'fixing', diagnosis: fixObj.diagnosis, fixes: fixObj.fixes })

        // 4. Apply fixes (imperatively update local copy + store)
        fixObj.fixes.forEach(f => applyFix(f))

        // Rebuild curComponents from store after applying
        curComponents = useStore.getState().components
      }
    } finally {
      setAutoDebugRunning(false)
    }
  }, [components, wires, applyFix, appendDebugLog, clearDebugLog,
      setAutoDebugRunning, setSimResult])

  const stop = () => {
    abortRef.current?.abort()
    setAutoDebugRunning(false)
    setStreaming(false)
  }

  // ── Styles ────────────────────────────────────────────────────────────────
  const BTN = (extra = {}) => ({
    padding: '5px 12px', borderRadius: 5, border: 'none', cursor: 'pointer',
    fontFamily: 'monospace', fontSize: 12, fontWeight: 600, ...extra,
  })

  return (
    <div style={{
      width: 420, background: '#0a0f1a', color: '#e2e8f0',
      borderLeft: '1px solid #1e293b', display: 'flex', flexDirection: 'column',
      fontFamily: 'monospace', fontSize: 12, flexShrink: 0, overflowY: 'auto',
    }}>
      {/* Header */}
      <div style={{
        height: 40, display: 'flex', alignItems: 'center', padding: '0 12px',
        background: '#0f172a', borderBottom: '1px solid #1e293b', gap: 8,
        flexShrink: 0,
      }}>
        <span style={{ fontSize: 16 }}>🧠</span>
        <span style={{ fontWeight: 700, color: '#a78bfa', fontSize: 14 }}>AI Auto-Debug</span>
        <span style={{ fontSize: 10, color: '#475569', marginLeft: 4 }}>{DEBUG_MODEL}</span>
        <div style={{ flex: 1 }} />
        <button onClick={onClose} style={{ ...BTN(), background: 'transparent', color: '#64748b', fontSize: 16, padding: '2px 6px' }}>✕</button>
      </div>

      <div style={{ flex: 1, padding: 10, display: 'flex', flexDirection: 'column', gap: 10 }}>

        {/* Anomaly detector */}
        <div style={{ background: '#0f172a', borderRadius: 7, padding: 10, border: '1px solid #1e293b' }}>
          <div style={{ color: '#64748b', fontSize: 10, marginBottom: 6 }}>
            CIRCUIT HEALTH — {anomalies.length === 0 ? '✅ No issues detected' : `${anomalies.length} issue${anomalies.length > 1 ? 's' : ''} found`}
          </div>
          {anomalies.length === 0 && simResult && (
            <div style={{ color: '#4ade80', fontSize: 11 }}>Simulation looks correct. All LEDs, nodes and currents within expected ranges.</div>
          )}
          {anomalies.length === 0 && !simResult && (
            <div style={{ color: '#475569', fontSize: 11 }}>Run a simulation first (Simulate button in the right panel).</div>
          )}
          {anomalies.map((a, i) => {
            const s = SEV[a.severity] || SEV.info
            return (
              <div key={i} style={{
                background: s.bg, border: `1px solid ${s.border}`,
                borderRadius: 5, padding: '5px 8px', marginBottom: 5,
                display: 'flex', gap: 6, alignItems: 'flex-start',
              }}>
                <span style={{ color: s.dot, fontSize: 9, marginTop: 2, flexShrink: 0 }}>●</span>
                <span style={{ color: s.text, lineHeight: 1.4 }}>{a.detail}</span>
              </div>
            )
          })}
        </div>

        {/* Mode toggle + action buttons */}
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          <button
            onClick={() => setAutoMode(v => !v)}
            style={{ ...BTN(), background: autoMode ? '#4f46e5' : '#1e293b', color: autoMode ? '#fff' : '#94a3b8', border: '1px solid #334155' }}
          >
            {autoMode ? '🤖 Auto mode ON' : '🤖 Auto mode'}
          </button>

          {!autoMode && (
            <button
              onClick={runOnce}
              disabled={streaming || !anomalies.length || !simResult}
              style={{ ...BTN(), background: anomalies.length && simResult ? '#7c3aed' : '#1e293b', color: '#fff', opacity: (streaming || !anomalies.length || !simResult) ? 0.5 : 1 }}
            >
              {streaming ? '⏳ Thinking…' : '🔍 Ask AI to Fix'}
            </button>
          )}

          {autoMode && !autoDebugRunning && (
            <button
              onClick={runAuto}
              disabled={!components.length}
              style={{ ...BTN(), background: '#7c3aed', color: '#fff', opacity: !components.length ? 0.5 : 1 }}
            >
              ▶ Run Auto-Fix Loop
            </button>
          )}

          {(autoDebugRunning || streaming) && (
            <button onClick={stop} style={{ ...BTN(), background: '#dc2626', color: '#fff' }}>
              ■ Stop
            </button>
          )}
        </div>

        {/* Streaming output */}
        {streamText && (
          <div style={{
            background: '#0f172a', border: '1px solid #312e81', borderRadius: 6,
            padding: 8, maxHeight: 160, overflowY: 'auto',
            color: '#c4b5fd', fontSize: 11, lineHeight: 1.5, whiteSpace: 'pre-wrap',
          }}>
            <div style={{ color: '#6d28d9', fontSize: 10, marginBottom: 4 }}>
              ⟡ {DEBUG_MODEL} is thinking…
            </div>
            {streamText}
          </div>
        )}

        {/* Parse error */}
        {parseError && (
          <div style={{
            background: '#450a0a', border: '1px solid #dc2626', borderRadius: 6,
            padding: 8, color: '#fca5a5', fontSize: 11,
          }}>
            {parseError}
          </div>
        )}

        {/* Pending fix card */}
        {pendingFix && !autoMode && (
          <div style={{
            background: '#0f172a', border: '1px solid #6d28d9', borderRadius: 7, padding: 10,
          }}>
            <div style={{ color: '#a78bfa', fontWeight: 700, marginBottom: 6, fontSize: 13 }}>
              🔧 Fix Plan — confidence {Math.round((pendingFix.confidence || 0.8)*100)}%
            </div>
            <div style={{ color: '#c4b5fd', marginBottom: 8, lineHeight: 1.5 }}>
              {pendingFix.diagnosis}
            </div>
            {(pendingFix.fixes || []).map((f, i) => (
              <div key={i} style={{
                background: '#1e1040', borderRadius: 5, padding: '5px 8px', marginBottom: 4,
                border: '1px solid #4c1d95',
              }}>
                <span style={{ color: '#818cf8', marginRight: 6 }}>
                  {f.action === 'change_param' ? '⚙' :
                   f.action === 'add_wire' ? '🔌' :
                   f.action === 'add_component' ? '➕' :
                   f.action === 'remove_component' || f.action === 'remove_wire' ? '🗑' : '•'}
                </span>
                <span style={{ color: '#ddd6fe' }}>
                  {f.action === 'change_param' && `${f.component_id}.${f.param} → ${f.value}`}
                  {f.action === 'add_wire' && `Wire: ${f.from?.col}${f.from?.row} → ${f.to?.col}${f.to?.row}`}
                  {f.action === 'add_component' && `Add ${f.type}: ${f.pin1?.col}${f.pin1?.row}`}
                  {f.action === 'remove_component' && `Remove ${f.component_id}`}
                  {f.action === 'remove_wire' && `Remove wire ${f.wire_id}`}
                </span>
                <div style={{ color: '#6d28d9', fontSize: 10, marginTop: 2 }}>{f.reason}</div>
              </div>
            ))}
            {pendingFix.expected_after_fix && (
              <div style={{ color: '#4ade80', fontSize: 10, marginTop: 4 }}>
                Expected: {pendingFix.expected_after_fix}
              </div>
            )}
            <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
              <button
                onClick={() => applyAll(pendingFix)}
                style={{ ...BTN(), background: '#16a34a', color: '#fff', flex: 1 }}
              >
                ✓ Apply All Fixes
              </button>
              <button
                onClick={() => setPendingFix(null)}
                style={{ ...BTN(), background: '#1e293b', color: '#94a3b8', border: '1px solid #334155' }}
              >
                Skip
              </button>
            </div>
          </div>
        )}

        {/* Auto-debug log */}
        {autoDebugLog.length > 0 && (
          <div style={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: 7, padding: 8 }}>
            <div style={{ color: '#64748b', fontSize: 10, marginBottom: 6 }}>
              AUTO-DEBUG LOG &nbsp;
              <span
                onClick={clearDebugLog}
                style={{ color: '#475569', cursor: 'pointer', textDecoration: 'underline' }}
              >clear</span>
            </div>
            {autoDebugLog.map((entry, i) => (
              <div key={i} style={{ marginBottom: 6, fontSize: 11 }}>
                <span style={{ color: '#475569' }}>#{entry.iteration} </span>
                {entry.status === 'simulating' && <span style={{ color: '#60a5fa' }}>⟳ Simulating…</span>}
                {entry.status === 'sim_error'  && <span style={{ color: '#f87171' }}>✗ Sim error: {entry.message}</span>}
                {entry.status === 'clean'      && <span style={{ color: '#4ade80' }}>✅ {entry.message}</span>}
                {entry.status === 'no_fix'     && <span style={{ color: '#fbbf24' }}>⚠ LLM found no fix: {entry.diagnosis}</span>}
                {entry.status === 'llm_error'  && <span style={{ color: '#f87171' }}>✗ LLM error: {entry.message}</span>}
                {entry.status === 'anomalies' && (
                  <span style={{ color: '#f59e0b' }}>
                    ⚠ {entry.anomalies.length} anomal{entry.anomalies.length > 1 ? 'ies' : 'y'}
                  </span>
                )}
                {entry.status === 'fixing' && (
                  <div>
                    <span style={{ color: '#a78bfa' }}>🔧 Applying {entry.fixes?.length} fix{entry.fixes?.length > 1 ? 'es' : ''}</span>
                    <div style={{ color: '#6d28d9', fontSize: 10, marginLeft: 12 }}>{entry.diagnosis}</div>
                    {(entry.fixes || []).map((f, j) => (
                      <div key={j} style={{ color: '#4c1d95', fontSize: 10, marginLeft: 12 }}>
                        • {f.action}: {f.reason}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
            {autoDebugRunning && (
              <div style={{ color: '#6d28d9', fontSize: 10 }}>
                ⟡ Running… (max {MAX_AUTO_ITERATIONS} iterations)
              </div>
            )}
          </div>
        )}

        {/* Info footer */}
        <div style={{ color: '#334155', fontSize: 10, marginTop: 'auto', paddingTop: 8, borderTop: '1px solid #1e293b' }}>
          Anomaly detection is deterministic. LLM fixes are AI-generated — review before applying in Auto mode.
          Model: {DEBUG_MODEL}
        </div>
      </div>
    </div>
  )
}
