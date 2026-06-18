"""
Unit tests for the MNA solver (DC operating point).

Run from backend/:  pytest -q
These exercise the math core directly with shared node names — wire-based
connectivity is a frontend concern (see frontend/src/netlist.js).
"""
import math
from solver import MNASolver, CircuitError


def test_series_resistor_current():
    """9V across a single 1kΩ resistor → 9 mA, node held at 9 V."""
    s = MNASolver()
    s.add_voltage_source("BAT", "A", "GND", 9.0)
    s.add_resistor("R1", "A", "GND", 1000)
    r = s.solve()
    assert r["converged"]
    assert math.isclose(r["node_voltages"]["A"], 9.0, abs_tol=1e-3)
    assert math.isclose(abs(r["branch_currents"]["BAT"]), 9e-3, rel_tol=1e-3)


def test_voltage_divider():
    """Two equal resistors split 9 V to 4.5 V at the midpoint."""
    s = MNASolver()
    s.add_voltage_source("BAT", "VIN", "GND", 9.0)
    s.add_resistor("R1", "VIN", "MID", 1000)
    s.add_resistor("R2", "MID", "GND", 1000)
    r = s.solve()
    assert math.isclose(r["node_voltages"]["VIN"], 9.0, abs_tol=1e-3)
    assert math.isclose(r["node_voltages"]["MID"], 4.5, abs_tol=1e-2)


def test_unequal_divider():
    """10k / 20k divider from 9 V → 6 V across the 20k."""
    s = MNASolver()
    s.add_voltage_source("BAT", "VIN", "GND", 9.0)
    s.add_resistor("R1", "VIN", "MID", 10000)
    s.add_resistor("R2", "MID", "GND", 20000)
    r = s.solve()
    assert math.isclose(r["node_voltages"]["MID"], 6.0, abs_tol=2e-2)


def test_led_with_series_resistor_on():
    """9V → 330Ω → LED(Vf=2) → GND.  LED on, ~21 mA, ~2 V across it."""
    s = MNASolver()
    s.add_voltage_source("BAT", "A", "GND", 9.0)
    s.add_resistor("R1", "A", "B", 330)
    s.add_led("D1", "B", "GND", vf=2.0, color="red")
    r = s.solve()
    led = r["led_states"]["D1"]
    assert led["on"] is True
    assert 1.7 < led["vd"] < 2.4
    i = abs(r["branch_currents"]["BAT"])
    assert 0.015 < i < 0.027   # (9-2)/330 ≈ 21 mA


def test_led_reverse_biased_off():
    """LED reversed (cathode to +) stays off, negligible current."""
    s = MNASolver()
    s.add_voltage_source("BAT", "A", "GND", 9.0)
    s.add_resistor("R1", "A", "B", 330)
    s.add_led("D1", "GND", "B", vf=2.0, color="red")  # anode=GND, cathode=B
    r = s.solve()
    assert r["led_states"]["D1"]["on"] is False
    assert abs(r["branch_currents"]["BAT"]) < 1e-3


def test_diode_forward_drop():
    """Forward diode clamps node near its ~0.7 V drop."""
    s = MNASolver()
    s.add_voltage_source("BAT", "A", "GND", 5.0)
    s.add_resistor("R1", "A", "B", 1000)
    s.add_diode("D1", "B", "GND", vf=0.7)
    r = s.solve()
    assert 0.5 < r["node_voltages"]["B"] < 0.9


def test_zener_clamps_in_reverse_breakdown():
    """Zener in reverse breakdown holds its node near Vz."""
    s = MNASolver()
    s.add_voltage_source("BAT", "V", "GND", 9.0)
    s.add_resistor("R1", "V", "Z", 1000)
    s.add_zener("Z1", "GND", "Z", vf=0.7, vz=5.1)  # cathode=Z, anode=GND
    r = s.solve()
    assert 4.6 < r["node_voltages"]["Z"] < 5.5


def test_npn_common_emitter_active():
    """NPN with base + collector resistors sits in the active region."""
    s = MNASolver()
    s.add_voltage_source("VCC", "V", "GND", 9.0)
    s.add_resistor("RB", "V", "B", 470000)
    s.add_resistor("RC", "V", "C", 1000)
    s.add_bjt("Q1", "C", "B", "GND", bjt_type="NPN", hfe=100, vbe=0.7)
    r = s.solve()
    vb = r["node_voltages"]["B"]
    vc = r["node_voltages"]["C"]
    assert 0.55 < vb < 0.8           # base-emitter junction drop
    assert 1.0 < vc < 8.5            # pulled down from 9V but not saturated


def test_nmos_common_source_pulls_drain_down():
    """N-channel MOSFET with Vgs>Vth conducts and pulls its drain below VDD."""
    s = MNASolver()
    s.add_voltage_source("VDD", "V", "GND", 10.0)
    s.add_voltage_source("VG", "G", "GND", 4.0)     # Vgs = 4, Vov = 2
    s.add_resistor("RD", "V", "D", 100)
    s.add_mosfet("M1", "GND", "G", "D", mtype="N", vth=2.0, K=0.01, lam=0.01)
    r = s.solve()
    vd = r["node_voltages"]["D"]
    assert vd < 10.0                 # device is conducting
    assert vd > 0.0                  # not a dead short


def test_opamp_voltage_follower():
    """Unity-gain buffer: output tracks the non-inverting input."""
    s = MNASolver()
    s.add_voltage_source("VP",  "VPOS", "GND", 12.0)   # + supply
    s.add_voltage_source("REF", "NI",   "GND", 3.0)    # reference into +in
    # nodes: non_inv, inv, out, v_neg, v_pos ; inv tied to out (feedback)
    s.add_opamp("U1", "NI", "OUT", "OUT", "GND", "VPOS")
    s.add_resistor("RL", "OUT", "GND", 10000)          # light load
    r = s.solve()
    assert math.isclose(r["node_voltages"]["OUT"], 3.0, abs_tol=0.1)


def test_opamp_noninverting_gain():
    """Non-inverting amp with Rf=Rg → gain 2: 2V in → 4V out, virtual short holds."""
    s = MNASolver()
    s.add_voltage_source("VP",  "VPOS", "GND", 12.0)
    s.add_voltage_source("REF", "NI",   "GND", 2.0)
    s.add_opamp("U1", "NI", "INV", "OUT", "GND", "VPOS")
    s.add_resistor("Rf", "OUT", "INV", 10000)
    s.add_resistor("Rg", "INV", "GND", 10000)
    r = s.solve()
    assert math.isclose(r["node_voltages"]["OUT"], 4.0, abs_tol=0.1)
    assert math.isclose(r["node_voltages"]["INV"], 2.0, abs_tol=0.1)   # virtual short


def test_rc_charging_transient():
    """1k·1µF RC (τ=1ms) charges toward the 5V rail."""
    s = MNASolver()
    s.add_voltage_source("BAT", "A", "GND", 5.0)
    s.add_resistor("R1", "A", "B", 1000)
    s.add_capacitor("C1", "B", "GND", 1e-6)
    out = s.solve_transient(t_stop=5e-3, dt=10e-6, probe_nodes=["B"])
    wave = out["waveforms"]["B"]
    assert wave[0] < wave[-1]         # monotonic-ish charging
    assert 4.7 < wave[-1] < 5.05      # settles near the rail


def test_floating_node_is_handled():
    """A totally disconnected board should not crash with a hard exception."""
    s = MNASolver()
    s.add_voltage_source("BAT", "A", "GND", 9.0)
    s.add_resistor("R1", "X", "Y", 1000)  # island, no path to ground
    try:
        s.solve()
    except CircuitError:
        pass  # acceptable: singular-matrix reported cleanly
