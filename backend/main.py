from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Dict, List, Optional, Any
from solver import MNASolver, CircuitError
from components import list_components, get_component

app = FastAPI(title="Breadboard Simulator API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Data models ──────────────────────────────────────────────────────────────

class ComponentInstance(BaseModel):
    id: str               # unique instance id  e.g. "R1"
    type: str             # "resistor" | "led" | "bjt" | "zener" | "battery" | ...
    params: Dict[str, Any]
    nodes: Dict[str, str] # pin_name -> board_node e.g. {"p": "a5", "n": "a6"}

class SimRequest(BaseModel):
    components: List[ComponentInstance]

class NetlistRequest(BaseModel):
    """Raw netlist for advanced users / QRNG template."""
    netlist: str  # SPICE-like text (future)

class TransientRequest(BaseModel):
    components: List[ComponentInstance]
    t_stop: float = 1e-3       # simulation end time (seconds)
    dt: float = 1e-6           # time step (seconds)
    probe_nodes: Optional[List[str]] = None  # nodes to record; None = all

class ACRequest(BaseModel):
    components: List[ComponentInstance]
    f_start: float = 1.0       # sweep start frequency (Hz)
    f_stop: float = 1e6        # sweep stop frequency (Hz)
    points_per_decade: int = 20
    ac_source: Optional[str] = None          # component id of the stimulus V source
    magnitude: float = 1.0                    # AC stimulus amplitude (V)
    probe_nodes: Optional[List[str]] = None


# ── Routes ───────────────────────────────────────────────────────────────────

@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/components")
def get_components(type: Optional[str] = None):
    return list_components(type)


@app.get("/components/{cid}")
def get_single_component(cid: str):
    comp = get_component(cid)
    if not comp:
        raise HTTPException(status_code=404, detail=f"Component '{cid}' not found")
    return comp


@app.post("/simulate")
def simulate(req: SimRequest):
    try:
        solver = _build_solver(req.components)
        return solver.solve()
    except CircuitError as e:
        raise HTTPException(status_code=422, detail=str(e))


@app.post("/simulate/transient")
def simulate_transient(req: TransientRequest):
    try:
        solver = _build_solver(req.components)
        return solver.solve_transient(
            t_stop=req.t_stop,
            dt=req.dt,
            probe_nodes=req.probe_nodes,
        )
    except CircuitError as e:
        raise HTTPException(status_code=422, detail=str(e))


@app.post("/simulate/ac")
def simulate_ac(req: ACRequest):
    try:
        solver = _build_solver(req.components)
        return solver.solve_ac(
            f_start=req.f_start,
            f_stop=req.f_stop,
            points_per_decade=req.points_per_decade,
            ac_source=req.ac_source,
            magnitude=req.magnitude,
            probe_nodes=req.probe_nodes,
        )
    except CircuitError as e:
        raise HTTPException(status_code=422, detail=str(e))


def _build_solver(components: List[ComponentInstance]) -> MNASolver:
    """Shared component-instantiation logic for DC and transient endpoints."""
    solver = MNASolver()
    for comp in components:
        t = comp.type
        p = comp.params
        n = comp.nodes
        try:
            if t == "battery":
                solver.add_voltage_source(comp.id, n["pos"], n["neg"],
                                          p.get("voltage", 9.0))
            elif t == "resistor":
                solver.add_resistor(comp.id, n["p"], n["n"],
                                    p.get("resistance", 1000))
            elif t == "ldr":
                # Light-dependent resistor — modelled as a plain resistor whose
                # value is set by the current light level (default = dark).
                solver.add_resistor(comp.id, n["p"], n["n"],
                                    p.get("resistance",
                                          p.get("R_dark", 10000)))
            elif t == "capacitor":
                solver.add_capacitor(comp.id, n["p"], n["n"],
                                     p.get("capacitance", 1e-6))
            elif t == "led":
                solver.add_led(comp.id, n["anode"], n["cathode"],
                               p.get("vf", 2.0), p.get("color", "red"))
            elif t == "zener":
                solver.add_zener(comp.id, n["anode"], n["cathode"],
                                 p.get("vf", 0.7), p.get("vz", 5.1))
            elif t == "diode":
                solver.add_diode(comp.id, n["anode"], n["cathode"],
                                 p.get("vf", 0.7))
            elif t == "bjt":
                if p.get("noise_model") == "bjt_avalanche":
                    solver.add_bjt_qrng(comp.id, n["base"], n["emitter"],
                                        p.get("vbe_avalanche", 7.5),
                                        p.get("r_bias", 470000))
                else:
                    solver.add_bjt(comp.id, n["collector"], n["base"], n["emitter"],
                                   p.get("bjt_type", "NPN"), p.get("hfe", 100),
                                   p.get("vbe", 0.7))
            elif t == "mosfet":
                solver.add_mosfet(comp.id, n["source"], n["gate"], n["drain"],
                                  p.get("mtype", "N"), p.get("vth", 2.0),
                                  p.get("K", 0.01), p.get("lam", 0.01))
            elif t == "opamp":
                solver.add_opamp(comp.id, n["non_inv"], n["inv"], n["out"],
                                 n["v_neg"], n["v_pos"],
                                 p.get("Rin", 1e6), p.get("Aol", 1e5),
                                 p.get("Rout", 75))
            elif t == "potentiometer":
                solver.add_potentiometer(comp.id, n["a"], n["wiper"], n["b"],
                                         p.get("resistance", 10000),
                                         p.get("pos", 0.5))
            elif t == "current_source":
                solver.add_current_source(comp.id, n["pos"], n["neg"],
                                          p.get("current", 0.001))
        except KeyError as e:
            raise HTTPException(status_code=400,
                                detail=f"Missing node pin {e} for {comp.id}")
    return solver


@app.get("/templates/zener-qrng")
def zener_qrng_template():
    """
    Returns a pre-wired Zener QRNG circuit for Seeed XIAO.

    Topology:
      9V → R_bias (10kΩ) → Zener cathode
      Zener anode → GND
      Zener cathode (= noise node) → R_couple (100kΩ) → XIAO ADC pin (A0)
      XIAO A0 also has 10kΩ pull-down to GND

    The avalanche noise on the Zener cathode is AC-coupled into the ADC.
    Each ADC sample's LSB(s) become raw entropy bits.
    """
    return {
        "description": "Zener avalanche QRNG for Seeed XIAO ESP32-C3/S3",
        "components": [
            {"id": "BAT1", "type": "battery",  "params": {"voltage": 9.0},
             "nodes": {"pos": "V9", "neg": "GND"}},

            {"id": "R1",   "type": "resistor", "params": {"resistance": 10000},
             "nodes": {"p": "V9", "n": "ZNOISE"}},

            {"id": "Z1",   "type": "zener",
             "params": {"vf": 0.7, "vz": 5.1, "noise_model": "avalanche"},
             "nodes": {"cathode": "ZNOISE", "anode": "GND"}},

            {"id": "R2",   "type": "resistor", "params": {"resistance": 100000},
             "nodes": {"p": "ZNOISE", "n": "ADC0"}},

            {"id": "R3",   "type": "resistor", "params": {"resistance": 10000},
             "nodes": {"p": "ADC0", "n": "GND"}},

            {"id": "XIAO1","type": "mcu",
             "params": {"model": "MCU_XIAO_ESP32C3", "vcc": 3.3},
             "nodes": {"A0": "ADC0", "3V3": "VCC3V3", "GND": "GND"}},
        ],
        "notes": [
            "Bias resistor R1 sets Zener current ≈ (9-5.1)/10k ≈ 390µA — enough for avalanche noise.",
            "R2+R3 form a divider: ~0.43× attenuation keeps noise within XIAO 3.3V ADC range.",
            "Sample at max ADC rate; use von Neumann extractor on LSBs for whitened bits.",
            "For better entropy: use BZX79-C5V1 Zener, op-amp pre-amp stage, and hardware whitening.",
        ],
        "xiao_code_hint": "analogRead(A0) → collect LSBs → von Neumann / XOR whitening → entropy pool",
    }


@app.get("/templates/bjt-qrng")
def bjt_qrng_template():
    """
    Returns a pre-wired 2N2222 BJT avalanche QRNG circuit for Seeed XIAO.

    Topology:
      9V ─[R1 470kΩ]─► 2N2222 base      (QNOISE node)
                        emitter → GND
                        collector → GND  (tied to emitter — B-E junction only)
      QNOISE ─[R2 100kΩ]─► ADC0
      ADC0   ─[R3 10kΩ]─►  GND
      XIAO A0 = ADC0

    R1 = 470kΩ sets reverse base current ≈ (9 - 7.5) / 470k ≈ 3µA — just into avalanche.
    R2 + R3 divider (100kΩ / 10kΩ) attenuates to keep signal in 0–3.3V ADC range.
    Only the B-E junction is used; collector and emitter are both tied to GND.
    """
    return {
        "description": "2N2222 BJT B-E avalanche QRNG for Seeed XIAO ESP32-C3/S3",
        "components": [
            {"id": "BAT1", "type": "battery",
             "params": {"voltage": 9.0},
             "nodes": {"pos": "V9", "neg": "GND"}},

            {"id": "R1",   "type": "resistor",
             "params": {"resistance": 470000},
             "nodes": {"p": "V9", "n": "QNOISE"}},

            {"id": "Q1",   "type": "bjt",
             "params": {"bjt_type": "NPN", "hfe": 100, "vbe": 0.7,
                        "noise_model": "bjt_avalanche", "vbe_avalanche": 7.5},
             "nodes": {"base": "QNOISE", "collector": "GND", "emitter": "GND"}},

            {"id": "R2",   "type": "resistor",
             "params": {"resistance": 100000},
             "nodes": {"p": "QNOISE", "n": "ADC0"}},

            {"id": "R3",   "type": "resistor",
             "params": {"resistance": 10000},
             "nodes": {"p": "ADC0", "n": "GND"}},

            {"id": "XIAO1", "type": "mcu",
             "params": {"model": "MCU_XIAO_ESP32C3", "vcc": 3.3},
             "nodes": {"A0": "ADC0", "3V3": "VCC3V3", "GND": "GND"}},
        ],
        "notes": [
            "R1 = 470kΩ sets reverse bias current ≈ (9−7.5)/470k ≈ 3µA — just enough to sustain avalanche.",
            "2N2222 B-E junction breaks down at ~7.5V; QNOISE node clamps at 7.5V (DC model).",
            "R2+R3 divider (100k/10k) attenuates to ~0.09× → ADC0 ≈ 0.61V, safely within 3.3V ADC range.",
            "Only the B-E junction is used; collector is tied to GND — no collector current flows.",
            "Real shot noise (µV–mV wideband) only appears in physical hardware / Live panel.",
            "Must use 9V supply — 5V cannot reach the ~7.5V B-E breakdown voltage.",
        ],
        "xiao_code_hint": "analogRead(A0) → collect LSBs → von Neumann / XOR whitening → entropy pool",
        "wiring_diagram": (
            "9V+ ──[R1 470kΩ]──┬── 2N2222 base (B-E reverse biased, avalanche noise)\n"
            "                  │         emitter → GND\n"
            "                  │         collector → GND\n"
            "                  │\n"
            "                  ├──[R2 100kΩ]──┬── XIAO A0\n"
            "                                 │\n"
            "                               [R3 10kΩ]\n"
            "                                 │\n"
            "                                GND"
        ),
    }
