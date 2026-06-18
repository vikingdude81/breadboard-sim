/**
 * Pre-built circuit layouts that drop straight onto the board (real holes,
 * real nets), ready to simulate and edit.
 *
 * Nets are formed by co-locating pins on the same row-half (cols a–e share
 * node LE{row}); ground pins use 'GND' directly. No wires required.
 */

// Zener-avalanche QRNG bias front-end for a Seeed XIAO ADC.
//   9V → R1(10k) → Zener 5.1V (ZNOISE) → R2(100k) → ADC node ← R3(10k) → GND
//   ZNOISE = LE5, ADC0 = LE8, V9 = LE2.
export function qrngLayout() {
  const components = [
    { id: 'BAT1', type: 'battery', label: '9V Battery', params: { voltage: 9 },
      pin1: { col: 'a', row: 2 }, pin2: { col: 'a', row: 4 },
      nodes: { pos: 'LE2', neg: 'GND' } },

    { id: 'R1', type: 'resistor', label: '10kΩ bias', params: { resistance: 10000 },
      pin1: { col: 'b', row: 2 }, pin2: { col: 'b', row: 5 },
      nodes: { p: 'LE2', n: 'LE5' } },

    { id: 'Z1', type: 'zener', label: 'Zener 5.1V (BZX79-C5V1)',
      params: { vf: 0.7, vz: 5.1, noise_model: 'avalanche' },
      pin1: { col: 'a', row: 5 }, pin2: { col: 'a', row: 7 },
      nodes: { cathode: 'LE5', anode: 'GND' } },

    { id: 'R2', type: 'resistor', label: '100kΩ couple', params: { resistance: 100000 },
      pin1: { col: 'c', row: 5 }, pin2: { col: 'c', row: 8 },
      nodes: { p: 'LE5', n: 'LE8' } },

    { id: 'R3', type: 'resistor', label: '10kΩ pulldown', params: { resistance: 10000 },
      pin1: { col: 'a', row: 8 }, pin2: { col: 'a', row: 10 },
      nodes: { p: 'LE8', n: 'GND' } },

    // XIAO ADC tap (not simulated — shows where A0 lands, on the ADC0 net).
    { id: 'XIAO1', type: 'mcu', label: 'XIAO ESP32-C3',
      params: { model: 'MCU_XIAO_ESP32C3', vcc: 3.3, adc_bits: 12 },
      pin1: { col: 'e', row: 8 }, pin2: { col: 'f', row: 8 },
      nodes: { A0: 'LE8', GND: 'GND', '3V3': 'VCC3V3' } },
  ]

  return { format: 'breadboard-sim', version: 1, components, wires: [] }
}
