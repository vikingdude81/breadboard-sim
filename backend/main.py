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


# ── Routes ───────────────────────────────────────────────────────────────────

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
    solver = MNASolver()

    for comp in req.components:
        t = comp.type
        p = comp.params
        n = comp.nodes

        try:
            if t == "battery":
                solver.add_voltage_source(
                    comp.id, n["pos"], n["neg"], p.get("voltage", 9.0)
                )
            elif t == "resistor":
                solver.add_resistor(comp.id, n["p"], n["n"], p.get("resistance", 1000))
            elif t == "led":
                solver.add_led(comp.id, n["anode"], n["cathode"],
                               p.get("vf", 2.0), p.get("color", "red"))
            elif t == "zener":
                solver.add_zener(comp.id, n["anode"], n["cathode"],
                                 p.get("vf", 0.7), p.get("vz", 5.1))
            elif t == "diode":
                solver.add_led(comp.id, n["anode"], n["cathode"],
                               p.get("vf", 0.7), "diode")
            elif t == "bjt":
                solver.add_bjt(comp.id, n["collector"], n["base"], n["emitter"],
                               p.get("bjt_type", "NPN"), p.get("hfe", 100),
                               p.get("vbe", 0.7))
            elif t == "current_source":
                solver.add_current_source(comp.id, n["pos"], n["neg"],
                                          p.get("current", 0.001))
        except KeyError as e:
            raise HTTPException(status_code=400,
                                detail=f"Missing node pin {e} for component {comp.id}")

    try:
        result = solver.solve()
    except CircuitError as e:
        raise HTTPException(status_code=422, detail=str(e))

    return result


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
