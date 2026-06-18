import { useState, useEffect, useCallback } from 'react'
import Breadboard from './components/Breadboard'
import Palette from './components/Palette'
import SimPanel from './components/SimPanel'
import LLMPanel from './components/LLMPanel'
import Oscilloscope from './components/Oscilloscope'
import AutoDebug from './components/AutoDebug'
import useStore from './store'

function PowerIndicator() {
  const { components, simResult, nodeMap } = useStore()

  const batteries = components.filter(c => c.type === 'battery')
  if (batteries.length === 0) return null

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      {batteries.map(bat => {
        const voltage = bat.params?.voltage ?? 9
        // After simulation, check if the positive node has voltage on it
        const posNode = bat.nodes?.pos
        const simV = simResult?.node_voltages?.[nodeMap(posNode)]
        const confirmed = simV !== undefined && Math.abs(simV) > 0.1

        return (
          <div key={bat.id} style={{
            display: 'flex', alignItems: 'center', gap: 5,
            padding: '3px 10px', borderRadius: 20,
            background: confirmed ? '#dcfce7' : '#fef9c3',
            border: `1.5px solid ${confirmed ? '#16a34a' : '#ca8a04'}`,
          }}>
            {/* LED dot */}
            <span style={{
              display: 'inline-block', width: 9, height: 9, borderRadius: '50%',
              background: confirmed ? '#16a34a' : '#eab308',
              boxShadow: confirmed
                ? '0 0 6px 2px #4ade80'
                : '0 0 4px 1px #fde047',
              flexShrink: 0,
            }} />
            <span style={{
              fontSize: 12, fontWeight: 700,
              color: confirmed ? '#15803d' : '#92400e',
            }}>
              {bat.id}: {voltage}V
            </span>
            <span style={{
              fontSize: 10,
              color: confirmed ? '#16a34a' : '#a16207',
            }}>
              {confirmed ? '✓ active' : 'placed'}
            </span>
          </div>
        )
      })}
    </div>
  )
}

function App() {
  const [boardSize, setBoardSize] = useState({ w: 800, h: 500 })
  const [showAI, setShowAI] = useState(false)
  const [showScope, setShowScope] = useState(false)
  const [showDebug, setShowDebug] = useState(false)
  const { setSelectedPaletteItem, showRatsnest, setShowRatsnest } = useStore()

  const measureBoard = useCallback(() => {
    const el = document.getElementById('board-container')
    if (el) setBoardSize({ w: el.clientWidth, h: el.clientHeight })
  }, [])

  useEffect(() => {
    measureBoard()
    window.addEventListener('resize', measureBoard)
    return () => window.removeEventListener('resize', measureBoard)
  }, [measureBoard])

  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') setSelectedPaletteItem(null) }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [setSelectedPaletteItem])

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', height: '100vh', minWidth: 900,
      background: '#f1f5f9', color: '#111827', fontFamily: 'system-ui, sans-serif',
    }}>
      <div style={{
        height: 44, display: 'flex', alignItems: 'center', padding: '0 16px',
        background: '#fff', borderBottom: '1px solid #e5e7eb',
        gap: 12, flexShrink: 0, boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
      }}>
        <span style={{ fontSize: 18 }}>⚡</span>
        <span style={{ fontWeight: 700, fontSize: 15, color: '#1d4ed8' }}>
          Breadboard Simulator
        </span>
        <span style={{ fontSize: 11, color: '#9ca3af', marginLeft: 8 }}>
          Place components · Draw wires · Simulate
        </span>
        <div style={{ flex: 1 }} />
        <PowerIndicator />
        <button onClick={() => setShowRatsnest(!showRatsnest)} style={{
          padding: '4px 12px',
          background: showRatsnest ? '#92400e' : '#f1f5f9',
          color: showRatsnest ? '#fde68a' : '#374151',
          border: '1px solid ' + (showRatsnest ? '#b45309' : '#e5e7eb'),
          borderRadius: 6, cursor: 'pointer', fontWeight: 600, fontSize: 12,
        }}>
          🕸 Ratsnest
        </button>
        <button onClick={() => setShowDebug(v => !v)} style={{
          padding: '4px 12px',
          background: showDebug ? '#4f46e5' : '#f1f5f9',
          color: showDebug ? '#fff' : '#374151',
          border: '1px solid ' + (showDebug ? '#4f46e5' : '#e5e7eb'),
          borderRadius: 6, cursor: 'pointer', fontWeight: 600, fontSize: 12,
        }}>
          🧠 Auto-Debug
        </button>
        <button onClick={() => setShowScope(v => !v)} style={{
          padding: '4px 12px',
          background: showScope ? '#0f172a' : '#f1f5f9',
          color: showScope ? '#22d3ee' : '#374151',
          border: '1px solid ' + (showScope ? '#334155' : '#e5e7eb'),
          borderRadius: 6, cursor: 'pointer', fontWeight: 600, fontSize: 12,
        }}>
          📡 Scope
        </button>
        <button onClick={() => setShowAI(v => !v)} style={{
          padding: '4px 12px',
          background: showAI ? '#1d4ed8' : '#f1f5f9',
          color: showAI ? '#fff' : '#374151',
          border: '1px solid ' + (showAI ? '#1d4ed8' : '#e5e7eb'),
          borderRadius: 6, cursor: 'pointer', fontWeight: 600, fontSize: 12,
        }}>
          🤖 AI
        </button>
      </div>
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden', position: 'relative' }}>
        <Palette />
        <div id="board-container" style={{
          flex: 1, overflow: 'auto', background: '#e5e7eb',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: 16,
        }}>
          <Breadboard containerWidth={boardSize.w} containerHeight={boardSize.h} />
        </div>
        <SimPanel />

        {/* Floating overlay panels — anchored to right of SimPanel, don't squeeze board */}
        {(showDebug || showScope || showAI) && (
          <div style={{
            position: 'absolute', top: 0, right: 254, bottom: 0,
            display: 'flex', flexDirection: 'row', alignItems: 'stretch',
            pointerEvents: 'none', zIndex: 50, overflowX: 'auto',
          }}>
            {showAI && (
              <div style={{ pointerEvents: 'auto', display: 'flex',
                            boxShadow: '-4px 0 16px rgba(0,0,0,0.18)' }}>
                <LLMPanel onClose={() => setShowAI(false)} />
              </div>
            )}
            {showScope && (
              <div style={{ pointerEvents: 'auto', display: 'flex',
                            boxShadow: '-4px 0 16px rgba(0,0,0,0.18)' }}>
                <Oscilloscope onClose={() => setShowScope(false)} />
              </div>
            )}
            {showDebug && (
              <div style={{ pointerEvents: 'auto', display: 'flex',
                            boxShadow: '-4px 0 16px rgba(0,0,0,0.18)' }}>
                <AutoDebug onClose={() => setShowDebug(false)} />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

export default App
