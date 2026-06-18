/*
 * QRNG Live — Seeed XIAO ESP32-C3
 * ---------------------------------
 * Streams raw 12-bit A0 ADC samples over USB serial, one decimal value per
 * line, for the Breadboard Simulator "Live Bench" (Web Serial).
 *
 * Select entropy source by uncommenting ONE of the defines below:
 *
 *   SOURCE_ZENER wiring:
 *     9V → R1(10kΩ) → Zener 5.1V cathode (ZNOISE) → R2(100kΩ) → A0 → R3(10kΩ) → GND
 *     Share GND with 9V supply negative.
 *
 *   SOURCE_BJT wiring:
 *     9V → R1(470kΩ) → 2N2222 base (QNOISE)   emitter → GND   collector → GND
 *     QNOISE → R2(100kΩ) → A0 → R3(10kΩ) → GND
 *     Share GND with 9V supply negative.  Must use 9V (5V won't reach B-E breakdown).
 *
 * Both sources feed A0, so loop() is identical for either source.
 *
 * Flash with Arduino IDE (board: "XIAO_ESP32C3"). Open the Live panel in the
 * app, click Connect, and pick this port. USB-CDC ignores the baud value, so
 * throughput is USB-speed regardless of the number below.
 */

// Select entropy source:
// #define SOURCE_ZENER   // R1(10k) → Zener cathode → R2(100k) → A0
#define SOURCE_BJT      // R1(470k) → 2N2222 base → R2(100k) → A0

const int PIN_A0 = A0;

void setup() {
  Serial.begin(460800);
  analogReadResolution(12);              // 0..4095
  analogSetAttenuation(ADC_11db);        // full ~0..3.3V input range

#ifdef SOURCE_BJT
  Serial.println(F("QRNG-LIVE source=BJT"));
#else
  Serial.println(F("QRNG-LIVE source=ZENER"));
#endif
}

void loop() {
  // Raw sample — the browser converts to volts and extracts entropy bits.
  Serial.println(analogRead(PIN_A0));
}
