/**
 * Oscilloscope panel — runs /simulate/transient and plots waveforms.
 * Users pick probe nodes by clicking board nodes or typing them manually.
 */
import { useState, useRef, useEffect, useCallback } from 'react'
import useStore from '../store'
import { computeNodeMap } from '../netlist'

const API = 'http://localhost:8000'

// Colour palette for traces
const TRACE_COLORS = [
  '#22c55e','#3b82f6','#f59e0b','#ef4444',
  '#a855f7','#06b6d4','#f97316','#ec4899',
]

// ── Canvas waveform renderer ──────────────────────────────────────────────────
function WaveformCanvas({ times, waveforms, height = 180 }) {
  const canvasRef = useRef(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    const W = canvas.width
    const H = height

    ctx.clearRect(0, 0, W, H)
    ctx.fillStyle = '#0f172a'
    ctx.fillRect(0, 0, W, H)

    const nodes = Object.keys(waveforms)
    if (!nodes.length || !times.length) {
      ctx.fillStyle = '#475569'
      ctx.font = '12px monospace'
      ctx.fillText('No data', 10, H/2)
      return
    }

    // Grid
    ctx.strokeStyle = '#1e3a5f'
    ctx.lineWidth = 1
    for (let i = 0; i <= 4; i++) {
      const y = (H/4)*i
      ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(W,y); ctx.stroke()
    }
    for (let i = 0; i <= 8; i++) {
      const x = (W/8)*i
      ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,H); ctx.stroke()
    }

    // Axis labels
    const allVals = nodes.flatMap(n => waveforms[n])
    const vMin = Math.min(...allVals, 0)
    const vMax = Math.max(...allVals, 0.001)
    const vRange = vMax - vMin || 1
    const tMax = times[times.length-1]

    const toX = t => (t/tMax) * W
    const toY = v => H - ((v-vMin)/vRange) * H * 0.9 - H*0.05

    // Time axis label
    ctx.fillStyle = '#64748b'
    ctx.font = '10px monospace'
    ctx.fillText(`0`, 3, H-2)
    ctx.fillText(`${(tMax*1000).toFixed(2)}ms`, W-42, H-2)
    ctx.fillText(`${vMax.toFixed(2)}V`, 3, 10)
    ctx.fillText(`${vMin.toFixed(2)}V`, 3, H-14)

    // Traces
    nodes.forEach((node, idx) => {
      const data = waveforms[node]
      if (!data || !data.length) return
      ctx.strokeStyle = TRACE_COLORS[idx % TRACE_COLORS.length]
      ctx.lineWidth = 1.5
      ctx.beginPath()
      data.forEach((v, i) => {
        const x = toX(times[i])
        const y = toY(v)
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y)
      })
      ctx.stroke()

      // Legend
      ctx.fillStyle = TRACE_COLORS[idx % TRACE_COLORS.length]
      ctx.font = 'bold 11px monospace'
      ctx.fillText(node, 6, 20 + idx*14)
    })
  }, [times, waveforms, height])

  return (
    <canvas
      ref={canvasRef}
      width={420}
      height={height}
      style={{ width:'100%', height, display:'block', borderRadius:4 }}
    />
  )
}

// ── Main panel ────────────────────────────────────────────────────────────────
export default function Oscilloscope({ onClose }) {
  const {
    components, wires,
    probeNodes, addProbeNode, removeProbeNode, setProbeNodes,
    transientResult, transientLoading, transientError,
    setTransientResult, setTransientError, setTransientLoading,
    buildSimRequest,
  } = useStore()

  const [tStop, setTStop] = useState('1')      // ms
  const [tStopUnit, setTStopUnit] = useState('ms')
  const [dtUs, setDtUs] = useState('1')        // µs
  const [manualNode, setManualNode] = useState('')

  const run = useCallback(async () => {
    const req = buildSimRequest()
    if (!req.components.length) {
      setTransientError('No components on board.')
      return
    }
    const tStopSec = parseFloat(tStop) * (tStopUnit === 'ms' ? 1e-3 : tStopUnit === 'us' ? 1e-6 : 1)
    const dtSec    = parseFloat(dtUs) * 1e-6
    if (isNaN(tStopSec) || tStopSec <= 0) { setTransientError('Invalid time range.'); return }
    if (isNaN(dtSec)    || dtSec <= 0)    { setTransientError('Invalid time step.'); return }
    const maxSteps = 50000
    if (tStopSec/dtSec > maxSteps) {
      setTransientError(`Too many steps (${Math.round(tStopSec/dtSec).toLocaleString()}). Increase dt or reduce t_stop.`)
      return
    }

    setTransientLoading(true)
    try {
      // Map probe node names through the same net-merging the sim uses, so a
      // probe on a wired-together hole reads the right canonical node.
      const canon = computeNodeMap(components, wires)
      const probes = probeNodes.length
        ? [...new Set(probeNodes.map(canon))]
        : null
      const res = await fetch(`${API}/simulate/transient`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...req,
          t_stop: tStopSec,
          dt: dtSec,
          probe_nodes: probes,
        }),
      })
      if (!res.ok) {
        const err = await res.json()
        setTransientError(err.detail || 'Simulation failed')
        return
      }
      const data = await res.json()
      setTransientResult(data)
    } catch (e) {
      setTransientError(e.message)
    }
  }, [buildSimRequest, components, wires, probeNodes, tStop, tStopUnit, dtUs,
      setTransientLoading, setTransientResult, setTransientError])

  const W = { display:'flex', alignItems:'center', gap:6 }
  const BTN = (extra) => ({
    padding:'3px 8px', borderRadius:4, border:'1px solid #334155',
    background:'#1e293b', color:'#e2e8f0', cursor:'pointer',
    fontSize:11, ...extra,
  })

  return (
    <div style={{
      width: 460, background:'#0f172a', color:'#e2e8f0',
      borderLeft:'1px solid #1e293b', display:'flex', flexDirection:'column',
      fontFamily:'monospace', fontSize:12, flexShrink:0,
    }}>
      {/* Header */}
      <div style={{
        height:36, display:'flex', alignItems:'center', padding:'0 12px',
        background:'#1e293b', borderBottom:'1px solid #334155', gap:8, flexShrink:0,
      }}>
        <span style={{fontSize:14}}>📡</span>
        <span style={{fontWeight:700, color:'#22d3ee'}}>Oscilloscope</span>
        <div style={{flex:1}}/>
        <button onClick={onClose} style={{...BTN(), background:'transparent', border:'none', fontSize:14}}>✕</button>
      </div>

      <div style={{flex:1, overflowY:'auto', padding:10, display:'flex', flexDirection:'column', gap:10}}>

        {/* Time settings */}
        <div style={{background:'#1e293b', borderRadius:6, padding:8}}>
          <div style={{color:'#64748b', fontSize:10, marginBottom:6}}>TIME RANGE</div>
          <div style={{display:'flex', gap:6, flexWrap:'wrap'}}>
            <label style={W}>
              <span style={{color:'#94a3b8'}}>t_stop</span>
              <input value={tStop} onChange={e=>setTStop(e.target.value)}
                style={{width:52,...inputStyle}}/>
              <select value={tStopUnit} onChange={e=>setTStopUnit(e.target.value)}
                style={{...inputStyle, width:42}}>
                <option value="us">µs</option>
                <option value="ms">ms</option>
                <option value="s">s</option>
              </select>
            </label>
            <label style={W}>
              <span style={{color:'#94a3b8'}}>dt</span>
              <input value={dtUs} onChange={e=>setDtUs(e.target.value)}
                style={{width:46,...inputStyle}}/>
              <span style={{color:'#64748b'}}>µs</span>
            </label>
          </div>
        </div>

        {/* Probe nodes */}
        <div style={{background:'#1e293b', borderRadius:6, padding:8}}>
          <div style={{color:'#64748b', fontSize:10, marginBottom:6}}>PROBE NODES
            <span style={{color:'#334155', marginLeft:4}}>
              (click node on board, or add manually)
            </span>
          </div>
          <div style={{display:'flex', gap:4, marginBottom:6}}>
            <input
              placeholder="e.g. LE5"
              value={manualNode}
              onChange={e=>setManualNode(e.target.value.toUpperCase())}
              onKeyDown={e=>{
                if(e.key==='Enter' && manualNode.trim()){
                  addProbeNode(manualNode.trim()); setManualNode('')
                }
              }}
              style={{flex:1,...inputStyle}}
            />
            <button onClick={()=>{
              if(manualNode.trim()){ addProbeNode(manualNode.trim()); setManualNode('') }
            }} style={BTN({background:'#1d4ed8',border:'none',color:'#fff'})}>
              Add
            </button>
            <button onClick={()=>setProbeNodes([])} style={BTN({color:'#f87171'})}>
              Clear
            </button>
          </div>
          <div style={{display:'flex', flexWrap:'wrap', gap:4}}>
            {probeNodes.length === 0 && (
              <span style={{color:'#475569',fontSize:10}}>All nodes (none pinned)</span>
            )}
            {probeNodes.map((n,i) => (
              <span key={n} style={{
                display:'flex', alignItems:'center', gap:3,
                background:'#0f172a', border:`1px solid ${TRACE_COLORS[i%TRACE_COLORS.length]}`,
                borderRadius:3, padding:'1px 6px', color: TRACE_COLORS[i%TRACE_COLORS.length],
              }}>
                {n}
                <span onClick={()=>removeProbeNode(n)} style={{cursor:'pointer',opacity:.7}}>✕</span>
              </span>
            ))}
          </div>
        </div>

        {/* Run button */}
        <button onClick={run} disabled={transientLoading} style={{
          padding:'7px', borderRadius:6, border:'none', cursor:'pointer',
          background: transientLoading ? '#334155' : '#1d4ed8',
          color:'#fff', fontWeight:700, fontSize:13, flexShrink:0,
        }}>
          {transientLoading ? '⏳ Simulating...' : '▶  Run Transient'}
        </button>

        {/* Error */}
        {transientError && (
          <div style={{
            background:'#450a0a', border:'1px solid #dc2626', borderRadius:6,
            padding:8, color:'#fca5a5', fontSize:11,
          }}>
            {transientError}
          </div>
        )}

        {/* Waveform plot */}
        {transientResult && !transientError && (() => {
          const { times, waveforms } = transientResult
          // Filter to only probed nodes (non-trivial)
          const filtered = {}
          const keys = probeNodes.length ? probeNodes : Object.keys(waveforms)
          for (const k of keys) {
            if (waveforms[k] && k !== '0' && k !== 'GND') filtered[k] = waveforms[k]
          }
          const nodeCount = Object.keys(filtered).length
          if (!nodeCount) return <div style={{color:'#475569'}}>No probe data.</div>

          return (
            <div>
              <WaveformCanvas times={times} waveforms={filtered} height={180}/>
              <div style={{marginTop:6, color:'#64748b', fontSize:10}}>
                {nodeCount} trace{nodeCount>1?'s':''} &nbsp;|&nbsp;
                {times.length} pts &nbsp;|&nbsp;
                dt={(transientResult.dt*1e6).toFixed(2)}µs &nbsp;|&nbsp;
                t_stop={(transientResult.t_stop*1000).toFixed(3)}ms
              </div>
              {/* Voltage readout at last sample */}
              <div style={{marginTop:6, display:'flex', flexWrap:'wrap', gap:4}}>
                {Object.entries(filtered).map(([n,data],i) => (
                  <span key={n} style={{
                    fontSize:10, padding:'2px 6px', borderRadius:3,
                    background:'#1e293b',
                    color: TRACE_COLORS[i%TRACE_COLORS.length],
                  }}>
                    {n}: {(data[data.length-1]??0).toFixed(4)}V
                  </span>
                ))}
              </div>
            </div>
          )
        })()}
      </div>
    </div>
  )
}

const inputStyle = {
  background:'#0f172a', border:'1px solid #334155',
  color:'#e2e8f0', borderRadius:3, padding:'2px 5px',
  fontSize:11, outline:'none',
}
