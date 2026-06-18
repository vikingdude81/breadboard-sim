# Live Bench firmware

Streams the XIAO's raw A0 ADC samples over USB so the app's **🔌 Live** panel
can overlay measured voltages on the simulation and run a live entropy lab on
the QRNG noise.

## Flash it
1. Arduino IDE → install the **esp32** boards package, select board **XIAO_ESP32C3**.
2. Open `qrng_live/qrng_live.ino`, plug in the XIAO, click Upload.

## Wire it (matches the in-app QRNG template)
```
9V ─ R1(10k) ─┬─ Zener 5.1V cathode      (ZNOISE)
              └─ R2(100k) ─┬─ XIAO A0
                           └─ R3(10k) ─ GND
Zener anode ─ GND
XIAO GND ─ shared with the 9V supply negative   ← important
Power the XIAO from USB.
```

## Use it
1. In the app, click **⚡ Load QRNG Circuit**, then **▶ Run Simulation**.
2. Open **🔌 Live**, click **Connect XIAO**, pick the serial port.
3. The panel shows measured A0 vs the simulated `LE8` (ADC0) node, plus live
   histogram, **min-entropy/bit**, bias, and von-Neumann throughput.

> Web Serial needs Chrome or Edge, served over `localhost` (the dev server) or https.

Min-entropy is the number that matters for an RNG. The raw analog stage rarely
hits 1.0 bit/sample — whiten the stream (von Neumann or XOR) on the XIAO to reach
full-entropy bits.
