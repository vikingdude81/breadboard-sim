/**
 * AI Auto-Debug panel — detects circuit anomalies, asks Gemma 4 for fixes,
 * applies them with one click, and optionally loops autonomously until clean.
 *
 * LLM: google/gemma-4-26b-a4b @ http://192.168.50.150:1234
 */
import { useState, useRef, useCallback, useEffect } from 'react'
import useStore, { nextId, posToNode } from '../store'
import {
  detectAnomalies, requestDebugFix, parseFixJson,
  DEBUG_MODEL,
} from '../llm'

const API             = 'http://localhost:8000'
const MAX_AUTO_ITERS  = 6
const LLM_TIMEOUT_MS  = 60000   // 60s before giving up on one LLM call
const SIM_TIMEOUT_MS  = 15000   // 15s for simulation

// ── Severity colours ──────────────────────────────────────────────────────────
const SEV = {
  error:   { bg: '#450a0a', border: '#dc2626', text: '#fca5a5', dot: '#ef4444' },
  warning: { bg: '#422006', border: '#d97706', text: '#fcd34d', dot: '#f59e0b' },
  info:    { bg: '#0c1a2e', border: '#3b82f6', text: '#93c5fd', dot: '#60a5fa' },
}

// ── Apply a single fix action to the store (called imperatively) ──────────────
function applyFixToStore(fix) {
  const store = useStore.getState()
  switch (fix.action) {
    case 'change_param':
      store.changeParam(fix.component_id, fix.param, fix.value)
      break
    case 'remove_component':
      store.removeComponent(fix.component_id)
      break
    case 'remove_wire':
      store.removeWire(fix.wire_id)
      break
    case 'add_wire': {
      store.addWire({
        id: nextId('W'),
        from: fix.from, to: fix.to,
        fromNode: posToNode(fix.from.col, fix.from.row),
        toNode:   posToNode(fix.to.col,   fix.to.row),
        color: fix.color || '#6366f1',
      })
      break
    }
    case 'add_component': {
      const pin1 = fix.pin1
      const pin2 = fix.pin2 || { col: pin1.col, row: pin1.row + 2 }
      store.addComponent({
        id:     nextId(fix.type?.[0]?.toUpperCase() || 'X'),
        type:   fix.type,
        label:  fix.label || fix.type,
        params: fix.params || {},
        pin1, pin2,
        nodes:  fix.nodes || {
          p: posToNode(pin1.col, pin1.row),
          n: posToNode(pin2.col, pin2.row),
        },
      })
      break
    }
    default:
      console.warn('Unknown fix action:', fix.action)
  }
}

// ── Fetch simulation with timeout ─────────────────────────────────────────────
async function runSimulate(components, timeoutMs = SIM_TIMEOUT_MS) {
  const ctrl = new AbortController()
  const tid  = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(`${API}/simulate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: ctrl.signal,
      body: JSON.stringify({
        components: components.map(c => ({
          id: c.id, type: c.type, params: c.params, nodes: c.nodes,
        })),
      }),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: res.statusText }))
      throw new Error(err.detail || 'Simulation failed')
    }
    return res.json()
  } finally {
    clearTimeout(tid)
  }
}

// ── LLM call with hard timeout ────────────────────────────────────────────────
async function askLLMWithTimeout(comps, wires, simRes, anoms, onChunk, parentSignal) {
  // Race: parent abort OR 60-second timeout
  const timeoutCtrl = new AbortController()
  const tid = setTimeout(() => timeoutCtrl.abort(), LLM_TIMEOUT_MS)

  // Combine signals manually (AbortSignal.any not universally supported)
  const combined = new AbortController()
  const propagate = () => combined.abort()
  parentSignal?.addEventListener('abort', propagate)
  timeoutCtrl.signal.addEventListener('abort', propagate)

  try {
    return await requestDebugFix(comps, wires, simRes, anoms, onChunk, combined.signal)
  } finally {
    clearTimeout(tid)
    parentSignal?.removeEventListener('abort', propagate)
    timeoutCtrl.signal.removeEventListener('abort', propagate)
  }
}

// ── Reset all stuck state (safe to call from anywhere) ───────────────────────
function forceReset() {
  useStore.getState().setAutoDebugRunning(false)
}

// ── Main panel ────────────────────────────────────────────────────────────────
export default function AutoDebug({ onClose }) {
  const components      = useStore(s => s.components)
  const wires           = useStore(s => s.wires)
  const simResult       = useStore(s => s.simResult)
  const setSimResult    = useStore(s => s.setSimResult)
  const autoDebugLog    = useStore(s => s.autoDebugLog)
  const autoDebugRunning= useStore(s => s.autoDebugRunning)
  const appendDebugLog  = useStore(s => s.appendDebugLog)
  const clearDebugLog   = useStore(s => s.clearDebugLog)
  const setAutoDebugRunning = useStore(s => s.setAutoDebugRunning)

  const [streaming, setStreaming]   = useState(false)
  const [streamText, setStreamText] = useState('')
  const [pendingFix, setPendingFix] = useState(null)
  const [parseError, setParseError] = useState(null)
  const [elapsed, setElapsed]       = useState(0)

  const abortRef    = useRef(null)
  const timerRef    = useRef(null)
  const runningRef  = useRef(false)   // sync flag to break loop without stale closure

  // Elapsed timer while auto-loop or LLM is active
  useEffect(() => {
    if (autoDebugRunning || streaming) {
      timerRef.current = setInterval(() => setElapsed(e => e + 1), 1000)
    } else {
      clearInterval(timerRef.current)
      setElapsed(0)
    }
    return () => clearInterval(timerRef.current)
  }, [autoDebugRunning, streaming])

  const anomalies = detectAnomalies(components, simResult)

  // ── Stop everything ─────────────────────────────────────────────────────────
  const stop = useCallback(() => {
    runningRef.current = false
    abortRef.current?.abort()
    setAutoDebugRunning(false)
    setStreaming(false)
    setStreamText('')
  }, [setAutoDebugRunning])

  // ── Manual single-shot: simulate if needed, then ask LLM ────────────────────
  const runOnce = useCallback(async () => {
    if (!components.length) return

    setStreaming(true)
    setStreamText('')
    setPendingFix(null)
    setParseError(null)
    abortRef.current = new AbortController()

    try {
      // Always simulate fresh so fixes are based on current state
      let simRes = simResult
      try {
        setStreamText('⟳ Simulating circuit…')
        simRes = await runSimulate(components)
        setSimResult(simRes)
      } catch (e) {
        setParseError(`Simulation failed: ${e.message}`)
        return
      }
      setStreamText('')

      const anoms = detectAnomalies(components, simRes)
      if (!anoms.length) {
        setParseError('No anomalies detected — circuit looks healthy!')
        return
      }

      const raw = await askLLMWithTimeout(
        components, wires, simRes, anoms,
        (_, acc) => setStreamText(acc),
        abortRef.current.signal,
      )
      try {
        setPendingFix(parseFixJson(raw))
      } catch {
        setParseError(`Could not parse AI response as JSON.\n\nRaw response:\n${raw.slice(0, 500)}`)
      }
    } catch (e) {
      if (e.name !== 'AbortError') setParseError(e.message)
    } finally {
      setStreaming(false)
    }
  }, [components, wires, simResult, setSimResult])

  // ── Apply pending fix and optionally re-simulate ────────────────────────────
  const applyAll = useCallback((fixObj) => {
    ;(fixObj?.fixes || []).forEach(applyFixToStore)
    setPendingFix(null)
    setStreamText('')
  }, [])

  // ── Autonomous loop ──────────────────────────────────────────────────────────
  const runAuto = useCallback(async () => {
    runningRef.current = true
    setAutoDebugRunning(true)
    clearDebugLog()
    setStreamText('')
    setPendingFix(null)
    setParseError(null)
    abortRef.current = new AbortController()

    try {
      for (let iter = 1; iter <= MAX_AUTO_ITERS; iter++) {
        if (!runningRef.current) break

        // Read latest components/wires each iteration (no stale closure)
        const curComps  = useStore.getState().components
        const curWires  = useStore.getState().wires

        appendDebugLog({ iteration: iter, status: 'simulating' })

        // 1. Simulate
        let simRes
        try {
          simRes = await runSimulate(curComps)
          setSimResult(simRes)
          useStore.getState().setSimResult(simRes)
        } catch (e) {
          const msg = e.name === 'AbortError' ? 'Simulation timed out' : e.message
          appendDebugLog({ iteration: iter, status: 'sim_error', message: msg })
          break
        }

        if (!runningRef.current) break

        // 2. Detect anomalies
        const anoms = detectAnomalies(curComps, simRes)
        if (!anoms.length) {
          appendDebugLog({ iteration: iter, status: 'clean', message: 'No anomalies — circuit is healthy!' })
          break
        }
        appendDebugLog({ iteration: iter, status: 'anomalies', anomalies: anoms })

        // 3. Ask LLM (with 60s timeout)
        let fixObj = null
        try {
          const raw = await askLLMWithTimeout(
            curComps, curWires, simRes, anoms,
            (_, acc) => setStreamText(acc),
            abortRef.current.signal,
          )
          setStreamText('')
          try {
            fixObj = parseFixJson(raw)
          } catch {
            appendDebugLog({ iteration: iter, status: 'llm_error', message: `JSON parse failed. Response: ${raw.slice(0, 200)}` })
            break
          }
        } catch (e) {
          const msg = e.name === 'AbortError' ? 'LLM timed out (60s)' : e.message
          appendDebugLog({ iteration: iter, status: 'llm_error', message: msg })
          break
        }

        if (!runningRef.current) break

        if (!fixObj?.fixes?.length) {
          appendDebugLog({ iteration: iter, status: 'no_fix', diagnosis: fixObj?.diagnosis || 'No fixes returned' })
          break
        }

        appendDebugLog({ iteration: iter, status: 'fixing', diagnosis: fixObj.diagnosis, fixes: fixObj.fixes })

        // 4. Apply fixes directly via store
        fixObj.fixes.forEach(applyFixToStore)
      }
    } catch (e) {
      appendDebugLog({ iteration: 0, status: 'llm_error', message: `Unexpected: ${e.message}` })
    } finally {
      runningRef.current = false
      // Always use getState() here — never the stale closure version
      useStore.getState().setAutoDebugRunning(false)
      setStreaming(false)
      setStreamText('')
    }
  }, [appendDebugLog, clearDebugLog, setSimResult, setAutoDebugRunning])

  // ── UI helpers ────────────────────────────────────────────────────────────
  const BTN = (extra = {}) => ({
    padding: '5px 12px', borderRadius: 5, border: 'none', cursor: 'pointer',
    fontFamily: 'monospace', fontSize: 12, fontWeight: 600, ...extra,
  })

  const busy = autoDebugRunning || streaming

  return (
    <div style={{
      width: 420, background: '#0a0f1a', color: '#e2e8f0',
      borderLeft: '1px solid #1e293b', display: 'flex', flexDirection: 'column',
      fontFamily: 'monospace', fontSize: 12, flexShrink: 0,
    }}>
      {/* Header */}
      <div style={{
        height: 40, display: 'flex', alignItems: 'center', padding: '0 12px',
        background: '#0f172a', borderBottom: '1px solid #1e293b', gap: 8, flexShrink: 0,
      }}>
        <span style={{ fontSize: 16 }}>🧠</span>
        <span style={{ fontWeight: 700, color: '#a78bfa', fontSize: 14 }}>AI Auto-Debug</span>
        <span style={{ fontSize: 10, color: '#334155' }}>{DEBUG_MODEL}</span>
        <div style={{ flex: 1 }} />
        {busy && (
          <span style={{ fontSize: 10, color: '#f59e0b' }}>
            ⟳ {elapsed}s
          </span>
        )}
        <button onClick={onClose}
          style={{ ...BTN(), background: 'transparent', color: '#64748b', fontSize: 16, padding: '2px 6px' }}>
          ✕
        </button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: 10, display: 'flex', flexDirection: 'column', gap: 10 }}>

        {/* Anomaly list */}
        <div style={{ background: '#0f172a', borderRadius: 7, padding: 10, border: '1px solid #1e293b' }}>
          <div style={{ color: '#64748b', fontSize: 10, marginBottom: 6 }}>
            CIRCUIT HEALTH &nbsp;
            {anomalies.length === 0
              ? <span style={{ color: '#4ade80' }}>✅ No issues{simResult ? '' : ' — run simulation first'}</span>
              : <span style={{ color: '#f87171' }}>⚠ {anomalies.length} issue{anomalies.length > 1 ? 's' : ''} found</span>
            }
          </div>
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

        {/* Action buttons */}
        {!busy ? (
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              onClick={runOnce}
              disabled={!components.length}
              style={{ ...BTN(), flex: 1, background: components.length ? '#7c3aed' : '#1e293b', color: '#fff', opacity: components.length ? 1 : 0.5 }}
            >
              🔍 Ask AI to Fix
            </button>
            <button
              onClick={runAuto}
              disabled={!components.length}
              style={{ ...BTN(), flex: 1, background: components.length ? '#4f46e5' : '#1e293b', color: '#fff', opacity: components.length ? 1 : 0.5 }}
            >
              🤖 Auto Loop
            </button>
          </div>
        ) : (
          <div style={{ display: 'flex', gap: 6 }}>
            <button onClick={stop}
              style={{ ...BTN(), flex: 1, background: '#dc2626', color: '#fff' }}>
              ■ Stop
            </button>
            {!busy && autoDebugRunning && (
              <button onClick={forceReset}
                style={{ ...BTN(), background: '#7f1d1d', color: '#fca5a5', fontSize: 10 }}>
                Force Reset
              </button>
            )}
          </div>
        )}

        {/* LLM stream output */}
        {streamText && (
          <div style={{
            background: '#0f172a', border: '1px solid #312e81', borderRadius: 6,
            padding: 8, maxHeight: 160, overflowY: 'auto',
            color: '#c4b5fd', fontSize: 11, lineHeight: 1.5, whiteSpace: 'pre-wrap',
          }}>
            <div style={{ color: '#6d28d9', fontSize: 10, marginBottom: 4 }}>
              ⟡ {DEBUG_MODEL} responding… (timeout {LLM_TIMEOUT_MS/1000}s)
            </div>
            {streamText}
          </div>
        )}

        {/* Error */}
        {parseError && (
          <div style={{
            background: '#450a0a', border: '1px solid #dc2626', borderRadius: 6,
            padding: 8, color: '#fca5a5', fontSize: 11,
            display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
          }}>
            <span>{parseError}</span>
            <span onClick={() => setParseError(null)} style={{ cursor: 'pointer', marginLeft: 8 }}>✕</span>
          </div>
        )}

        {/* Pending fix card */}
        {pendingFix && (
          <div style={{ background: '#0f172a', border: '1px solid #6d28d9', borderRadius: 7, padding: 10 }}>
            <div style={{ color: '#a78bfa', fontWeight: 700, marginBottom: 6 }}>
              🔧 Fix Plan &nbsp;
              <span style={{ color: '#6d28d9', fontWeight: 400 }}>
                confidence {Math.round((pendingFix.confidence || 0.8) * 100)}%
              </span>
            </div>
            <div style={{ color: '#c4b5fd', marginBottom: 8, lineHeight: 1.5 }}>
              {pendingFix.diagnosis}
            </div>
            {(pendingFix.fixes || []).map((f, i) => (
              <div key={i} style={{
                background: '#1e1040', borderRadius: 5, padding: '5px 8px',
                marginBottom: 4, border: '1px solid #4c1d95',
              }}>
                <span style={{ color: '#818cf8', marginRight: 6 }}>
                  {f.action === 'change_param' ? '⚙' :
                   f.action === 'add_wire' ? '🔌' :
                   f.action === 'add_component' ? '➕' : '🗑'}
                </span>
                <span style={{ color: '#ddd6fe' }}>
                  {f.action === 'change_param'    && `${f.component_id}.${f.param} → ${f.value}`}
                  {f.action === 'add_wire'        && `Wire ${f.from?.col}${f.from?.row} → ${f.to?.col}${f.to?.row}`}
                  {f.action === 'add_component'   && `Add ${f.type} @ ${f.pin1?.col}${f.pin1?.row}`}
                  {(f.action === 'remove_component' || f.action === 'remove_wire') && `Remove ${f.component_id || f.wire_id}`}
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
              <button onClick={() => applyAll(pendingFix)}
                style={{ ...BTN(), background: '#16a34a', color: '#fff', flex: 1 }}>
                ✓ Apply All Fixes
              </button>
              <button onClick={() => setPendingFix(null)}
                style={{ ...BTN(), background: '#1e293b', color: '#94a3b8', border: '1px solid #334155' }}>
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
              <span onClick={clearDebugLog} style={{ color: '#475569', cursor: 'pointer', textDecoration: 'underline' }}>
                clear
              </span>
            </div>
            {autoDebugLog.map((entry, i) => (
              <div key={i} style={{ marginBottom: 5, fontSize: 11 }}>
                <span style={{ color: '#334155' }}>#{entry.iteration} </span>
                {entry.status === 'simulating'  && <span style={{ color: '#60a5fa' }}>⟳ Simulating…</span>}
                {entry.status === 'sim_error'   && <span style={{ color: '#f87171' }}>✗ Sim: {entry.message}</span>}
                {entry.status === 'clean'       && <span style={{ color: '#4ade80' }}>✅ {entry.message}</span>}
                {entry.status === 'no_fix'      && <span style={{ color: '#fbbf24' }}>⚠ No fix: {entry.diagnosis}</span>}
                {entry.status === 'llm_error'   && <span style={{ color: '#f87171' }}>✗ LLM: {entry.message}</span>}
                {entry.status === 'anomalies'   && (
                  <span style={{ color: '#f59e0b' }}>⚠ {entry.anomalies.length} anomal{entry.anomalies.length > 1 ? 'ies' : 'y'} detected</span>
                )}
                {entry.status === 'fixing' && (
                  <div>
                    <span style={{ color: '#a78bfa' }}>🔧 {entry.fixes?.length} fix{entry.fixes?.length > 1 ? 'es' : ''} applied</span>
                    <div style={{ color: '#6d28d9', fontSize: 10, marginLeft: 10 }}>{entry.diagnosis}</div>
                  </div>
                )}
              </div>
            ))}
            {autoDebugRunning && (
              <div style={{ color: '#4f46e5', fontSize: 10, marginTop: 4 }}>
                ⟡ Running… (max {MAX_AUTO_ITERS} iterations, {LLM_TIMEOUT_MS/1000}s LLM timeout)
              </div>
            )}
          </div>
        )}

        <div style={{ color: '#1e293b', fontSize: 10, marginTop: 'auto', paddingTop: 8, borderTop: '1px solid #1e293b' }}>
          Model: {DEBUG_MODEL} · LLM timeout: {LLM_TIMEOUT_MS/1000}s · Sim timeout: {SIM_TIMEOUT_MS/1000}s
        </div>
      </div>
    </div>
  )
}
