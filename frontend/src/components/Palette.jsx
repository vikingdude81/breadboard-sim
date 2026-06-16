import { useState } from 'react'
import useStore from '../store'

const PALETTE_SECTIONS = [
  {
    label: 'Power',
    items: [
      { type: 'battery', label: '9V Battery', voltage: 9.0, icon: '🔋' },
      { type: 'battery', label: '5V Supply', voltage: 5.0, icon: '🔋' },
    ]
  },
  {
    label: 'Passive',
    items: [
      { type: 'resistor', label: '100Ω',   resistance: 100 },
      { type: 'resistor', label: '220Ω',   resistance: 220 },
      { type: 'resistor', label: '330Ω',   resistance: 330 },
      { type: 'resistor', label: '1kΩ',    resistance: 1000 },
      { type: 'resistor', label: '4.7kΩ',  resistance: 4700 },
      { type: 'resistor', label: '10kΩ',   resistance: 10000 },
      { type: 'resistor', label: '100kΩ',  resistance: 100000 },
      { type: 'capacitor',label: '100nF',  capacitance: 100e-9 },
      { type: 'capacitor',label: '10µF',   capacitance: 10e-6 },
    ]
  },
  {
    label: 'Diodes & LEDs',
    items: [
      { type: 'led',   label: 'LED Red',    vf: 2.0, color: 'red' },
      { type: 'led',   label: 'LED Green',  vf: 2.2, color: 'green' },
      { type: 'led',   label: 'LED Blue',   vf: 3.2, color: 'blue' },
      { type: 'led',   label: 'LED Yellow', vf: 2.1, color: 'yellow' },
      { type: 'led',   label: 'LED White',  vf: 3.4, color: 'white' },
      { type: 'diode', label: '1N4148',     vf: 0.7 },
      { type: 'diode', label: '1N4007',     vf: 0.7 },
      { type: 'zener', label: 'Z 3.3V',  vf: 0.7, vz: 3.3 },
      { type: 'zener', label: 'Z 5.1V',  vf: 0.7, vz: 5.1 },
      { type: 'zener', label: 'Z 5.6V',  vf: 0.7, vz: 5.6 },
      { type: 'zener', label: 'Z 6.2V',  vf: 0.7, vz: 6.2 },
      { type: 'zener', label: 'Z 9.1V',  vf: 0.7, vz: 9.1 },
      { type: 'zener', label: 'Z QRNG 5.1V', vf: 0.7, vz: 5.1, noise_model: 'avalanche' },
    ]
  },
  {
    label: 'Transistors (NPN)',
    items: [
      { type: 'bjt', label: '2N2222',  bjt_type: 'NPN', hfe: 100, vbe: 0.7 },
      { type: 'bjt', label: '2N3904',  bjt_type: 'NPN', hfe: 100, vbe: 0.7 },
      { type: 'bjt', label: 'BC547',   bjt_type: 'NPN', hfe: 110, vbe: 0.7 },
      { type: 'bjt', label: 'TIP31C',  bjt_type: 'NPN', hfe: 25,  vbe: 0.7 },
    ]
  },
  {
    label: 'Transistors (PNP)',
    items: [
      { type: 'bjt', label: '2N2907',  bjt_type: 'PNP', hfe: 100, vbe: 0.7 },
      { type: 'bjt', label: '2N3906',  bjt_type: 'PNP', hfe: 100, vbe: 0.7 },
      { type: 'bjt', label: 'BC557',   bjt_type: 'PNP', hfe: 110, vbe: 0.7 },
    ]
  },
  {
    label: 'Seeed XIAO',
    items: [
      { type: 'mcu', label: 'XIAO SAMD21',   model: 'MCU_XIAO_SAMD21',   vcc: 3.3, adc_bits: 12 },
      { type: 'mcu', label: 'XIAO ESP32-C3', model: 'MCU_XIAO_ESP32C3',  vcc: 3.3, adc_bits: 12 },
      { type: 'mcu', label: 'XIAO ESP32-S3', model: 'MCU_XIAO_ESP32S3',  vcc: 3.3, adc_bits: 12 },
      { type: 'mcu', label: 'XIAO RP2040',   model: 'MCU_XIAO_RP2040',   vcc: 3.3, adc_bits: 12 },
    ]
  },
  {
    label: 'ICs',
    items: [
      { type: 'ic', label: 'NE555 Timer',  pins: 8  },
      { type: 'ic', label: 'LM358 Op-Amp', pins: 8  },
      { type: 'ic', label: '74HC14',       pins: 14 },
    ]
  },
]

const TYPE_ICON = {
  battery:   '🔋',
  resistor:  '▭',
  capacitor: '⊣⊢',
  led:       '▶|',
  diode:     '▶|',
  zener:     '⊻',
  bjt:       '◎',
  mcu:       '⬛',
  ic:        '⬜',
}

export default function Palette() {
  const { selectedPaletteItem, setSelectedPaletteItem } = useStore()
  const [collapsed, setCollapsed] = useState({})

  const toggle = (label) => setCollapsed(s => ({ ...s, [label]: !s[label] }))

  return (
    <div style={{
      width: 200, background: '#fff', color: '#111827',
      overflowY: 'auto', fontSize: 12, userSelect: 'none',
      borderRight: '1px solid #e5e7eb',
    }}>
      <div style={{ padding: '8px 10px', fontWeight: 700, fontSize: 13,
                    borderBottom: '1px solid #e5e7eb', color: '#1d4ed8' }}>
        Component Palette
      </div>
      {PALETTE_SECTIONS.map(sec => (
        <div key={sec.label}>
          <div
            onClick={() => toggle(sec.label)}
            style={{
              padding: '5px 10px', background: '#f9fafb',
              cursor: 'pointer', fontWeight: 600, fontSize: 11,
              color: '#6b7280', display: 'flex', justifyContent: 'space-between',
              borderBottom: '1px solid #e5e7eb',
            }}
          >
            {sec.label}
            <span>{collapsed[sec.label] ? '▶' : '▼'}</span>
          </div>
          {!collapsed[sec.label] && sec.items.map((item, i) => {
            const isSelected = selectedPaletteItem?.label === item.label &&
                               selectedPaletteItem?.type === item.type
            return (
              <div
                key={i}
                onClick={() => setSelectedPaletteItem(isSelected ? null : item)}
                style={{
                  padding: '4px 14px',
                  cursor: 'pointer',
                  background: isSelected ? '#dbeafe' : 'transparent',
                  color: isSelected ? '#1d4ed8' : '#374151',
                  borderBottom: '1px solid #f3f4f6',
                  display: 'flex', alignItems: 'center', gap: 6,
                  fontWeight: isSelected ? 600 : 400,
                }}
              >
                <span style={{ fontSize: 10, opacity: 0.6 }}>
                  {TYPE_ICON[item.type] || '○'}
                </span>
                {item.label}
              </div>
            )
          })}
        </div>
      ))}

      {selectedPaletteItem && (
        <div style={{ padding: '8px 10px', background: '#eff6ff',
                      borderTop: '1px solid #bfdbfe', fontSize: 11, color: '#1d4ed8' }}>
          Click board to place:<br />
          <strong>{selectedPaletteItem.label}</strong>
          <div style={{ marginTop: 4, color: '#6b7280' }}>
            Press Esc or re-click to cancel
          </div>
        </div>
      )}
    </div>
  )
}
