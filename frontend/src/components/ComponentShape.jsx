import { Group, Rect, Circle, Line, Text, Arrow } from 'react-konva'
import { useState } from 'react'

// Vivid colors — readable on the cream/white board background
const TYPE_COLOR = {
  resistor:  '#b45309',  // amber-700
  led:       '#ca8a04',  // yellow-600 (body; glow overrides when on)
  zener:     '#6d28d9',  // violet-700
  diode:     '#0369a1',  // sky-700
  bjt:       '#15803d',  // green-700
  battery:   '#1d4ed8',  // blue-700
  capacitor: '#b45309',  // amber-700
  mcu:       '#0f766e',  // teal-700
  ic:        '#374151',  // gray-700
}

const LED_GLOW = {
  red: '#ff4444', green: '#44ff44', blue: '#4488ff',
  yellow: '#ffff44', white: '#ffffff', infrared: '#550000',
}

export default function ComponentShape({ comp, simResult, holeXY, onRemove }) {
  const [showMenu, setShowMenu] = useState(false)

  const p1 = holeXY(comp.pin1.col, comp.pin1.row)
  const p2 = comp.pin2 ? holeXY(comp.pin2.col, comp.pin2.row) : p1
  const p3 = comp.pin3 ? holeXY(comp.pin3.col, comp.pin3.row) : p2

  const mx = (p1.x + p2.x) / 2
  const my = (p1.y + p2.y) / 2
  const color = TYPE_COLOR[comp.type] || '#6b7280'

  const ledState = simResult?.led_states?.[comp.id]
  const ledOn = ledState?.on
  const ledGlow = LED_GLOW[comp.params?.color] || '#fbbf24'

  const nodeV = (nodeKey) => {
    const n = comp.nodes?.[nodeKey]
    return n ? simResult?.node_voltages?.[n] : undefined
  }

  return (
    <Group onClick={(e) => { e.cancelBubble = true; setShowMenu(s => !s) }}>

      {/* Lead wire from pin1 to body */}
      <Line points={[p1.x, p1.y, mx, my - 8]}
            stroke="#9ca3af" strokeWidth={2} lineCap="round" />
      {/* Lead wire from body to pin2 */}
      <Line points={[mx, my + 8, p2.x, p2.y]}
            stroke="#9ca3af" strokeWidth={2} lineCap="round" />

      {/* ── Body shapes ── */}

      {comp.type === 'resistor' && (
        <Group>
          <Rect x={mx - 14} y={my - 7} width={28} height={14}
                fill={color} cornerRadius={3}
                stroke="#7c2d12" strokeWidth={1.5} />
          {/* Color band stripes */}
          {[6, 10, 14, 18].map((ox, i) => (
            <Rect key={i} x={mx - 14 + ox} y={my - 7} width={2} height={14}
                  fill={['#f97316','#fbbf24','#4ade80','#a78bfa'][i]}
                  opacity={0.8} />
          ))}
        </Group>
      )}

      {comp.type === 'capacitor' && (
        <Group>
          <Rect x={mx - 8} y={my - 10} width={16} height={20}
                fill={color} cornerRadius={2} stroke="#78350f" strokeWidth={1} />
          <Line points={[mx - 5, my - 2, mx + 5, my - 2]}
                stroke="white" strokeWidth={2} />
          <Line points={[mx, my - 5, mx, my + 1]}
                stroke="white" strokeWidth={2} />
          <Line points={[mx - 5, my + 3, mx + 5, my + 3]}
                stroke="white" strokeWidth={2} />
        </Group>
      )}

      {comp.type === 'led' && (
        <Group>
          {/* LED anode-to-cathode: triangle pointing down (current flows down) */}
          <Line
            points={[mx - 9, my - 8,  mx + 9, my - 8,
                     mx,     my + 8,   mx - 9, my - 8]}
            closed fill={ledOn ? ledGlow : color}
            stroke={ledOn ? ledGlow : color} strokeWidth={1}
          />
          {/* Cathode bar */}
          <Line points={[mx - 9, my + 8, mx + 9, my + 8]}
                stroke={ledOn ? ledGlow : color} strokeWidth={2.5} />
          {/* Glow when on */}
          {ledOn && (
            <Circle x={mx} y={my} radius={18}
                    fill={ledGlow} opacity={0.2} />
          )}
          {/* Emission arrows */}
          {ledOn && (
            <>
              <Arrow points={[mx + 10, my - 4, mx + 18, my - 12]}
                     stroke={ledGlow} fill={ledGlow}
                     strokeWidth={1.5} pointerLength={5} pointerWidth={4} />
              <Arrow points={[mx + 13, my + 2, mx + 21, my - 6]}
                     stroke={ledGlow} fill={ledGlow}
                     strokeWidth={1.5} pointerLength={5} pointerWidth={4} />
            </>
          )}
        </Group>
      )}

      {comp.type === 'zener' && (
        <Group>
          <Line
            points={[mx - 9, my - 8,  mx + 9, my - 8,
                     mx,     my + 8,   mx - 9, my - 8]}
            closed fill={color} stroke={color} strokeWidth={1}
          />
          {/* Zener bent cathode */}
          <Line points={[mx - 12, my + 8, mx + 9, my + 8, mx + 12, my + 5]}
                stroke={color} strokeWidth={2.5} lineCap="round" lineJoin="round" />
          <Text x={mx + 13} y={my - 4} text={`${comp.params?.vz}V`}
                fontSize={8} fill="#c4b5fd" />
        </Group>
      )}

      {comp.type === 'diode' && (
        <Group>
          <Line
            points={[mx - 9, my - 8,  mx + 9, my - 8,
                     mx,     my + 8,   mx - 9, my - 8]}
            closed fill={color} stroke={color} strokeWidth={1}
          />
          <Line points={[mx - 9, my + 8, mx + 9, my + 8]}
                stroke={color} strokeWidth={2.5} />
        </Group>
      )}

      {comp.type === 'bjt' && (
        <Group>
          {/* Extra lead for pin3 */}
          <Line points={[p2.x, p2.y, mx, my]} stroke="#9ca3af" strokeWidth={2} />
          <Line points={[p3.x, p3.y, mx, (my + p3.y) / 2]}
                stroke="#9ca3af" strokeWidth={2} />
          <Circle x={mx} y={my} radius={16}
                  fill={color} stroke="#166534" strokeWidth={1.5} />
          <Text x={mx - 10} y={my - 6}
                text={comp.params?.bjt_type || 'NPN'}
                fontSize={9} fill="white" fontStyle="bold" />
          {/* B / C / E labels */}
          <Text x={p1.x + 2} y={p1.y - 10} text="B" fontSize={8} fill="#15803d" />
          <Text x={p2.x + 2} y={p2.y - 10} text="C" fontSize={8} fill="#15803d" />
          <Text x={p3.x + 2} y={p3.y - 10} text="E" fontSize={8} fill="#15803d" />
        </Group>
      )}

      {comp.type === 'battery' && (
        <Group>
          <Rect x={mx - 18} y={my - 10} width={36} height={20}
                fill={color} cornerRadius={4} stroke="#1e3a8a" strokeWidth={1.5} />
          <Text x={mx - 14} y={my - 5}
                text={`${comp.params?.voltage || 9}V`}
                fontSize={11} fill="white" fontStyle="bold" />
        </Group>
      )}

      {comp.type === 'mcu' && (
        <Group>
          {/* IC body straddling center */}
          <Rect x={p1.x - 12} y={p1.y - 8} width={p2.x - p1.x + 24} height={16}
                fill={color} cornerRadius={4} stroke="#134e4a" strokeWidth={1.5} />
          <Text x={p1.x} y={p1.y - 4}
                text={comp.label}
                fontSize={8} fill="#ccfbf1" fontStyle="bold"
                width={p2.x - p1.x} align="center" />
          {/* Notch */}
          <Circle x={(p1.x + p2.x) / 2} y={p1.y - 8} radius={4}
                  fill="#0d3d38" />
        </Group>
      )}

      {comp.type === 'ic' && (
        <Group>
          <Rect x={p1.x - 12} y={p1.y - 8} width={p2.x - p1.x + 24} height={16}
                fill={color} cornerRadius={4} stroke="#1f2937" strokeWidth={1.5} />
          <Text x={p1.x} y={p1.y - 4}
                text={comp.label}
                fontSize={8} fill="#e5e7eb" fontStyle="bold"
                width={p2.x - p1.x} align="center" />
          <Circle x={(p1.x + p2.x) / 2} y={p1.y - 8} radius={4} fill="#111827" />
        </Group>
      )}

      {/* Component ID label */}
      <Text x={mx - 20} y={my + 12} width={40} align="center"
            text={comp.id} fontSize={8} fill="#374151" />

      {/* Voltage readouts */}
      {simResult && (() => {
        const v1 = nodeV(Object.keys(comp.nodes)[0])
        const v2 = nodeV(Object.keys(comp.nodes)[1])
        return (
          <>
            {v1 !== undefined && (
              <Text x={p1.x + 8} y={p1.y - 10}
                    text={`${v1.toFixed(2)}V`} fontSize={8} fill="#fde68a" />
            )}
            {v2 !== undefined && (
              <Text x={p2.x + 8} y={p2.y - 10}
                    text={`${v2.toFixed(2)}V`} fontSize={8} fill="#fde68a" />
            )}
          </>
        )
      })()}

      {/* Context menu */}
      {showMenu && (
        <Group>
          <Rect x={mx + 18} y={my - 14} width={60} height={24}
                fill="#1f2937" cornerRadius={4}
                stroke="#374151" strokeWidth={1} />
          <Text x={mx + 24} y={my - 8} text="Remove"
                fontSize={10} fill="#f87171"
                onClick={(e) => { e.cancelBubble = true; onRemove(); setShowMenu(false) }} />
        </Group>
      )}
    </Group>
  )
}
