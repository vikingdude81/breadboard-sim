/**
 * Inspector — click a placed component to edit its values (HTML overlay, not
 * Konva, so we get real form inputs). Edits write straight to the store; hit
 * Run Simulation to see the effect.
 */
import useStore from '../store'

// Editable fields per component type.
const FIELD_SPECS = {
  resistor:       [{ k: 'resistance', label: 'Resistance (Ω)', type: 'number' }],
  capacitor:      [{ k: 'capacitance', label: 'Capacitance (F)', type: 'number' }],
  battery:        [{ k: 'voltage', label: 'Voltage (V)', type: 'number' }],
  led:            [{ k: 'vf', label: 'Vf (V)', type: 'number' },
                   { k: 'color', label: 'Color', type: 'select',
                     options: ['red', 'green', 'blue', 'yellow', 'white', 'infrared'] }],
  diode:          [{ k: 'vf', label: 'Vf (V)', type: 'number' }],
  zener:          [{ k: 'vf', label: 'Vf (V)', type: 'number' },
                   { k: 'vz', label: 'Vz (V)', type: 'number' }],
  bjt:            [{ k: 'bjt_type', label: 'Type', type: 'select', options: ['NPN', 'PNP'] },
                   { k: 'hfe', label: 'hFE', type: 'number' },
                   { k: 'vbe', label: 'Vbe (V)', type: 'number' }],
  mosfet:         [{ k: 'mtype', label: 'Channel', type: 'select', options: ['N', 'P'] },
                   { k: 'vth', label: 'Vth (V)', type: 'number' },
                   { k: 'K', label: 'K (A/V²)', type: 'number' },
                   { k: 'lam', label: 'λ (1/V)', type: 'number' }],
  opamp:          [{ k: 'Aol', label: 'Open-loop gain', type: 'number' },
                   { k: 'Rin', label: 'Rin (Ω)', type: 'number' },
                   { k: 'Rout', label: 'Rout (Ω)', type: 'number' }],
  potentiometer:  [{ k: 'resistance', label: 'Resistance (Ω)', type: 'number' },
                   { k: 'pos', label: 'Wiper', type: 'slider', min: 0, max: 1, step: 0.01 }],
  ldr:            [{ k: 'resistance', label: 'Resistance (Ω)', type: 'number' }],
  current_source: [{ k: 'current', label: 'Current (A)', type: 'number' }],
}

const lbl = { fontSize: 10, color: '#6b7280', display: 'block', marginBottom: 2 }
const inp = {
  width: '100%', padding: '4px 6px', fontSize: 12, boxSizing: 'border-box',
  border: '1px solid #d1d5db', borderRadius: 4, background: '#fff', color: '#111827',
}

export default function Inspector() {
  const components = useStore(s => s.components)
  const selectedId = useStore(s => s.selectedComponentId)
  const changeParam = useStore(s => s.changeParam)
  const removeComponent = useStore(s => s.removeComponent)
  const setSelected = useStore(s => s.setSelectedComponent)

  const comp = components.find(c => c.id === selectedId)
  if (!comp) return null

  const specs = FIELD_SPECS[comp.type] || []
  const p = comp.params || {}

  const setNum = (k, v) => {
    const n = parseFloat(v)
    if (!Number.isNaN(n)) changeParam(comp.id, k, n)
  }

  return (
    <div style={{
      position: 'absolute', left: 12, bottom: 12, width: 210, zIndex: 60,
      background: '#fff', border: '1px solid #d1d5db', borderRadius: 8,
      boxShadow: '0 6px 24px rgba(0,0,0,0.18)', padding: 10,
      fontFamily: 'system-ui, sans-serif',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
        <div style={{ fontWeight: 700, fontSize: 13, color: '#1d4ed8', flex: 1 }}>
          {comp.id} <span style={{ color: '#6b7280', fontWeight: 400, fontSize: 11 }}>· {comp.label}</span>
        </div>
        <button onClick={() => setSelected(null)} title="Close"
                style={{ border: 'none', background: 'none', cursor: 'pointer',
                         fontSize: 15, color: '#9ca3af', lineHeight: 1 }}>×</button>
      </div>

      {specs.length === 0 && (
        <div style={{ fontSize: 11, color: '#9ca3af', marginBottom: 8 }}>
          No editable parameters for this part.
        </div>
      )}

      {specs.map(spec => {
        const val = p[spec.k] ?? (spec.k === 'resistance' ? p.R_dark : '')
        if (spec.type === 'select') {
          return (
            <div key={spec.k} style={{ marginBottom: 8 }}>
              <label style={lbl}>{spec.label}</label>
              <select value={val} style={inp}
                      onChange={e => changeParam(comp.id, spec.k, e.target.value)}>
                {spec.options.map(o => <option key={o} value={o}>{o}</option>)}
              </select>
            </div>
          )
        }
        if (spec.type === 'slider') {
          return (
            <div key={spec.k} style={{ marginBottom: 8 }}>
              <label style={lbl}>{spec.label}: {Number(val).toFixed(2)}</label>
              <input type="range" min={spec.min} max={spec.max} step={spec.step}
                     value={val} style={{ width: '100%' }}
                     onChange={e => setNum(spec.k, e.target.value)} />
            </div>
          )
        }
        return (
          <div key={spec.k} style={{ marginBottom: 8 }}>
            <label style={lbl}>{spec.label}</label>
            <input type="number" defaultValue={val} style={inp}
                   onChange={e => setNum(spec.k, e.target.value)} />
          </div>
        )
      })}

      <button onClick={() => { removeComponent(comp.id); setSelected(null) }}
              style={{ width: '100%', padding: '6px 0', marginTop: 2,
                       background: '#fef2f2', color: '#b91c1c',
                       border: '1px solid #fecaca', borderRadius: 4,
                       cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
        🗑 Remove component
      </button>
      <div style={{ fontSize: 10, color: '#9ca3af', marginTop: 6, textAlign: 'center' }}>
        Run Simulation to apply changes
      </div>
    </div>
  )
}
