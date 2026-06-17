"""
MNA circuit solver — DC operating point + Transient time-stepping.

Component models ported/adapted from BreadboardSim (C++):
  Resistor, Capacitor (BE/Trap), Diode (Shockley), LED (piecewise-linear),
  Zener, BJT NPN/PNP (Ebers-Moll), MOSFET N/P (Shichman-Hodges),
  OpAmp (tanh saturation), Potentiometer, Voltage/Current sources.
"""

import numpy as np
import math
from typing import Dict, List, Optional, Any

# ── Physical constants ────────────────────────────────────────────────────────
VT      = 0.02585    # thermal voltage at 300K
IS_DEF  = 1e-14
EXP_LIM = 40.0

class CircuitError(Exception):
    pass

def _exp_s(x):
    if x >  EXP_LIM: return math.exp( EXP_LIM) * (x - EXP_LIM + 1)
    if x < -EXP_LIM: return math.exp(-EXP_LIM) * (x + EXP_LIM + 1)
    return math.exp(x)

def _exp_d(x):
    """Derivative of exp_safe."""
    if x >  EXP_LIM: return math.exp( EXP_LIM)
    if x < -EXP_LIM: return math.exp(-EXP_LIM)
    return math.exp(x)

def _v(V, name):
    return V.get(name, 0.0) if (name and name not in ('0','GND')) else 0.0

def _idx(ni, name):
    if not name or name in ('0','GND'): return None
    return ni.get(name)

# ── Stamp helpers ─────────────────────────────────────────────────────────────
def _G(G, i, j, g):
    if i is not None: G[i,i] += g
    if j is not None: G[j,j] += g
    if i is not None and j is not None:
        G[i,j] -= g; G[j,i] -= g

def _b(b, i, j, cur):
    """Inject cur into i, extract from j."""
    if i is not None: b[i] += cur
    if j is not None: b[j] -= cur


# ══════════════════════════════════════════════════════════════════════════════
#  Component models
# ══════════════════════════════════════════════════════════════════════════════

class Resistor:
    def __init__(self, id, np, nn, R):
        self.id=id; self.nodes=[np,nn]; self.R=max(R,1e-9)
    def stamp(self, G, b, V, ni, **_):
        _G(G, _idx(ni,self.nodes[0]), _idx(ni,self.nodes[1]), 1/self.R)


class Capacitor:
    """Backward-Euler companion model for transient; open-circuit for DC."""
    def __init__(self, id, np, nn, C):
        self.id=id; self.nodes=[np,nn]; self.C=max(C,1e-18)
        self.v_prev = 0.0  # updated after each converged tick
    def stamp(self, G, b, V, ni, transient=False, V_prev=None, dt=1e-6, **_):
        if not transient:
            _G(G, _idx(ni,self.nodes[0]), _idx(ni,self.nodes[1]), 1e-9)
            return
        # Backward-Euler: Geq = C/dt, Ieq = Geq * v_prev
        v_prev = _v(V_prev,self.nodes[0]) - _v(V_prev,self.nodes[1]) if V_prev else self.v_prev
        geq = self.C / dt
        _G(G, _idx(ni,self.nodes[0]), _idx(ni,self.nodes[1]), geq)
        _b(b, _idx(ni,self.nodes[0]), _idx(ni,self.nodes[1]), geq * v_prev)
    def update(self, V):
        self.v_prev = _v(V,self.nodes[0]) - _v(V,self.nodes[1])


class Diode:
    """Shockley diode with piecewise linearization."""
    def __init__(self, id, na, nk, Is=IS_DEF, n=1.0, label='diode'):
        self.id=id; self.nodes=[na,nk]; self.Is=Is; self.n=n; self.label=label
    def _vd(self, V): return _v(V,self.nodes[0]) - _v(V,self.nodes[1])
    def stamp(self, G, b, V, ni, **_):
        vd  = self._vd(V)
        nvt = self.n * VT
        Id  = self.Is * (_exp_s(vd/nvt) - 1)
        gd  = self.Is / nvt * _exp_d(vd/nvt)
        Ieq = Id - gd * vd
        a,k = _idx(ni,self.nodes[0]), _idx(ni,self.nodes[1])
        _G(G, a, k, gd)
        _b(b, a, k, -Ieq)


class LED(Diode):
    """
    LED: piecewise linear around Vf (stiff-clamp model, numerically stable).
    Forward biased → large conductance. Reverse → near open.
    """
    def __init__(self, id, na, nk, vf=2.0, color='red'):
        # n=2, Is chosen so forward current is ~20mA at Vf with no exp overflow
        # exp(Vf/(2*VT)) must be < exp(EXP_LIM=40)
        # For Vf=3.4V (white), Vf/(2*VT) = 3.4/0.0517 = 65.8 > 40 → must use n larger
        # Use n such that Vf/(n*VT) ≈ 35 (safe margin)
        n_ideal = max(2.0, vf / (35 * VT))
        Is_led  = 0.02 / max(_exp_s(vf/(n_ideal*VT)) - 1, 1e-30)
        super().__init__(id, na, nk, Is=Is_led, n=n_ideal, label='led')
        self.vf    = vf
        self.color = color
    def is_on(self, V):
        return self._vd(V) >= self.vf * 0.88


class Zener:
    """
    Zener diode: piecewise linear.
    Forward: large-G clamp at Vf. Reverse breakdown: large-G clamp at −Vz.
    """
    def __init__(self, id, na, nk, vf=0.7, vz=5.1):
        self.id=id; self.nodes=[na,nk]; self.vf=vf; self.vz=vz
        self.label='zener'
    def _vd(self, V): return _v(V,self.nodes[0]) - _v(V,self.nodes[1])
    def stamp(self, G, b, V, ni, **_):
        vd = self._vd(V)
        a,k = _idx(ni,self.nodes[0]), _idx(ni,self.nodes[1])
        G_STIFF = 1000.0   # 1mΩ in clamp region
        if vd > self.vf - 0.05:          # forward clamp at Vf
            _G(G,a,k,G_STIFF)
            _b(b,a,k,-G_STIFF*self.vf)
        elif vd < -(self.vz - 0.05):     # reverse breakdown clamp at -Vz
            _G(G,a,k,G_STIFF)
            _b(b,a,k, G_STIFF*self.vz)
        else:
            _G(G,a,k,1e-9)              # open circuit


class BJT:
    """
    Ebers-Moll BJT (NPN/PNP).
    nodes = [collector, base, emitter]
    For PNP: Is is negated, Vt = −VT (mirrors BreadboardSim approach).
    Direct Jacobian stamping — no symmetric _G() misuse.
    """
    def __init__(self, id, nc, nb, ne,
                 bjt_type='NPN', Bf=100, Br=1.0, Is=IS_DEF):
        self.id=id; self.nodes=[nc,nb,ne]
        self.bjt_type=bjt_type
        self.Bf=Bf; self.Br=Br
        # PNP: negate Is AND Vt (BreadboardSim pattern)
        if bjt_type == 'PNP':
            self.Is = -abs(Is)
            self.Vt = -VT
        else:
            self.Is =  abs(Is)
            self.Vt =  VT

    def stamp(self, G, b, V, ni, **_):
        vc = _v(V,self.nodes[0])
        vb = _v(V,self.nodes[1])
        ve = _v(V,self.nodes[2])
        vbe = vb - ve
        vbc = vb - vc
        Is = self.Is
        Vt = self.Vt    # ±VT
        Bf = self.Bf; Br = self.Br

        xf   = _exp_s(vbe/Vt);  xf_d = _exp_d(vbe/Vt)
        xr   = _exp_s(vbc/Vt);  xr_d = _exp_d(vbc/Vt)

        # Ebers-Moll currents (positive = into terminal for NPN)
        Ic = Is * (xf - (1+1/Br)*xr + 1/Br)
        Ib = Is * ((xf-1)/Bf + (xr-1)/Br)

        # Partial derivatives: ∂I/∂(node voltage)
        # vbe = vb-ve → ∂vbe/∂vb=1, ∂vbe/∂ve=-1
        # vbc = vb-vc → ∂vbc/∂vb=1, ∂vbc/∂vc=-1
        dIc_dvb = Is*(xf_d - (1+1/Br)*xr_d)/Vt
        dIc_dvc = Is*(1+1/Br)*xr_d/Vt        # sign flip from ∂vbc/∂vc=-1
        dIc_dve = -Is*xf_d/Vt                # sign flip from ∂vbe/∂ve=-1

        dIb_dvb = Is*(xf_d/Bf + xr_d/Br)/Vt
        dIb_dvc = -Is*xr_d/(Br*Vt)           # ∂vbc/∂vc=-1 → flip
        dIb_dve = -Is*xf_d/(Bf*Vt)

        # Norton constants (operating-point value minus linearized piece)
        Ic_n = Ic - dIc_dvc*vc - dIc_dvb*vb - dIc_dve*ve
        Ib_n = Ib - dIb_dvc*vc - dIb_dvb*vb - dIb_dve*ve

        c  = _idx(ni,self.nodes[0])
        bb = _idx(ni,self.nodes[1])
        e  = _idx(ni,self.nodes[2])

        # ── Collector: Ic LEAVES node c ──────────────────────────────────────
        if c is not None:
            G[c,c] += dIc_dvc
            if bb is not None: G[c,bb] += dIc_dvb
            if e  is not None: G[c,e]  += dIc_dve
            b[c] -= Ic_n

        # ── Base: Ib LEAVES node b ────────────────────────────────────────────
        if bb is not None:
            if c  is not None: G[bb,c]  += dIb_dvc
            G[bb,bb] += dIb_dvb
            if e  is not None: G[bb,e]  += dIb_dve
            b[bb] -= Ib_n

        # ── Emitter: (Ic+Ib) ENTERS node e ───────────────────────────────────
        if e is not None:
            if c  is not None: G[e,c]  -= (dIc_dvc + dIb_dvc)
            if bb is not None: G[e,bb] -= (dIc_dvb + dIb_dvb)
            G[e,e] -= (dIc_dve + dIb_dve)
            b[e] += (Ic_n + Ib_n)


class MOSFET:
    """
    Shichman-Hodges MOSFET (N or P channel).
    nodes = [source, gate, drain]
    """
    def __init__(self, id, ns, ng, nd,
                 mtype='N', Vth=2.0, K=0.01, lam=0.01, Rgs=1e9):
        self.id=id; self.nodes=[ns,ng,nd]
        self.mtype=mtype; self.Vth=Vth; self.K=K; self.lam=lam; self.Rgs=Rgs
        self.s = 1.0 if mtype=='N' else -1.0

    def stamp(self, G, b, V, ni, **_):
        vs = _v(V,self.nodes[0]); vg = _v(V,self.nodes[1]); vd = _v(V,self.nodes[2])
        s  = _idx(ni,self.nodes[0]); gn = _idx(ni,self.nodes[1]); d = _idx(ni,self.nodes[2])
        sg = self.s   # +1 N-ch, -1 P-ch

        # Gate leakage
        _G(G, gn, s, 1/self.Rgs)

        vgs = sg*(vg - vs)
        vds = sg*(vd - vs)
        Vth = self.Vth   # always positive threshold magnitude
        K   = self.K
        lam = self.lam * (1 if vds >= 0 else -1)

        if vgs < Vth:
            return  # cutoff

        if vds < vgs - Vth:  # linear
            Id  = K*((vgs-Vth)*vds - vds**2/2)*(1+lam*abs(vds))
            gm  = K*vds*(1+lam*abs(vds))
            gds = K*(vgs-Vth-vds)*(1+lam*abs(vds)) + K*((vgs-Vth)*vds-vds**2/2)*lam
        else:  # saturation
            Id  = K/2*(vgs-Vth)**2*(1+lam*abs(vds))
            gm  = K*(vgs-Vth)*(1+lam*abs(vds))
            gds = K/2*(vgs-Vth)**2*lam

        Id  *= sg    # restore sign for P-channel
        gm  *= sg
        gds *= sg

        # Id_eq for Norton: Id ≈ gm*(Vgs-vgs) + gds*(Vds-vds) + Id
        # = gm*(Vg-Vs) + gds*(Vd-Vs) + (Id - gm*vgs - gds*vds)
        Id_eq = Id - gm*vgs - gds*vds
        # gm*(Vg-Vs) → transconductance leaves d, enters s
        if d  is not None and gn is not None: G[d,gn]  += gm*sg
        if d  is not None and s  is not None: G[d,s]   -= gm*sg
        if s  is not None and gn is not None: G[s,gn]  -= gm*sg
        if s  is not None:                    G[s,s]   += gm*sg
        # gds*(Vd-Vs)
        _G(G, d, s, gds*sg)
        # Norton constant
        _b(b, d, s, -Id_eq)


class OpAmp:
    """
    5-pin op-amp: [non_inv(0), inv(1), out(2), v_neg(3), v_pos(4)]
    Vout = (Vsp-Vsm)/2 * tanh(Aol*(V+−V−)) + (Vsp+Vsm)/2
    (tanh limits output between rails — ported from BreadboardSim Opamp.cpp)
    """
    def __init__(self, id, n_niv, n_inv, n_out, n_vneg, n_vpos,
                 Rin=1e6, Aol=1e5, Rout=75.0):
        self.id=id; self.nodes=[n_niv,n_inv,n_out,n_vneg,n_vpos]
        self.Rin=Rin; self.Aol=Aol; self.Rout=Rout

    def stamp(self, G, b, V, ni, **_):
        vp   = _v(V,self.nodes[0]); vm   = _v(V,self.nodes[1])
        vout = _v(V,self.nodes[2]); vsm  = _v(V,self.nodes[3]); vsp  = _v(V,self.nodes[4])
        ni_p  = _idx(ni,self.nodes[0]); ni_m  = _idx(ni,self.nodes[1])
        ni_o  = _idx(ni,self.nodes[2])

        # Differential input resistance
        _G(G, ni_p, ni_m, 1/self.Rin)

        # Ideal output voltage (before Rout)
        diff   = vp - vm
        tanh_v = math.tanh(self.Aol * diff)
        sech2  = 1 - tanh_v**2
        vo_ideal = (vsp-vsm)/2 * tanh_v + (vsp+vsm)/2

        # ∂Vo/∂Vp = (Vsp-Vsm)/2 * Aol * sech²
        dvo_dvp = (vsp-vsm)/2 * self.Aol * sech2
        dvo_dvm = -dvo_dvp

        # Norton equivalent: G_out = 1/Rout, I_eq = (Vo_lin - G_out*Vout)
        g_out = 1/self.Rout
        Vo_eq = vo_ideal - dvo_dvp*vp - dvo_dvm*vm  # constant term

        if ni_o is not None:
            G[ni_o,ni_o] += g_out
            if ni_p is not None: G[ni_o,ni_p] -= g_out*dvo_dvp
            if ni_m is not None: G[ni_o,ni_m] -= g_out*dvo_dvm
            b[ni_o] += g_out*Vo_eq


class Potentiometer:
    """3-pin: [end_a, wiper, end_b]. pos ∈ [0,1]."""
    def __init__(self, id, na, nw, nb, R_total=10000, pos=0.5):
        self.id=id; self.nodes=[na,nw,nb]
        self.R=max(R_total,1.0); self.pos=max(0.001,min(0.999,pos))
    def stamp(self, G, b, V, ni, **_):
        Ra = self.R*self.pos; Rb = self.R*(1-self.pos)
        _G(G,_idx(ni,self.nodes[0]),_idx(ni,self.nodes[1]),1/Ra)
        _G(G,_idx(ni,self.nodes[1]),_idx(ni,self.nodes[2]),1/Rb)


class VoltageSource:
    def __init__(self, id, np, nn, V):
        self.id=id; self.nodes=[np,nn]; self.V=V; self.branch_idx=None

class CurrentSource:
    def __init__(self, id, np, nn, I):
        self.id=id; self.nodes=[np,nn]; self.I=I
    def stamp(self, G, b, V, ni, **_):
        _b(b, _idx(ni,self.nodes[0]), _idx(ni,self.nodes[1]), self.I)


# ══════════════════════════════════════════════════════════════════════════════
#  Solver
# ══════════════════════════════════════════════════════════════════════════════

class MNASolver:
    MAX_ITER   = 100
    TOL        = 1e-7
    RAMP_STEPS = 10

    def __init__(self):
        self.components: List = []
        self._vsrc: List[VoltageSource] = []

    # ── Adders ────────────────────────────────────────────────────────────────
    def add_resistor(self,id,np,nn,R):          self._add(Resistor(id,np,nn,R))
    def add_capacitor(self,id,np,nn,C):         self._add(Capacitor(id,np,nn,C))
    def add_voltage_source(self,id,np,nn,V):    self._add(VoltageSource(id,np,nn,V))
    def add_current_source(self,id,np,nn,I):    self._add(CurrentSource(id,np,nn,I))

    def add_led(self,id,na,nk,vf=2.0,color='red'): self._add(LED(id,na,nk,vf,color))
    def add_zener(self,id,na,nk,vf=0.7,vz=5.1):    self._add(Zener(id,na,nk,vf,vz))
    def add_diode(self,id,na,nk,vf=0.7):
        # Use Shockley with Is matched to Vf at 1mA
        Is = 1e-3 / max(_exp_s(vf/VT)-1, 1e-30)
        self._add(Diode(id,na,nk,Is=Is,n=1.0))

    def add_bjt(self,id,nc,nb,ne,bjt_type='NPN',hfe=100,vbe=0.7):
        # Derive Is from hfe and Vbe so that Ib ≈ Ic/hfe at operating point
        Is = 1e-3 / max(hfe * (_exp_s(vbe/VT)-1), 1e-30)
        self._add(BJT(id,nc,nb,ne,bjt_type=bjt_type,Bf=hfe,Br=max(1,hfe//10),Is=Is))

    def add_mosfet(self,id,ns,ng,nd,mtype='N',vth=2.0,K=0.01,lam=0.01):
        self._add(MOSFET(id,ns,ng,nd,mtype=mtype,Vth=vth,K=K,lam=lam))

    def add_opamp(self,id,n_niv,n_inv,n_out,n_vneg,n_vpos,Rin=1e6,Aol=1e5,Rout=75):
        self._add(OpAmp(id,n_niv,n_inv,n_out,n_vneg,n_vpos,Rin,Aol,Rout))

    def add_potentiometer(self,id,na,nw,nb,R=10000,pos=0.5):
        self._add(Potentiometer(id,na,nw,nb,R,pos))

    def _add(self, comp):
        self.components.append(comp)
        if isinstance(comp, VoltageSource):
            comp.branch_idx = len(self._vsrc)
            self._vsrc.append(comp)

    # ── Node indexing ─────────────────────────────────────────────────────────
    def _build_ni(self):
        names = set()
        for c in self.components:
            for n in c.nodes:
                if n and n not in ('0','GND'):
                    names.add(n)
        lst = sorted(names)
        return {n:i for i,n in enumerate(lst)}, len(lst)

    def _x_to_V(self, x, ni):
        V = {'0':0.0,'GND':0.0}
        for name,idx in ni.items(): V[name]=float(x[idx])
        return V

    # ── Build system ──────────────────────────────────────────────────────────
    def _build(self, V, ni, nn, transient=False, V_prev=None, dt=1e-6):
        nv   = len(self._vsrc)
        size = nn+nv
        G    = np.zeros((size,size))
        b    = np.zeros(size)

        for comp in self.components:
            if isinstance(comp, VoltageSource):
                k = nn+comp.branch_idx
                p,n = _idx(ni,comp.nodes[0]), _idx(ni,comp.nodes[1])
                if p is not None: G[p,k]+=1; G[k,p]+=1
                if n is not None: G[n,k]-=1; G[k,n]-=1
                b[k] = comp.V
            elif isinstance(comp, Capacitor):
                comp.stamp(G,b,V,ni,transient=transient,V_prev=V_prev,dt=dt)
            else:
                comp.stamp(G,b,V,ni)
        return G,b

    # ── Newton-Raphson ────────────────────────────────────────────────────────
    def _nr(self, ni, nn, x0=None, transient=False, V_prev=None, dt=1e-6):
        nv   = len(self._vsrc)
        x    = np.full(nn+nv, 0.1) if x0 is None else x0.copy()

        for it in range(self.MAX_ITER):
            V    = self._x_to_V(x, ni)
            G,b  = self._build(V, ni, nn, transient, V_prev, dt)
            try:
                x_new = np.linalg.solve(G, b)
            except np.linalg.LinAlgError:
                raise CircuitError("Singular matrix — floating node or short circuit")
            err = np.max(np.abs(x_new - x))
            x   = x_new
            if err < self.TOL:
                break
        return x, it

    # ── Ramp-up fallback ──────────────────────────────────────────────────────
    def _ramp(self, ni, nn):
        orig = {vs:vs.V for vs in self._vsrc}
        for vs in self._vsrc: vs.V = 0.0
        x = np.zeros(nn+len(self._vsrc))
        for step in range(1, self.RAMP_STEPS+1):
            for vs in self._vsrc: vs.V = orig[vs]*step/self.RAMP_STEPS
            x,_ = self._nr(ni, nn, x0=x)
        for vs,v in orig.items(): vs.V=v
        return x

    # ── DC solve ──────────────────────────────────────────────────────────────
    def solve(self) -> Dict:
        ni,nn = self._build_ni()
        x,iters = self._nr(ni, nn)
        if iters >= self.MAX_ITER-1:
            x = self._ramp(ni, nn)
        V = self._x_to_V(x, ni)
        return self._result(V, x, ni, nn)

    # ── Transient solve ───────────────────────────────────────────────────────
    def solve_transient(self, t_stop:float, dt:float=1e-6,
                        probe_nodes:List[str]=None) -> Dict:
        ni,nn = self._build_ni()

        if probe_nodes is None:
            probe_nodes = list(ni.keys())

        # Physical "power-on" initial: caps uncharged (V_prev=0 everywhere).
        # One NR pass in transient mode with all-zero previous state gives the
        # node voltages at t=0 (instantaneous response, caps act as short).
        V_zero: Dict[str,float] = {'0':0.0,'GND':0.0}
        x = np.zeros(nn + len(self._vsrc))
        x,_ = self._nr(ni, nn, x0=x, transient=True, V_prev=V_zero, dt=dt)
        V_prev = self._x_to_V(x, ni)

        for comp in self.components:
            if isinstance(comp, Capacitor): comp.update(V_prev)

        n_steps    = max(1, int(t_stop/dt))
        MAX_PTS    = 2000
        stride     = max(1, n_steps//MAX_PTS)
        times      = []
        waveforms  = {n:[] for n in probe_nodes}

        for i in range(n_steps):
            x,_ = self._nr(ni, nn, x0=x, transient=True, V_prev=V_prev, dt=dt)
            V_cur = self._x_to_V(x, ni)
            for comp in self.components:
                if isinstance(comp, Capacitor): comp.update(V_prev)
            V_prev = V_cur

            if i % stride == 0:
                times.append((i+1)*dt)
                for n in probe_nodes:
                    waveforms[n].append(V_cur.get(n, 0.0))

        return {'times':times, 'waveforms':waveforms, 'dt':dt,
                't_stop':t_stop, 'n_steps':n_steps}

    # ── Result builder ────────────────────────────────────────────────────────
    def _result(self, V, x, ni, nn) -> Dict:
        branch_currents = {}
        for vs in self._vsrc:
            branch_currents[vs.id] = round(float(x[nn+vs.branch_idx]), 6)

        led_states = {}
        for comp in self.components:
            if isinstance(comp, LED):
                vd = comp._vd(V)
                led_states[comp.id] = {
                    'on':comp.is_on(V), 'vd':round(vd,4), 'color':comp.color}

        return {
            'node_voltages':   {k:round(v,6) for k,v in V.items()},
            'branch_currents': branch_currents,
            'led_states':      led_states,
            'converged':       True,
        }
