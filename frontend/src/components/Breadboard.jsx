import { Stage, Layer, Rect, Circle, Line, Text, Group } from 'react-konva'
import { useRef, useState, useCallback } from 'react'
import useStore, { ROWS, LEFT_COLS, RIGHT_COLS, ALL_COLS, CELL, RAIL_W, posToNode, nextId } from '../store'
import ComponentShape from './ComponentShape'
import { computeRatsnest } from '../ratsnest'

// ── Layout ────────────────────────────────────────────────────────────────────
const PAD_TOP     = 38
const PAD_LEFT    = 40
const PAD_RIGHT   = 20
const PAD_BOTTOM  = 24
const DIVIDER_W   = 24
const RAIL_GAP    = 14
const HOLE_R      = 7
const RAIL_HOLE_R = 6

// White / cream breadboard palette
const CLR = {
  board:       '#f8f4e8',   // warm white like a real breadboard
  railBg:      '#e8e0cc',
  divider:     '#d4cbb5',
  holeEmpty:   '#c8b99a',   // tan hole
  holeRim:     '#a89070',
  holeHover:   '#f59e0b',
  holeActive:  '#f97316',
  railRedLine: '#dc2626',
  railBluLine: '#2563eb',
  rowLabel:    '#6b5b3a',
  colLabel:    '#6b5b3a',
  dividerLine: '#b8a888',
  border:      '#b8a888',
}

function colX(col) {
  const li = LEFT_COLS.indexOf(col)
  const ri = RIGHT_COLS.indexOf(col)
  const base = PAD_LEFT + RAIL_W + RAIL_GAP
  if (li >= 0) return base + li * CELL + CELL / 2
  if (ri >= 0) return base + LEFT_COLS.length * CELL + DIVIDER_W + ri * CELL + CELL / 2
  return 0
}

function rowY(row) {
  return PAD_TOP + (row - 1) * CELL + CELL / 2
}

const RAIL_L_POS_X  = PAD_LEFT + RAIL_W * 0.32
const RAIL_L_NEG_X  = PAD_LEFT + RAIL_W * 0.68
const RAIL_R_BASE_X = () => colX('j') + CELL / 2 + RAIL_GAP
const RAIL_R_POS_X  = () => RAIL_R_BASE_X() + RAIL_W * 0.32
const RAIL_R_NEG_X  = () => RAIL_R_BASE_X() + RAIL_W * 0.68

const BOARD_W = PAD_LEFT + RAIL_W + RAIL_GAP + LEFT_COLS.length * CELL + DIVIDER_W + RIGHT_COLS.length * CELL + RAIL_GAP + RAIL_W + PAD_RIGHT
const BOARD_H = PAD_TOP + ROWS * CELL + PAD_BOTTOM

export { BOARD_W, BOARD_H, colX, rowY }

function holeFromXY(x, y) {
  const row = Math.round((y - PAD_TOP) / CELL) + 1
  if (row < 1 || row > ROWS) return null
  for (const col of ALL_COLS) {
    if (Math.abs(x - colX(col)) < CELL * 0.45) return { col, row }
  }
  if (Math.abs(x - RAIL_L_POS_X) < RAIL_W * 0.28) return { col: 'rail_l+', row }
  if (Math.abs(x - RAIL_L_NEG_X) < RAIL_W * 0.28) return { col: 'rail_l-', row }
  if (Math.abs(x - RAIL_R_POS_X()) < RAIL_W * 0.28) return { col: 'rail_r+', row }
  if (Math.abs(x - RAIL_R_NEG_X()) < RAIL_W * 0.28) return { col: 'rail_r-', row }
  return null
}

function holeXY(col, row) {
  if (col === 'rail_l+') return { x: RAIL_L_POS_X,  y: rowY(row) }
  if (col === 'rail_l-') return { x: RAIL_L_NEG_X,  y: rowY(row) }
  if (col === 'rail_r+') return { x: RAIL_R_POS_X(), y: rowY(row) }
  if (col === 'rail_r-') return { x: RAIL_R_NEG_X(), y: rowY(row) }
  return { x: colX(col), y: rowY(row) }
}

export { holeXY }

export default function Breadboard({ containerWidth, containerHeight }) {
  const {
    components, wires, simResult,
    selectedPaletteItem, setSelectedPaletteItem,
    wireStart, setWireStart,
    addComponent, addWire,
    showRatsnest, nodeMap, setSelectedComponent,
  } = useStore()

  const [hovered, setHovered] = useState(null)
  const stageRef = useRef()

  const scale = Math.min(containerWidth / BOARD_W, containerHeight / BOARD_H, 1.6)

  const toBoard = useCallback(() => {
    const stage = stageRef.current
    if (!stage) return null
    const pos = stage.getPointerPosition()
    return { x: pos.x / scale, y: pos.y / scale }
  }, [scale])

  const handleMouseMove = useCallback(() => {
    const p = toBoard(); if (!p) return
    setHovered(holeFromXY(p.x, p.y))
  }, [toBoard])

  const handleClick = useCallback(() => {
    const p = toBoard(); if (!p) return
    const hole = holeFromXY(p.x, p.y)

    // Any click on the board background/holes deselects the inspected component.
    // (Clicks on a component itself cancel bubbling, so they don't reach here.)
    setSelectedComponent(null)

    if (selectedPaletteItem) {
      if (!hole) {
        // Clicked empty space — deselect
        setSelectedPaletteItem(null)
        return
      }
      const comp = buildComponent(selectedPaletteItem, hole)
      if (comp) {
        addComponent(comp)
        // Auto-deselect after placing so the next click draws a wire
        setSelectedPaletteItem(null)
      }
      return
    }

    if (!hole) { setWireStart(null); return }
    if (!wireStart) {
      setWireStart(hole)
    } else {
      const same = wireStart.col === hole.col && wireStart.row === hole.row
      if (!same) {
        addWire({
          id: `W_${Date.now()}`,
          from: wireStart, to: hole,
          fromNode: posToNode(wireStart.col, wireStart.row),
          toNode:   posToNode(hole.col, hole.row),
          color: wireColor(wireStart, hole),
        })
      }
      setWireStart(null)
    }
  }, [selectedPaletteItem, wireStart, addComponent, addWire, setWireStart, toBoard, setSelectedComponent])

  const getHoleFill = (col, row) => {
    const node = posToNode(col, row)
    const v = simResult?.node_voltages?.[nodeMap(node)]
    if (hovered?.col === col && hovered?.row === row) return CLR.holeHover
    if (v !== undefined && Math.abs(v) > 0.05) {
      const t = Math.min(v / 9, 1)
      return `hsl(${38 - t * 10}, 90%, ${55 - t * 20}%)`
    }
    return CLR.holeEmpty
  }

  const wireStartXY = wireStart ? holeXY(wireStart.col, wireStart.row) : null
  const ratsnestEdges = showRatsnest ? computeRatsnest(components, wires, holeXY) : []

  return (
    <Stage
      ref={stageRef}
      width={containerWidth}
      height={containerHeight}
      scaleX={scale} scaleY={scale}
      onMouseMove={handleMouseMove}
      onClick={handleClick}
      style={{ cursor: selectedPaletteItem || wireStart ? 'crosshair' : 'default', display: 'block' }}
    >
      <Layer>
        {/* Board body */}
        <Rect x={0} y={0} width={BOARD_W} height={BOARD_H}
              fill={CLR.board} cornerRadius={10}
              stroke={CLR.border} strokeWidth={2} />

        {/* Left rail background */}
        <Rect x={PAD_LEFT} y={PAD_TOP - 6}
              width={RAIL_W} height={ROWS * CELL + 12}
              fill={CLR.railBg} cornerRadius={4}
              stroke={CLR.border} strokeWidth={1} />
        <Line points={[RAIL_L_POS_X, PAD_TOP, RAIL_L_POS_X, PAD_TOP + ROWS * CELL]}
              stroke={CLR.railRedLine} strokeWidth={1.5} opacity={0.5} />
        <Line points={[RAIL_L_NEG_X, PAD_TOP, RAIL_L_NEG_X, PAD_TOP + ROWS * CELL]}
              stroke={CLR.railBluLine} strokeWidth={1.5} opacity={0.5} />
        <Text x={PAD_LEFT + 3}  y={PAD_TOP - 18} text="+"  fontSize={12} fill={CLR.railRedLine} fontStyle="bold" />
        <Text x={PAD_LEFT + 20} y={PAD_TOP - 18} text="−"  fontSize={12} fill={CLR.railBluLine} fontStyle="bold" />

        {/* Right rail background */}
        <Rect x={RAIL_R_BASE_X()} y={PAD_TOP - 6}
              width={RAIL_W} height={ROWS * CELL + 12}
              fill={CLR.railBg} cornerRadius={4}
              stroke={CLR.border} strokeWidth={1} />
        <Line points={[RAIL_R_POS_X(), PAD_TOP, RAIL_R_POS_X(), PAD_TOP + ROWS * CELL]}
              stroke={CLR.railRedLine} strokeWidth={1.5} opacity={0.5} />
        <Line points={[RAIL_R_NEG_X(), PAD_TOP, RAIL_R_NEG_X(), PAD_TOP + ROWS * CELL]}
              stroke={CLR.railBluLine} strokeWidth={1.5} opacity={0.5} />
        <Text x={RAIL_R_BASE_X() + 3}  y={PAD_TOP - 18} text="+" fontSize={12} fill={CLR.railRedLine} fontStyle="bold" />
        <Text x={RAIL_R_BASE_X() + 20} y={PAD_TOP - 18} text="−" fontSize={12} fill={CLR.railBluLine} fontStyle="bold" />

        {/* Center divider */}
        <Rect x={colX('e') + CELL / 2} y={PAD_TOP - 6}
              width={DIVIDER_W} height={ROWS * CELL + 12}
              fill={CLR.divider} cornerRadius={3}
              stroke={CLR.dividerLine} strokeWidth={1} />

        {/* Column labels */}
        {ALL_COLS.map(col => (
          <Text key={col} x={colX(col) - 5} y={8}
                text={col.toUpperCase()} fontSize={13}
                fill={CLR.colLabel} fontStyle="bold" />
        ))}

        {/* Row numbers — every row, aligned right */}
        {Array.from({ length: ROWS }, (_, i) => i + 1).map(row => (
          <Text key={row} x={4} y={rowY(row) - 6}
                text={String(row).padStart(2, ' ')}
                fontSize={10} fill={CLR.rowLabel} fontFamily="monospace" />
        ))}

        {/* 5-row separator lines */}
        {[5,10,15,20,25].map(row => (
          <Line key={row}
            points={[PAD_LEFT, rowY(row) + CELL / 2, BOARD_W - PAD_RIGHT, rowY(row) + CELL / 2]}
            stroke={CLR.dividerLine} strokeWidth={0.5} opacity={0.4} />
        ))}

        {/* Main holes */}
        {ALL_COLS.map(col =>
          Array.from({ length: ROWS }, (_, i) => i + 1).map(row => (
            <Circle key={`${col}${row}`}
              x={colX(col)} y={rowY(row)}
              radius={HOLE_R}
              fill={getHoleFill(col, row)}
              stroke={CLR.holeRim} strokeWidth={1}
            />
          ))
        )}

        {/* Rail holes */}
        {Array.from({ length: ROWS }, (_, i) => i + 1).map(row => {
          const lv  = simResult?.node_voltages?.[nodeMap('PWR_L_POS')]
          const rv  = simResult?.node_voltages?.[nodeMap('PWR_R_POS')]
          const hlp = hovered?.col === 'rail_l+' && hovered?.row === row
          const hln = hovered?.col === 'rail_l-' && hovered?.row === row
          const hrp = hovered?.col === 'rail_r+' && hovered?.row === row
          const hrn = hovered?.col === 'rail_r-' && hovered?.row === row
          return (
            <Group key={`rail_${row}`}>
              <Circle x={RAIL_L_POS_X}  y={rowY(row)} radius={RAIL_HOLE_R}
                      fill={hlp ? CLR.holeHover : (lv > 0.1 ? '#fca5a5' : '#fecaca')}
                      stroke="#dc2626" strokeWidth={0.8} />
              <Circle x={RAIL_L_NEG_X}  y={rowY(row)} radius={RAIL_HOLE_R}
                      fill={hln ? CLR.holeHover : '#bfdbfe'}
                      stroke="#2563eb" strokeWidth={0.8} />
              <Circle x={RAIL_R_POS_X()} y={rowY(row)} radius={RAIL_HOLE_R}
                      fill={hrp ? CLR.holeHover : (rv > 0.1 ? '#fca5a5' : '#fecaca')}
                      stroke="#dc2626" strokeWidth={0.8} />
              <Circle x={RAIL_R_NEG_X()} y={rowY(row)} radius={RAIL_HOLE_R}
                      fill={hrn ? CLR.holeHover : '#bfdbfe'}
                      stroke="#2563eb" strokeWidth={0.8} />
            </Group>
          )
        })}

        {/* Wires */}
        {wires.map(w => {
          const p1 = holeXY(w.from.col, w.from.row)
          const p2 = holeXY(w.to.col, w.to.row)
          return (
            <Line key={w.id}
              points={[p1.x, p1.y, p2.x, p2.y]}
              stroke={w.color || '#16a34a'}
              strokeWidth={4} lineCap="round"
              shadowColor={w.color} shadowBlur={5} shadowOpacity={0.4}
            />
          )
        })}

        {/* Components */}
        {components.map(comp => (
          <ComponentShape
            key={comp.id} comp={comp}
            simResult={simResult}
            nodeMap={nodeMap}
            holeXY={holeXY}
          />
        ))}

        {/* Wire-start ring */}
        {wireStartXY && (
          <Circle x={wireStartXY.x} y={wireStartXY.y}
                  radius={HOLE_R + 5} fill="none"
                  stroke="#f59e0b" strokeWidth={2.5} dash={[4, 3]} />
        )}

        {/* Hover tooltip */}
        {hovered && (
          <Group>
            <Rect x={colX('a') - 6} y={0} width={190} height={18}
                  fill="#1f2937" cornerRadius={3} opacity={0.85} />
            <Text x={colX('a') - 2} y={3}
                  text={`${hovered.col}${hovered.row}  →  node: ${posToNode(hovered.col, hovered.row)}`}
                  fontSize={10} fill="#fde68a" />
          </Group>
        )}
      </Layer>

      {/* ── Ratsnest ghost wires (MST suggestions) ── */}
      {showRatsnest && ratsnestEdges.length > 0 && (
        <Layer>
          {ratsnestEdges.map((e, i) => (
            <Line key={i}
              points={[e.fromX, e.fromY, e.toX, e.toY]}
              stroke="#f59e0b"
              strokeWidth={1.5}
              dash={[6, 4]}
              opacity={0.7}
              lineCap="round"
            />
          ))}
          {/* Label at midpoint of each edge */}
          {ratsnestEdges.map((e, i) => {
            const mx = (e.fromX + e.toX) / 2
            const my = (e.fromY + e.toY) / 2
            return (
              <Text key={`lbl_${i}`}
                x={mx - 18} y={my - 8}
                text={`${e.fromNode}↔${e.toNode}`}
                fontSize={7} fill="#b45309"
                opacity={0.8}
              />
            )
          })}
        </Layer>
      )}
    </Stage>
  )
}

// ── Wire color helper ─────────────────────────────────────────────────────────
const WIRE_COLORS = ['#16a34a','#ea580c','#7c3aed','#0891b2','#db2777','#854d0e']
let _wci = 0
function wireColor(from, to) {
  const rc = from.col.startsWith('rail') ? from.col : to.col.startsWith('rail') ? to.col : null
  if (rc) return rc.endsWith('+') ? '#dc2626' : '#2563eb'
  return WIRE_COLORS[_wci++ % WIRE_COLORS.length]
}

// ── Component placement ───────────────────────────────────────────────────────
function buildComponent(palette, hole) {
  const id = nextId(palette.type[0].toUpperCase())
  const { col, row } = hole
  const params = { ...palette }

  // Orient upward if near bottom of board, downward otherwise
  const SPAN = 2
  const goUp = row + SPAN > ROWS
  const row2 = goUp ? Math.max(row - SPAN, 1) : Math.min(row + SPAN, ROWS)

  const twoPin = (na, nb) => ({
    id, type: palette.type, label: palette.label || id, params,
    pin1: { col, row },
    pin2: { col, row: row2 },
    nodes: { [na]: posToNode(col, row), [nb]: posToNode(col, row2) },
  })

  switch (palette.type) {
    case 'resistor':  return twoPin('p', 'n')
    case 'led':       return twoPin('anode', 'cathode')
    case 'zener':     return twoPin('anode', 'cathode')
    case 'diode':     return twoPin('anode', 'cathode')
    case 'capacitor': return twoPin('p', 'n')
    case 'battery':
      return {
        id, type: 'battery', label: palette.label || id, params,
        pin1: { col, row },
        pin2: { col, row: row2 },
        nodes: { pos: posToNode(col, row), neg: 'GND' },
      }
    case 'ldr': return twoPin('p', 'n')

    case 'bjt': {
      const goUp3 = row + 4 > ROWS
      const r2 = goUp3 ? row - 2 : row + 2
      const r3 = goUp3 ? row - 4 : row + 4
      return {
        id, type: 'bjt', label: palette.label || id, params,
        pin1: { col, row },
        pin2: { col, row: r2 },
        pin3: { col, row: r3 },
        nodes: {
          base:      posToNode(col, row),
          collector: posToNode(col, r2),
          emitter:   posToNode(col, r3),
        },
      }
    }

    case 'mosfet': {
      const goUp3 = row + 4 > ROWS
      const r2 = goUp3 ? row - 2 : row + 2
      const r3 = goUp3 ? row - 4 : row + 4
      return {
        id, type: 'mosfet', label: palette.label || id, params,
        pin1: { col, row },        // gate
        pin2: { col, row: r2 },    // drain
        pin3: { col, row: r3 },    // source
        nodes: {
          gate:   posToNode(col, row),
          drain:  posToNode(col, r2),
          source: posToNode(col, r3),
        },
      }
    }

    case 'potentiometer': {
      const goUp3 = row + 4 > ROWS
      const r2 = goUp3 ? row - 2 : row + 2
      const r3 = goUp3 ? row - 4 : row + 4
      return {
        id, type: 'potentiometer', label: palette.label || id, params,
        pin1: { col, row },        // end a
        pin2: { col, row: r2 },    // wiper
        pin3: { col, row: r3 },    // end b
        nodes: {
          a:     posToNode(col, row),
          wiper: posToNode(col, r2),
          b:     posToNode(col, r3),
        },
      }
    }

    case 'opamp': {
      // 5 pins down one column: +in, −in, out, V−, V+
      const goUp5 = row + 4 > ROWS
      const r = (k) => goUp5 ? row - k : row + k
      return {
        id, type: 'opamp', label: palette.label || id, params,
        pin1: { col, row },        // non_inv
        pin2: { col, row: r(1) },  // inv
        pin3: { col, row: r(2) },  // out
        pin4: { col, row: r(3) },  // v_neg
        pin5: { col, row: r(4) },  // v_pos
        nodes: {
          non_inv: posToNode(col, row),
          inv:     posToNode(col, r(1)),
          out:     posToNode(col, r(2)),
          v_neg:   posToNode(col, r(3)),
          v_pos:   posToNode(col, r(4)),
        },
      }
    }
    case 'mcu':
    case 'ic':
      return {
        id, type: palette.type, label: palette.label || id, params,
        pin1: { col: 'e', row },
        pin2: { col: 'f', row },
        nodes: { left: posToNode('e', row), right: posToNode('f', row) },
      }
    default:
      return twoPin('p', 'n')
  }
}
