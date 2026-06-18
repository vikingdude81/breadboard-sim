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


def test_floating_node_is_handled():
    """A totally disconnected board should not crash with a hard exception."""
    s = MNASolver()
    s.add_voltage_source("BAT", "A", "GND", 9.0)
    s.add_resistor("R1", "X", "Y", 1000)  # island, no path to ground
    try:
        s.solve()
    except CircuitError:
        pass  # acceptable: singular-matrix reported cleanly
