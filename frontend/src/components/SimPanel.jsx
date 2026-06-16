import { useState } from 'react'
import useStore from '../store'

const API = 'http://localhost:8000'

export default function SimPanel() {
  const [tab, setTab] = useState('sim') // 'sim' | 'history'
  const {
    components, wires, history,
    simResult, simError, simLoading,
    setSimResult, setSimError, setSimLoading,
    buildSimRequest, clearBoard, undoLast, removeHistoryItem,
  } = useStore()

  const runSim = async () => {
    if (components.length === 0) {
      setSimError('No components placed. Add some first.')
      return
    }
    setSimLoading(true)
    try {
      const res = await fetch(`${API}/simulate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildSimRequest()),
      })
      if (!res.ok) {
        const err = await res.json()
        setSimError(err.detail || 'Simulation failed')
        return
      }
      setSimResult(await res.json())
    } catch (e) {
      setSimError(`Backend offline — run: uvicorn main:app --reload`)
    }
  }

  const handleQRNG = async () => {
    try {
      const { components: tplComps } = await (await fetch(`${API}/templates/zener-qrng`)).json()
      // Just run the template through simulate directly
      setSimLoading(true)
      const res = await fetch(`${API}/simulate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ components: tplComps }),
      })
      setSimResult(await res.json())
    } catch (e) {
      setSimError(`QRNG error: ${e.message}`)
    }
  }

  return (
    <div style={{
      width: 250, background: '#f9fafb', color: '#111827',
      display: 'flex', flexDirection: 'column',
      borderLeft: '1px solid #e5e7eb', fontSize: 12,
    }}>
      {/* Tab bar */}
      <div style={{ display: 'flex', borderBottom: '1px solid #e5e7eb', flexShrink: 0 }}>
        {['sim','history'].map(t => (
          <button key={t} onClick={() => setTab(t)} style={{
            flex: 1, padding: '9px 0', border: 'none', cursor: 'pointer',
            fontWeight: 600, fontSize: 12,
            background: tab === t ? '#fff' : '#f3f4f6',
            color: tab === t ? '#1d4ed8' : '#6b7280',
            borderBottom: tab === t ? '2px solid #1d4ed8' : '2px solid transparent',
          }}>
            {t === 'sim' ? 'Simulation' : `History (${history.length})`}
          </button>
        ))}
      </div>

      {/* ── SIM TAB ── */}
      {tab === 'sim' && (
        <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
          <div style={{ padding: 10, borderBottom: '1px solid #e5e7eb' }}>
            <button onClick={runSim} disabled={simLoading} style={btnStyle('#1d4ed8')}>
              {simLoading ? '⟳ Solving…' : '▶ Run Simulation'}
            </button>
            <button onClick={handleQRNG} style={btnStyle('#6d28d9', 6)}>
              ⚡ QRNG Simulate
            </button>
            <button onClick={clearBoard} style={btnStyle('#dc2626', 6)}>
              ✕ Clear Board
            </button>
          </div>

          <div style={{ padding: '6px 10px', color: '#6b7280', fontSize: 11,
                        borderBottom: '1px solid #e5e7eb' }}>
            {components.length} components · {wires.length} wires
          </div>

          {simError && (
            <div style={{ margin: 10, padding: 8, background: '#fef2f2',
                          border: '1px solid #fecaca', borderRadius: 4,
                          color: '#991b1b', fontSize: 11 }}>
              {simError}
            </div>
          )}

          {simResult ? (
            <div style={{ flex: 1, overflowY: 'auto', padding: 10 }}>
              <div style={{ fontWeight: 600, color: '#15803d', marginBottom: 8 }}>
                ✓ Converged
              </div>

              {Object.keys(simResult.led_states || {}).length > 0 && (
                <Section title="LED States">
                  {Object.entries(simResult.led_states).map(([id, s]) => (
                    <Row key={id}
                      label={id}
                      value={s.on ? `ON (${s.vd.toFixed(2)}V)` : `OFF (${s.vd.toFixed(2)}V)`}
                      color={s.on ? '#15803d' : '#9ca3af'}
                      dot={s.color}
                    />
                  ))}
                </Section>
              )}

              <Section title="Node Voltages">
                {Object.entries(simResult.node_voltages)
                  .filter(([n]) => n !== '0')
                  .sort(([a], [b]) => a.localeCompare(b))
                  .map(([node, v]) => (
                    <Row key={node} label={node} value={`${v.toFixed(4)} V`} />
                  ))}
              </Section>

              {Object.keys(simResult.branch_currents || {}).length > 0 && (
                <Section title="Branch Currents">
                  {Object.entries(simResult.branch_currents).map(([id, i]) => (
                    <Row key={id} label={id} value={`${(i * 1000).toFixed(3)} mA`} />
                  ))}
                </Section>
              )}
            </div>
          ) : !simError && (
            <div style={{ padding: 14, color: '#6b7280', fontSize: 11, lineHeight: 1.7 }}>
              <strong style={{ color: '#374151' }}>How to use:</strong><br />
              1. Pick a component from the palette<br />
              2. Click a board hole to place it<br />
              3. Click two holes to draw a wire<br />
              4. Press <kbd style={kbdStyle}>Esc</kbd> to cancel placement<br />
              5. Hit <strong>Run Simulation</strong><br />
              <br />
              <span style={{ color: '#6d28d9' }}>⚡ QRNG Simulate</span> runs the<br />
              Zener avalanche QRNG circuit directly.
            </div>
          )}
        </div>
      )}

      {/* ── HISTORY TAB ── */}
      {tab === 'history' && (
        <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
          <div style={{ padding: '8px 10px', borderBottom: '1px solid #e5e7eb',
                        display: 'flex', gap: 6 }}>
            <button onClick={undoLast} disabled={!history.length}
                    style={btnStyle('#374151')}>
              ↩ Undo Last
            </button>
          </div>

          {history.length === 0 ? (
            <div style={{ padding: 14, color: '#9ca3af', fontSize: 11 }}>
              No actions yet. Place components or draw wires to see history.
            </div>
          ) : (
            <div style={{ flex: 1, overflowY: 'auto' }}>
              {/* Most recent first */}
              {[...history].reverse().map((item, i) => (
                <HistoryItem key={item.id} item={item} onRemove={() => removeHistoryItem(item.id)} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function HistoryItem({ item, onRemove }) {
  const isWire = item.type === 'wire'
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 6,
      padding: '6px 10px', borderBottom: '1px solid #f3f4f6',
    }}>
      {/* Color swatch for wires */}
      <div style={{
        width: 10, height: 10, borderRadius: 2, flexShrink: 0,
        background: isWire ? (item.color || '#16a34a') : '#6b7280',
      }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: '#111827',
                      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {item.label}
        </div>
        <div style={{ fontSize: 10, color: '#9ca3af' }}>
          {isWire ? 'wire' : 'component'}
        </div>
      </div>
      <button onClick={onRemove} style={{
        border: 'none', background: 'none', cursor: 'pointer',
        color: '#dc2626', fontSize: 14, padding: '0 2px', lineHeight: 1,
        flexShrink: 0,
      }} title="Remove">✕</button>
    </div>
  )
}

function Section({ title, children }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ color: '#1d4ed8', fontWeight: 600, marginBottom: 4,
                    fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        {title}
      </div>
      {children}
    </div>
  )
}

function Row({ label, value, color, dot }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between',
                  padding: '3px 0', borderBottom: '1px solid #f3f4f6' }}>
      <span style={{ color: '#6b7280', display: 'flex', alignItems: 'center', gap: 4 }}>
        {dot && <span style={{
          display: 'inline-block', width: 8, height: 8, borderRadius: 4,
          background: dot === 'infrared' ? '#450a0a' : dot,
          border: '1px solid #d1d5db',
        }} />}
        {label}
      </span>
      <span style={{ color: color || '#111827', fontFamily: 'monospace', fontSize: 11 }}>
        {value}
      </span>
    </div>
  )
}

function btnStyle(bg, mt = 0) {
  return {
    display: 'block', width: '100%', padding: '7px 0',
    background: bg, color: 'white', border: 'none',
    borderRadius: 4, cursor: 'pointer', fontWeight: 600, fontSize: 12,
    marginTop: mt, opacity: 1,
  }
}

const kbdStyle = {
  background: '#f3f4f6', border: '1px solid #d1d5db',
  borderRadius: 3, padding: '1px 4px', fontSize: 10,
}
