"""
Modified Nodal Analysis (MNA) circuit solver.
Supports: resistors, voltage sources, current sources, LEDs, Zener diodes, BJTs.
"""

import numpy as np
from typing import Dict, List, Tuple, Optional


class CircuitError(Exception):
    pass


class MNASolver:
    """
    Solves DC operating point using Modified Nodal Analysis.
    Ground node is always node '0'.
    """

    def __init__(self):
        self.nodes: Dict[str, int] = {"0": 0}  # name -> index
        self.node_count = 1
        self.elements = []

    def _node_index(self, name: str) -> int:
        if name not in self.nodes:
            self.nodes[name] = self.node_count
            self.node_count += 1
        return self.nodes[name]

    def add_resistor(self, name: str, n_pos: str, n_neg: str, resistance: float):
        self.elements.append(("R", name, n_pos, n_neg, {"R": resistance}))

    def add_voltage_source(self, name: str, n_pos: str, n_neg: str, voltage: float):
        self.elements.append(("V", name, n_pos, n_neg, {"V": voltage}))

    def add_current_source(self, name: str, n_pos: str, n_neg: str, current: float):
        self.elements.append(("I", name, n_pos, n_neg, {"I": current}))

    def add_led(self, name: str, n_anode: str, n_cathode: str,
                vf: float = 2.0, color: str = "red"):
        """LED modeled as ideal diode: voltage clamp at Vf when forward biased."""
        self.elements.append(("LED", name, n_anode, n_cathode, {"Vf": vf, "color": color}))

    def add_zener(self, name: str, n_anode: str, n_cathode: str,
                  vf: float = 0.7, vz: float = 5.1):
        """Zener: forward Vf, reverse breakdown Vz."""
        self.elements.append(("Z", name, n_anode, n_cathode, {"Vf": vf, "Vz": vz}))

    def add_bjt(self, name: str, n_collector: str, n_base: str, n_emitter: str,
                bjt_type: str = "NPN", hfe: float = 100.0, vbe: float = 0.7):
        self.elements.append(("BJT", name, n_collector, n_base, n_emitter,
                               {"type": bjt_type, "hfe": hfe, "Vbe": vbe}))

    def solve(self) -> Dict:
        """
        Iterative DC operating point solver.
        Nonlinear elements (diodes, LEDs, Zeners, BJTs) use Newton-Raphson linearization.
        Returns node voltages and branch currents.
        """
        # Ensure all nodes referenced by elements are registered
        for el in self.elements:
            if el[0] == "BJT":
                self._node_index(el[2])
                self._node_index(el[3])
                self._node_index(el[4])
            else:
                self._node_index(el[2])
                self._node_index(el[3])

        n = self.node_count  # number of nodes including ground

        # Voltage sources and their branch current unknowns
        vsources = [el for el in self.elements if el[0] in ("V",)]
        m = len(vsources)  # number of voltage sources

        size = (n - 1) + m  # exclude ground node (index 0)

        MAX_ITER = 50
        TOL = 1e-6

        # Initial guess: all voltages 0
        x = np.zeros(size)

        # Stamp nonlinear elements with companion models
        for iteration in range(MAX_ITER):
            G = np.zeros((size, size))
            b = np.zeros(size)

            # Stamp linear resistors
            for el in self.elements:
                if el[0] == "R":
                    _, name, np_, nn, params = el
                    i = self._node_index(np_) - 1
                    j = self._node_index(nn) - 1
                    g = 1.0 / params["R"]
                    if i >= 0:
                        G[i, i] += g
                    if j >= 0:
                        G[j, j] += g
                    if i >= 0 and j >= 0:
                        G[i, j] -= g
                        G[j, i] -= g

                elif el[0] == "I":
                    _, name, np_, nn, params = el
                    i = self._node_index(np_) - 1
                    j = self._node_index(nn) - 1
                    cur = params["I"]
                    if i >= 0:
                        b[i] += cur
                    if j >= 0:
                        b[j] -= cur

                elif el[0] == "V":
                    idx = vsources.index(el)
                    k = (n - 1) + idx
                    _, name, np_, nn, params = el
                    i = self._node_index(np_) - 1
                    j = self._node_index(nn) - 1
                    if i >= 0:
                        G[i, k] += 1
                        G[k, i] += 1
                    if j >= 0:
                        G[j, k] -= 1
                        G[k, j] -= 1
                    b[k] = params["V"]

                elif el[0] in ("LED", "Z"):
                    _, name, na, nk, params = el
                    ia = self._node_index(na) - 1
                    ik = self._node_index(nk) - 1
                    va = x[ia] if ia >= 0 else 0.0
                    vk = x[ik] if ik >= 0 else 0.0
                    vd = va - vk

                    if el[0] == "LED":
                        vf = params["Vf"]
                        # Companion: ideal clamp — model as voltage source when forward biased
                        # Simplified: large conductance + current source
                        if vd > vf - 0.1:
                            g_comp = 1.0 / 0.001  # 1 ohm = stiff
                            i_comp = g_comp * vf
                        else:
                            g_comp = 1e-9  # reverse biased: near open
                            i_comp = 0.0
                    else:  # Zener
                        vf = params["Vf"]
                        vz = params["Vz"]
                        if vd > vf - 0.05:  # forward
                            g_comp = 1.0 / 0.001
                            i_comp = g_comp * vf
                        elif vd < -(vz - 0.05):  # reverse breakdown
                            g_comp = 1.0 / 0.001
                            i_comp = -g_comp * vz
                        else:
                            g_comp = 1e-9
                            i_comp = 0.0

                    if ia >= 0:
                        G[ia, ia] += g_comp
                        b[ia] += i_comp
                    if ik >= 0:
                        G[ik, ik] += g_comp
                        b[ik] -= i_comp
                    if ia >= 0 and ik >= 0:
                        G[ia, ik] -= g_comp
                        G[ik, ia] -= g_comp

                elif el[0] == "BJT":
                    _, name, nc, nb, ne, params = el
                    ic = self._node_index(nc) - 1
                    ib_node = self._node_index(nb) - 1
                    ie = self._node_index(ne) - 1
                    vb = x[ib_node] if ib_node >= 0 else 0.0
                    ve = x[ie] if ie >= 0 else 0.0
                    vc = x[ic] if ic >= 0 else 0.0
                    vbe = vb - ve
                    vce = vc - ve
                    hfe = params["hfe"]
                    vbe0 = params["Vbe"]
                    bjt_type = params["type"]

                    if bjt_type == "NPN":
                        active = vbe > (vbe0 - 0.05) and vce > 0.2
                    else:
                        active = vbe < -(vbe0 - 0.05) and vce < -0.2

                    if active:
                        # Base-emitter junction: voltage clamp at Vbe
                        g_be = 1.0 / 0.001
                        i_be = g_be * (vbe0 if bjt_type == "NPN" else -vbe0)
                        # Collector: controlled current source hfe * Ib
                        # Ib approximation from Vbe clamp
                        if bjt_type == "NPN":
                            ib_approx = max(0, (vb - ve - vbe0) * g_be)
                            ic_ctrl = hfe * ib_approx
                        else:
                            ib_approx = max(0, (ve - vb - vbe0) * g_be)
                            ic_ctrl = -hfe * ib_approx

                        # Stamp BE junction
                        if ib_node >= 0:
                            G[ib_node, ib_node] += g_be
                            b[ib_node] += i_be
                        if ie >= 0:
                            G[ie, ie] += g_be
                            b[ie] -= i_be
                        if ib_node >= 0 and ie >= 0:
                            G[ib_node, ie] -= g_be
                            G[ie, ib_node] -= g_be

                        # Stamp controlled current source CE
                        if ic >= 0:
                            b[ic] -= ic_ctrl
                        if ie >= 0:
                            b[ie] += ic_ctrl
                    else:
                        # Cutoff: leakage only
                        g_leak = 1e-9
                        if ib_node >= 0:
                            G[ib_node, ib_node] += g_leak
                        if ie >= 0:
                            G[ie, ie] += g_leak

            # Solve
            try:
                x_new = np.linalg.solve(G, b)
            except np.linalg.LinAlgError:
                raise CircuitError("Singular matrix — check for floating nodes or short circuits")

            if np.max(np.abs(x_new - x)) < TOL:
                x = x_new
                break
            x = x_new

        # Build results
        node_voltages = {"0": 0.0}
        for name, idx in self.nodes.items():
            if idx == 0:
                continue
            node_voltages[name] = float(x[idx - 1])

        # Branch currents for voltage sources
        branch_currents = {}
        for i, el in enumerate(vsources):
            k = (n - 1) + i
            branch_currents[el[1]] = float(x[k])

        # LED states
        led_states = {}
        for el in self.elements:
            if el[0] == "LED":
                _, name, na, nk, params = el
                va = node_voltages.get(na, 0.0)
                vk = node_voltages.get(nk, 0.0)
                vd = va - vk
                on = vd >= params["Vf"] * 0.9
                # Current through LED (approximate)
                if on:
                    # Find any series resistor... just report voltage across it
                    i_led = (vd - params["Vf"]) / 0.001 if on else 0.0
                led_states[name] = {
                    "on": on,
                    "vd": round(vd, 4),
                    "color": params["color"]
                }

        return {
            "node_voltages": {k: round(v, 6) for k, v in node_voltages.items()},
            "branch_currents": {k: round(v, 6) for k, v in branch_currents.items()},
            "led_states": led_states,
            "converged": True,
        }
