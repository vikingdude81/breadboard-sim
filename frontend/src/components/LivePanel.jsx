/**
 * Live Bench — hardware-in-the-loop.
 *
 * Connects to the XIAO over USB (Web Serial), overlays the measured A0 voltage
 * on the simulated node, and runs a live entropy lab on the raw ADC stream so
 * you can validate the QRNG layout *and* its real entropy on the bench.
 */
import { useState, useRef, useEffect, useCallback } from 'react'
import useStore from '../store'
import { serialSupported, openSerial, startReader, entropyMetrics } from '../serial'

const WINDOW = 8192          // samples kept for stats
const NBINS  = 64
const UI_MS  = 250           // metric/redraw cadence

function Histogram({ counts, max }) {
  const ref = useRef(null)
  useEffect(() => {
    const cv = ref.current; if (!cv) return
    const ctx = cv.getContext('2d'); const W = cv.width, H = cv.height
    ctx.clearRect(0, 0, W, H); ctx.fillStyle = '#0f172a'; ctx.fillRect(0, 0, W, H)
    if (!max) { ctx.fillStyle = '#475569'; ctx.font = '11px monospace'; ctx.fillText('waiting for samples…', 8, H / 2); return }
    const bw = W / counts.length
    for (let i = 0; i < counts.length; i++) {
      const h = (counts[i] / max) * (H - 6)
      ctx.fillStyle = '#22d3ee'
      ctx.fillRect(i * bw, H - h, Math.max(1, bw - 1), h)
    }
    ctx.fillStyle = '#64748b'; ctx.font = '9px monospace'
    ctx.fillText('0', 2, H - 2); ctx.fillText('4095', W - 26, H - 2)
  }, [counts, max])
  return <canvas ref={ref} width={420} height={90}
                 style={{ width: '100%', height: 90, display: 'block', borderRadius: 4 }} />
}

export default function LivePanel({ onClose }) {
  const simResult = useStore(s => s.simResult)
  const nodeMap = useStore(s => s.nodeMap)

  const [connected, setConnected] = useState(false)
  const [connErr, setConnErr] = useState(null)
  const [node, setNode] = useState('LE8')      // simulated node A0 maps to
  const [vcc, setVcc] = useState('3.3')
  const [lsbBits, setLsbBits] = useState(1)
  const [stats, setStats] = useState(null)     // {meanV, ppV, metrics, counts, max, rate}

  const stopRef = useRef(null)
  const ringRef = useRef(new Int32Array(WINDOW))
  const headRef = useRef(0)
  const countRef = useRef(0)
  const pendingRef = useRef([])
  const totalRef = useRef(0)
  const lastTickRef = useRef(0)

  const onLine = useCallback((line) => {
    const v = parseInt(line, 10)
    if (!Number.isNaN(v)) pendingRef.current.push(v)
  }, [])

  // Drain pending → ring, recompute metrics, on a fixed cadence.
  useEffect(() => {
    const id = setInterval(() => {
      const pend = pendingRef.current
      if (pend.length) {
        const ring = ringRef.current
        for (const s of pend) {
          ring[headRef.current] = s
          headRef.current = (headRef.current + 1) % WINDOW
          countRef.current = Math.min(countRef.current + 1, WINDOW)
        }
        totalRef.current += pend.length
        pendingRef.current = []
      }
      const count = countRef.current
      if (!count) return

      // Sample rate estimate
      const now = performance.now()
      const dt = lastTickRef.current ? (now - lastTickRef.current) / 1000 : 0
      lastTickRef.current = now

      // Rebuild window in chronological order
      const head = headRef.current
      const ordered = new Int32Array(count)
      for (let i = 0; i < count; i++) ordered[i] = ringRef.current[(head - count + i + WINDOW) % WINDOW]

      let sum = 0, mn = 4095, mx = 0
      const counts = new Array(NBINS).fill(0)
      for (let i = 0; i < count; i++) {
        const s = ordered[i]
        sum += s; if (s < mn) mn = s; if (s > mx) mx = s
        counts[Math.min(NBINS - 1, (s * NBINS) >> 12)]++
      }
      const k = parseFloat(vcc) / 4095
      const metrics = entropyMetrics(ordered, lsbBits)
      setStats({
        meanV: (sum / count) * k,
        ppV: (mx - mn) * k,
        counts, max: Math.max(...counts),
        metrics,
        rate: dt ? Math.round(pend.length / dt) : 0,
      })
    }, UI_MS)
    return () => clearInterval(id)
  }, [vcc, lsbBits])

  const connect = useCallback(async () => {
    setConnErr(null)
    try {
      const port = await openSerial(460800)
      headRef.current = 0; countRef.current = 0; totalRef.current = 0; pendingRef.current = []
      stopRef.current = startReader(port, onLine, (e) => setConnErr(e.message))
      setConnected(true)
    } catch (e) {
      if (e.name !== 'NotFoundError') setConnErr(e.message)  // NotFoundError = user cancelled picker
    }
  }, [onLine])

  const disconnect = useCallback(async () => {
    if (stopRef.current) { await stopRef.current(); stopRef.current = null }
    setConnected(false)
  }, [])

  useEffect(() => () => { if (stopRef.current) stopRef.current() }, [])

  const simV = simResult?.node_voltages?.[nodeMap(node)]
  const measV = stats?.meanV
  const delta = (simV !== undefined && measV !== undefined) ? measV - simV : undefined
  const matched = delta !== undefined && Math.abs(delta) < 0.15

  const card = { background: '#1e293b', borderRadius: 6, padding: 8 }
  const lblS = { color: '#64748b', fontSize: 10, marginBottom: 6 }
  const inp = { background: '#0f172a', border: '1px solid #334155', color: '#e2e8f0',
                borderRadius: 3, padding: '2px 5px', width: 56 }

  return (
    <div style={{ width: 460, background: '#0f172a', color: '#e2e8f0',
                  borderLeft: '1px solid #1e293b', display: 'flex', flexDirection: 'column',
                  fontFamily: 'monospace', fontSize: 12, flexShrink: 0 }}>
      <div style={{ height: 36, display: 'flex', alignItems: 'center', padding: '0 12px',
                    background: '#1e293b', borderBottom: '1px solid #334155', gap: 8, flexShrink: 0 }}>
        <span style={{ fontSize: 14 }}>🔌</span>
        <span style={{ fontWeight: 700, color: '#22d3ee' }}>Live Bench</span>
        <span style={{ width: 8, height: 8, borderRadius: 4,
                       background: connected ? '#22c55e' : '#64748b',
                       boxShadow: connected ? '0 0 6px 2px #16a34a' : 'none' }} />
        <div style={{ flex: 1 }} />
        <button onClick={onClose} style={{ background: 'transparent', border: 'none',
                color: '#e2e8f0', cursor: 'pointer', fontSize: 14 }}>✕</button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: 10, display: 'flex', flexDirection: 'column', gap: 10 }}>
        {!serialSupported() && (
          <div style={{ background: '#450a0a', border: '1px solid #dc2626', borderRadius: 6,
                        padding: 8, color: '#fca5a5', fontSize: 11 }}>
            Web Serial isn't available in this browser. Use Chrome or Edge.
          </div>
        )}

        <div style={{ display: 'flex', gap: 6 }}>
          {!connected ? (
            <button onClick={connect} style={{ flex: 1, padding: '7px', borderRadius: 6, border: 'none',
                    cursor: 'pointer', background: '#1d4ed8', color: '#fff', fontWeight: 700 }}>
              🔌 Connect XIAO
            </button>
          ) : (
            <button onClick={disconnect} style={{ flex: 1, padding: '7px', borderRadius: 6, border: 'none',
                    cursor: 'pointer', background: '#7f1d1d', color: '#fecaca', fontWeight: 700 }}>
              ⏹ Disconnect
            </button>
          )}
        </div>
        {connErr && <div style={{ color: '#fca5a5', fontSize: 11 }}>{connErr}</div>}

        {/* Measured vs simulated */}
        <div style={card}>
          <div style={lblS}>MEASURED vs SIMULATED</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
            <span style={{ color: '#94a3b8' }}>A0 → node</span>
            <input value={node} onChange={e => setNode(e.target.value.toUpperCase())} style={inp} />
            <span style={{ color: '#94a3b8' }}>Vcc</span>
            <input value={vcc} onChange={e => setVcc(e.target.value)} style={{ ...inp, width: 44 }} />
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <Stat label="measured" value={measV !== undefined ? measV.toFixed(3) + ' V' : '—'} color="#22d3ee" />
            <Stat label="simulated" value={simV !== undefined ? simV.toFixed(3) + ' V' : 'run sim'} color="#a78bfa" />
            <Stat label="Δ"
                  value={delta !== undefined ? (delta >= 0 ? '+' : '') + delta.toFixed(3) + ' V' : '—'}
                  color={delta === undefined ? '#64748b' : matched ? '#22c55e' : '#f59e0b'} />
          </div>
          {delta !== undefined && (
            <div style={{ marginTop: 6, fontSize: 11, color: matched ? '#22c55e' : '#f59e0b' }}>
              {matched ? '✓ matches simulation — wiring looks correct'
                       : '⚠ off from sim — check the part value or a wire'}
            </div>
          )}
        </div>

        {/* Entropy lab */}
        <div style={card}>
          <div style={{ ...lblS, display: 'flex', alignItems: 'center' }}>
            ENTROPY LAB
            <div style={{ flex: 1 }} />
            <span style={{ color: '#94a3b8' }}>LSBs</span>
            <select value={lsbBits} onChange={e => setLsbBits(parseInt(e.target.value))}
                    style={{ ...inp, width: 40, marginLeft: 4 }}>
              <option value={1}>1</option>
              <option value={2}>2</option>
              <option value={3}>3</option>
            </select>
          </div>
          <Histogram counts={stats?.counts ?? new Array(NBINS).fill(0)} max={stats?.max ?? 0} />
          {stats?.metrics && (
            <>
              <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                <Stat label="min-entropy/bit"
                      value={stats.metrics.minEntropyPerBit.toFixed(3)}
                      color={stats.metrics.minEntropyPerBit >= 0.95 ? '#22c55e' : '#f59e0b'} />
                <Stat label="Shannon/bit" value={stats.metrics.shannonPerBit.toFixed(3)} color="#22d3ee" />
                <Stat label="bias" value={(stats.metrics.bias * 100).toFixed(2) + '%'}
                      color={stats.metrics.bias < 0.02 ? '#22c55e' : '#f59e0b'} />
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
                <Stat label="VN bits/sample" value={stats.metrics.vnBitsPerSample.toFixed(3)} color="#a78bfa" />
                <Stat label="window" value={stats.metrics.n.toLocaleString()} color="#94a3b8" />
                <Stat label="rate" value={stats.rate ? stats.rate.toLocaleString() + '/s' : '—'} color="#94a3b8" />
              </div>
              <div style={{ marginTop: 8, fontSize: 10, color: '#64748b', lineHeight: 1.5 }}>
                min-entropy is the QRNG-relevant metric (worst-case bits/sample). Aim for ≥0.95
                after the analog stage; pipe the stream through von&nbsp;Neumann / XOR whitening on the XIAO.
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function Stat({ label, value, color }) {
  return (
    <div style={{ flex: 1, minWidth: 84, background: '#0f172a', borderRadius: 4, padding: '5px 7px' }}>
      <div style={{ fontSize: 9, color: '#64748b' }}>{label}</div>
      <div style={{ fontSize: 14, fontWeight: 700, color }}>{value}</div>
    </div>
  )
}
