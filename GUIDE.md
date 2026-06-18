# Breadboard Simulator — How-To Guide & Tutorial

An interactive circuit simulator built with React + Konva (frontend) and FastAPI + NumPy (backend). Place components, draw wires, run MNA simulation, and use AI-powered debugging.

---

## Table of Contents

1. [Getting Started](#1-getting-started)
2. [The Interface](#2-the-interface)
3. [Placing Components](#3-placing-components)
4. [Drawing Wires](#4-drawing-wires)
5. [Running a Simulation](#5-running-a-simulation)
6. [Tutorial: LED + Resistor Circuit](#tutorial-led--resistor-circuit)
7. [Tutorial: NPN BJT Switch](#tutorial-npn-bjt-switch)
8. [Oscilloscope (Transient Analysis)](#8-oscilloscope-transient-analysis)
9. [ERC — Electrical Rules Check](#9-erc--electrical-rules-check)
10. [Ratsnest Wire Suggestions](#10-ratsnest-wire-suggestions)
11. [SPICE Netlist Export](#11-spice-netlist-export)
12. [AI Circuit Assistant](#12-ai-circuit-assistant)
13. [AI Auto-Debug](#13-ai-auto-debug)
14. [Component Reference](#14-component-reference)
15. [Keyboard Shortcuts & Tips](#15-keyboard-shortcuts--tips)
16. [Tutorial: 2N2222 BJT QRNG](#16-tutorial-2n2222-bjt-qrng)

---

## 1. Getting Started

### Running locally

```bash
# Backend (FastAPI solver)
cd backend
pip install fastapi uvicorn numpy
uvicorn main:app --reload --port 8000

# Frontend (React + Vite)
cd frontend
npm install
npm run dev
```

Open **http://localhost:5173** in your browser.

### What you need

| Requirement | Details |
|---|---|
| Python 3.9+ | For the MNA solver backend |
| Node 18+ | For the React frontend |
| Local LLM (optional) | LM Studio at `http://192.168.50.150:1234` with `google/gemma-4-26b-a4b` for AI features |

---

## 2. The Interface

```
┌─────────────────────────────────────────────────────────────────┐
│  ⚡ Breadboard Simulator   [🕸 Ratsnest] [🧠 Auto-Debug] [📡 Scope] [🤖 AI]  │
├──────────┬──────────────────────────────────────┬───────────────┤
│          │                                      │               │
│ Palette  │         Breadboard Canvas            │  Sim Panel    │
│ (left)   │         (center — main area)         │  (right)      │
│          │                                      │               │
│ Pick a   │  30 rows × 10 cols (a–j)             │  Sim / ERC /  │
│ component│  Left rails: + (red) − (blue)        │  History tabs │
│ to place │  Right rails: + (red) − (blue)       │               │
└──────────┴──────────────────────────────────────┴───────────────┘
```

**Floating panels** (AI, Scope, Auto-Debug) overlay the board from the right — they don't shrink the canvas.

### Board layout

- **Columns a–e** (left half): each row shares one electrical node named `LE{row}` (e.g. `LE5`)
- **Columns f–j** (right half): each row shares one node named `RE{row}`
- **Left power rails**: red column = `PWR_L_POS`, blue = `PWR_L_NEG`
- **Right power rails**: red = `PWR_R_POS`, blue = `PWR_R_NEG`
- The **centre divider** separates left and right halves — components cannot bridge it

---

## 3. Placing Components

1. **Click a component** in the left palette — a status bar appears: `📍 Click board to place: 9V Battery`
2. **Click any hole** on the board — the component snaps to that row in the same column
3. The tool **auto-deselects** after placing so your next click draws a wire
4. Press **Esc** at any time to cancel placement

### Placement rules

| Component | Pins | Span |
|---|---|---|
| Resistor, LED, Capacitor, Diode, Zener, Battery | 2 | 2 rows |
| BJT (NPN/PNP) | 3 (base, collector, emitter) | 4 rows |
| MOSFET | 2 visible (gate/source or drain/source) | 2 rows |
| Op-Amp | 2 visible + power | 2 rows |
| Potentiometer | 3 (a, wiper, b) | 2 rows |

Components placed near the bottom of the board automatically orient upward.

---

## 4. Drawing Wires

1. After placing a component (or pressing Esc), you're in wire mode
2. **Click a hole** — a pulsing orange ring marks the start point
3. **Click a second hole** — the wire is drawn and automatically coloured:
   - Red wire → connected to `+` rail
   - Blue wire → connected to `−` rail
   - Rotating colours (green, orange, purple…) → signal wires
4. Click the **same hole twice** to cancel the current wire

**Tip**: Hover over any hole to see its node name in the tooltip bar (e.g. `a5 → node: LE5`).

---

## 5. Running a Simulation

1. Click **▶ Run Simulation** in the SimPanel (right side)
2. Results appear in three sections:
   - **LED States** — ON/OFF with measured forward voltage
   - **Node Voltages** — DC operating point voltage at every node
   - **Branch Currents** — current through each voltage source (mA)
3. Board holes change colour based on voltage — brighter orange = higher voltage

### What the solver does

The backend uses **Modified Nodal Analysis (MNA)** with Newton-Raphson iteration:

- Resistors, capacitors, potentiometers: linear stamps
- LEDs, diodes, zeners: Shockley model with n=2 (overflow-safe)
- BJTs: Ebers-Moll with direct Jacobian stamping
- MOSFETs: Shichman-Hodges Level-1
- Op-Amps: tanh saturation model

Convergence is typically < 50 iterations. Non-convergence returns an error message.

---

## Tutorial: LED + Resistor Circuit

**Goal**: Light up a red LED from a 9V battery with a current-limiting resistor.

### Step 1 — Place the battery

1. In the palette, click **9V Battery**
2. Click hole **a1** — battery places at a1 (pos) and a3 (neg, connected to GND automatically)
3. Wire the positive terminal to the power rail:
   - Click **a1**, then click the **red rail hole at row 1** → red wire drawn

### Step 2 — Place the resistor

1. Click **330Ω Resistor** in the palette
2. Click **a5** — resistor places at a5–a7
3. Wire rail to resistor: click **red rail row 5**, then **a5**

### Step 3 — Place the LED

1. Click **Red LED** in the palette
2. Click **a9** — LED places at a9 (anode) and a11 (cathode)
3. Wire resistor to LED: click **a7**, then **a9**
4. Wire LED cathode to ground: click **a11**, then the **blue rail row 11**
5. Wire blue rail to battery negative: click **blue rail row 3**, then **a3**

### Step 4 — Simulate

Click **▶ Run Simulation**. You should see:

```
LED States
  D1: ON (2.00V)

Node Voltages
  LE1: 9.0000 V
  LE5: 9.0000 V
  LE7: 6.9800 V    ← after resistor drop
  LE9: 2.0033 V    ← LED forward voltage

Branch Currents
  B1: -21.203 mA
```

The LED is on, ~21mA flowing — correct for a 330Ω resistor with a 2V LED on 9V.

---

## Tutorial: NPN BJT Switch

**Goal**: Use a 2N2222 NPN transistor to switch an LED on via a base resistor.

### Circuit

```
9V ──[R1 1kΩ]──► base
                  │
              2N2222 NPN
                  │
9V ──[R2 470Ω]──► collector ──► LED ──► GND
                  │
                emitter ──► GND
```

### Steps

1. Place **9V Battery** at a1–a3 (neg → GND)
2. Wire a1 → red rail row 1
3. Place **1kΩ Resistor** (base resistor) at a5–a7; wire a5 → red rail row 5
4. Place **2N2222 NPN BJT** at c10 — pins: base=c10, collector=c12, emitter=c14
5. Wire a7 → c10 (base drive)
6. Wire c14 → blue rail row 14; wire blue rail row 3 → a3 (complete ground)
7. Place **470Ω Resistor** at c7–c9 (collector resistor)
8. Wire red rail row 7 → c7
9. Place **Red LED** at c9–c11; wire c9 → collector (c12); wire c11 → blue rail row 11

Click **▶ Run Simulation**. Expected: LED ON, Vc ≈ 0.05–0.2V (transistor in saturation).

---

## 8. Oscilloscope (Transient Analysis)

Click **📡 Scope** in the header to open the oscilloscope panel.

### Controls

| Control | Purpose |
|---|---|
| **t_stop** | Total simulation time (e.g. `10` ms) |
| **dt** | Time step (e.g. `0.1` ms — smaller = more accurate but slower) |
| **Unit** | µs / ms / s selector |
| **Probe nodes** | Type a node name (e.g. `LE5`) or click a board hole |
| **▶ Run Transient** | Starts the backward-Euler transient solver |

### Reading the scope

- Each probe node gets its own coloured trace
- Y-axis shows voltage; X-axis shows time
- Grid lines every 20% of time span
- Voltage labels on left edge

### Example: RC charging curve

1. Place 9V battery, 10kΩ resistor, 1µF capacitor in series
2. Open Scope, set t_stop=10, dt=0.1, unit=ms
3. Add probe node `LE5` (junction between R and C)
4. Click **▶ Run Transient**
5. You'll see the classic exponential charge curve with τ = RC = 10ms

---

## 9. ERC — Electrical Rules Check

Click the **ERC** tab in the SimPanel (right side).

The ERC runs automatically on every board change — no simulation needed. It uses a KiCad-style pin-type compatibility matrix.

### Violation types

| Type | Severity | Meaning |
|---|---|---|
| `undriven_input` | Error | An INPUT pin (BJT base, gate, op-amp input) has no driver on its net |
| `output_conflict` | Error | Two OUTPUT or POWER_OUT pins are shorted together |
| `pin_conflict` | Error | Two incompatible pin types share a node |
| `floating_pin` | Warning | A component pin connects to no other component |
| `no_ground` | Error | No node is connected to GND/0/blue rail |
| `no_power` | Warning | No battery or current source placed |
| `unconnected_component` | Warning | A component has zero wired connections |

### Pin types

| Type | Examples |
|---|---|
| POWER_OUT | Battery + terminal, regulator output |
| POWER_IN | IC VCC/GND pins, op-amp supply |
| OUTPUT | BJT collector, op-amp output, MOSFET drain |
| INPUT | BJT base, MOSFET gate, op-amp inputs |
| PASSIVE | Resistor, capacitor, LED, diode pins |

Two OUTPUTs on the same node = error (short circuit). An INPUT with no driver = error (floating gate/base).

---

## 10. Ratsnest Wire Suggestions

Click **🕸 Ratsnest** in the header to toggle ghost wire suggestions.

### What it shows

Dashed amber lines appear on the board showing the **minimum set of wires** needed to connect all electrically isolated component clusters. This is a **Kruskal Minimum Spanning Tree** over the disconnected clusters — the same algorithm used in KiCad's PCB editor.

- Each line connects the two closest unconnected pins between two clusters
- The node names are labelled at the midpoint
- Wires you've already drawn cause those clusters to merge (lines disappear)

### How to use it

1. Place several components without wiring them
2. Toggle **🕸 Ratsnest** — see which pins need connecting
3. Draw wires following the suggestions
4. As you wire, the ghost lines disappear (clusters merge)
5. When no lines remain, the circuit is fully connected

---

## 11. SPICE Netlist Export

In the **SimPanel**, click **⬇ Export SPICE (.cir)** to download a SPICE 3 / ngspice / LTspice compatible netlist.

### Supported elements

| Component | SPICE element | Notes |
|---|---|---|
| Battery | `V` | DC voltage source |
| Resistor | `R` | |
| Capacitor | `C` | Includes `IC=` initial condition from sim |
| LED | `D` + `.model` | EG parameter adjusted to match Vf |
| Diode | `D` + `.model` | 1N4148 model |
| Zener | `D` + `.model` | BV = Vz breakdown voltage |
| BJT | `Q` + `.model` | NPN/PNP, hFE mapped to BF |
| MOSFET | `M` + `.model` | Level-1 Shichman-Hodges, K→KP |
| Op-Amp | `X` + `.subckt` | Ideal op-amp subcircuit |
| Potentiometer | Two `R` elements | Split at wiper position |
| Current Source | `I` | DC current source |

### Using in ngspice / LTspice

1. Export the `.cir` file
2. Open in LTspice: **File → Open** → select the file
3. Add `.tran 1u 1m` for transient or `.ac dec 100 1Hz 1Meg` for AC sweep
4. The file includes commented-out analysis lines you can uncomment

---

## 12. AI Circuit Assistant

Click **🤖 AI** in the header. Requires LM Studio running at `http://192.168.50.150:1234`.

### Modes

| Tab | What it does |
|---|---|
| **Analyse** | Describes what the circuit does, flags issues, suggests improvements |
| **Guide** | Step-by-step wiring instructions for your specific board layout |
| **Research** | Generates a complete new circuit (components + wires) as JSON and loads it onto the board |

### Research mode — auto-build a circuit

1. Click the **Research** tab
2. Type what you want, e.g. *"Build a common-emitter amplifier with 2N2222"*
3. The AI returns a JSON circuit definition
4. Click **▶ Load onto Board** — components and wires appear instantly

### Tips for good results

- Be specific: *"9V battery, LED with 330Ω resistor"* works better than *"LED circuit"*
- Mention the supply voltage so the AI chooses correct resistor values
- After loading, run **ERC** to check for any wiring issues before simulating

---

## 13. AI Auto-Debug

Click **🧠 Auto-Debug** in the header. Uses `google/gemma-4-26b-a4b` locally.

### Two modes

#### Ask AI to Fix (single-shot)
1. Place components on the board (they don't need to be pre-simulated)
2. Click **🔍 Ask AI to Fix**
3. The panel automatically simulates, detects anomalies, streams the AI response
4. A fix plan appears showing each proposed change with a reason
5. Click **✓ Apply All Fixes** to apply, or **Skip** to dismiss

#### Auto Loop (autonomous)
1. Click **🤖 Auto Loop**
2. The AI runs up to 6 iterations:
   - Simulate → Detect anomalies → Ask LLM → Apply fixes → repeat
3. Stops when no anomalies remain or max iterations reached
4. The **Auto-Debug Log** shows each iteration's status
5. Click **■ Stop** to halt at any time

### What the AI can fix

| Fix action | Example |
|---|---|
| `change_param` | Increase resistor from 33Ω to 330Ω |
| `add_wire` | Connect LED cathode to ground rail |
| `add_component` | Insert missing current-limiting resistor |
| `remove_component` | Remove redundant component |
| `remove_wire` | Delete short-circuit wire |

### Anomaly detection (deterministic, no LLM)

The panel always shows detected anomalies from two sources:
1. **ERC violations** — structural pin-type issues (no LLM needed)
2. **Simulation checks** — LED off with power present, 0V floating nodes, >5A short circuit

These are shown even if you don't run the AI, so you can spot obvious problems immediately.

---

## 14. Component Reference

### Passive

| Label | Type | Key params |
|---|---|---|
| Resistor (various) | `resistor` | `resistance` (Ω) |
| Capacitor 1µF | `capacitor` | `capacitance` (F) |
| Potentiometer 10kΩ / 100kΩ | `potentiometer` | `resistance`, `pos` (0–1) |
| LDR | `ldr` | `resistance` |

### Diodes

| Label | Type | Key params |
|---|---|---|
| Red/Green/Blue/Yellow/White LED | `led` | `vf` (V), `color` |
| 1N4148 Diode | `diode` | `vf` |
| 5.1V / 3.3V Zener | `zener` | `vz` (breakdown V) |

### Transistors

| Label | Type | Key params |
|---|---|---|
| 2N2222, BC547 NPN | `bjt` | `bjt_type: NPN`, `hfe` |
| 2N3906, BC557 PNP | `bjt` | `bjt_type: PNP`, `hfe` |
| 2N7000, BS170 N-ch MOSFET | `mosfet` | `mtype: N`, `vth`, `K` |
| BS250, IRF9540 P-ch MOSFET | `mosfet` | `mtype: P`, `vth`, `K` |

### Active / Power

| Label | Type | Key params |
|---|---|---|
| 9V / 5V / 3.3V Battery | `battery` | `voltage` (V) |
| Current Source 1mA / 10mA | `current_source` | `current` (A) |
| LM741, LM358, TL071 Op-Amp | `opamp` | `Aol`, `Rin`, `Rout` |

### Logic (subcircuit stubs)

NOT, AND, OR, NAND, NOR, XOR gates are available in the palette as placeholders for schematic annotation. Full digital simulation is not yet implemented.

---

## 15. Keyboard Shortcuts & Tips

| Action | How |
|---|---|
| Cancel placement | **Esc** |
| Undo last action | **↩ Undo Last** button in History tab |
| Remove a component | Click the **✕** on its shape on the board |
| Remove from history | Click **✕** next to any history entry |
| Clear everything | **✕ Clear Board** in SimPanel |
| See node name | Hover any hole — tooltip shows `col row → node: XXX` |

### Common mistakes

| Symptom | Likely cause | Fix |
|---|---|---|
| LED shows OFF after sim | Missing ground wire from cathode | Wire cathode → blue rail; wire blue rail → battery − |
| Node voltage stuck at 0V | Component placed but not wired | Check ratsnest for missing connections |
| Simulation won't converge | Short circuit or conflicting sources | Check ERC tab for output conflicts |
| BJT Vc wrong | Base has no current-limiting resistor | Add 1kΩ–10kΩ between signal and base |
| Auto-Debug stuck | LLM not reachable | Check LM Studio is running at port 1234 |

### Power rail wiring pattern

For most circuits follow this template:

```
Battery pos (+) → red rail
Battery neg (−) → blue rail  [or mark neg node as GND]
Components → connect between red rail and blue rail
```

The battery negative terminal auto-assigns to `GND` when placed — you only need to wire the positive terminal to the red rail.

---

## 16. Tutorial: 2N2222 BJT QRNG

The 2N2222's base-emitter (B-E) junction avalanches at approximately 7–8 V when reverse-biased, producing genuine shot noise from random electron-hole pair generation — the same quantum mechanical process as the paper's InGaAs APD, just at a much slower and cheaper scale. Each carrier avalanche is a discrete quantum event with inherently unpredictable timing, giving you true hardware entropy rather than pseudo-random output.

**Physics explainer:** Reverse-biasing the B-E junction beyond its breakdown voltage (~7.5 V for the 2N2222) causes avalanche multiplication — a single carrier accelerated by the electric field gains enough energy to ionise further atoms, producing a cascade. Each cascade event is a quantum event with inherently random timing. The resulting noise voltage is wideband and fundamentally unpredictable — not computable from any prior state.

### What you need

| Part | Value | Notes |
|---|---|---|
| 2N2222 NPN BJT | × 1 | Any standard TO-18 or TO-92 package |
| Resistor R1 | 470 kΩ | Sets reverse bias current — do NOT go lower |
| Resistor R2 | 100 kΩ | Coupling + current limit to ADC |
| Resistor R3 | 10 kΩ | Pull-down keeps A0 in ADC range |
| 9V battery | 1 | Must be 9V — 5V is not enough to reach B-E breakdown |
| Seeed XIAO (any) | 1 | ESP32-C3 or S3 recommended for QRNG |
| Breadboard + wires | — | Standard half-size breadboard |

> **Why 9V is required:** The 2N2222 B-E junction breaks down at ~7.5 V. A 5 V supply never reaches breakdown, so no avalanche noise is produced. The 9 V − 7.5 V = 1.5 V across R1 at 470 kΩ gives only ~3 µA — just enough to sustain avalanche without damaging the transistor.

### Step-by-step breadboard instructions

**Step 1** — Place the 9V battery: positive terminal to red power rail, negative terminal to blue power rail (GND).

**Step 2** — Place R1 (470 kΩ) from the red power rail to a free row — this row becomes the **QNOISE** node.

**Step 3** — Place the 2N2222: insert the **base** pin into the QNOISE row, **emitter** to the blue rail (GND), **collector** to the blue rail (GND). Only the B-E junction is used in this circuit.

**Step 4** — Place R2 (100 kΩ) from the QNOISE row to another free row — this becomes the **ADC0** row.

**Step 5** — Place R3 (10 kΩ) from the ADC0 row to the blue rail (GND).

**Step 6** — Wire the XIAO: **A0** to the ADC0 row, **GND** to the blue rail. Power the XIAO from USB.

**Step 7** — Wire the battery: negative to blue rail (if not already connected), positive to red rail.

### Wiring diagram

```
9V+ ──[R1 470kΩ]──┬── 2N2222 base (B-E reverse biased, avalanche noise)
                  │         emitter → GND
                  │         collector → GND
                  │
                  ├──[R2 100kΩ]──┬── XIAO A0
                                 │
                               [R3 10kΩ]
                                 │
                                GND
```

### In-app simulation steps

1. Click **⚡ Load QRNG Circuit** → select **BJT (2N2222)** variant
2. Click **▶ Run Simulation** — node `QNOISE` shows ~7.5 V (avalanche clamp), `ADC0` shows ~0.68 V after divider
3. Open **📡 Scope**, probe `QNOISE`, run transient — flat DC line (the noise is real hardware only, not simulated stochastically in DC mode)
4. Open **🔌 Live**, click **Connect XIAO** — requires firmware flashed with `#define SOURCE_BJT`
5. The live histogram shows the ADC distribution; min-entropy/bit is displayed

### Expected simulation results

```
Node Voltages
  V9:     9.0000 V
  QNOISE: 7.5000 V   ← B-E avalanche clamp (DC model)
  ADC0:   0.6818 V   ← R2/R3 divider output (7.5 × 10k/110k)

Branch Currents
  BAT1:  -0.003 mA   ← only ~3µA through R1 into the junction
```

> **Note on DC vs live:** The MNA solver models the B-E junction as a deterministic voltage clamp at the breakdown voltage. The real noise — µV to mV of wideband randomness — only appears in the physical hardware and the Live panel when the XIAO is connected. The Scope transient will show a flat line, which is correct.

### Firmware setup

1. Open `firmware/qrng_live/qrng_live.ino` in Arduino IDE
2. Ensure `#define SOURCE_BJT` is uncommented (comment out `SOURCE_ZENER` if present)
3. Select board: **XIAO_ESP32C3**
4. Upload
5. Open the Live panel → click **Connect XIAO** → pick the serial port
6. You should see `QRNG-LIVE source=BJT` in the serial header

### Reading the Live panel

- **Min-entropy/bit** — target > 0.5; > 0.8 is excellent for raw ADC samples
- **Bias** — should be close to 0.5 (equal 0s and 1s in the raw bit stream)
- **Von Neumann throughput** — whitened bit rate after debiasing; typically 10–40% of raw sample rate
- **Histogram** — should look roughly uniform across the ADC range; a spike at 0 or 4095 indicates the avalanche is not sustaining (check R1 value and 9V supply)

### Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| QNOISE stuck at 9V in sim | BJT not placed correctly | Check base in QNOISE row, emitter+collector to GND |
| QNOISE stuck at 0V in sim | R1 missing or wrong value | Verify R1 = 470 kΩ from V9 to QNOISE |
| Live histogram spike at 0 | B-E not in avalanche | Check 9V supply; try a different 2N2222 |
| Live histogram spike at 4095 | R2/R3 divider missing | Wire R2 and R3 before connecting to XIAO |
| Min-entropy < 0.3 | ADC noise floor too low | Try 2-stage op-amp amplification before ADC |
| `QRNG-LIVE source=ZENER` shown | Wrong firmware build | Re-flash with `#define SOURCE_BJT` |

### Comparison to Zener QRNG

| | Zener (BZX79-C5V1) | 2N2222 BJT B-E |
|---|---|---|
| Breakdown voltage | 5.1 V | ~7.5 V |
| Min supply | 6 V | 9 V |
| Noise floor (approx) | ~200 nV/√Hz | ~500–1000 nV/√Hz |
| Cost | ~£0.10 | ~£0.05 |
| Temperature stability | Better | More variable (more noise!) |
| Circuit complexity | Slightly simpler | Same |
| Entropy quality | Good | Good–Excellent |

> **Final tip:** Running both a Zener and a 2N2222 in parallel and XOR-ing their bit streams gives higher entropy than either alone — the two noise sources are physically independent. The simulator supports both templates simultaneously.
