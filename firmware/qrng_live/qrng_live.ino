/*
 * QRNG Live — Seeed XIAO ESP32-C3
 * ---------------------------------
 * Streams raw 12-bit A0 ADC samples over USB serial, one decimal value per
 * line, for the Breadboard Simulator "Live Bench" (Web Serial).
 *
 * Wiring (matches the in-app QRNG template):
 *   ZNOISE (Zener cathode) --100k--> A0 ; A0 --10k--> GND
 *   Power the XIAO from USB; share GND with the 9V bias supply's negative.
 *
 * Flash with Arduino IDE (board: "XIAO_ESP32C3"). Open the Live panel in the
 * app, click Connect, and pick this port. USB-CDC ignores the baud value, so
 * throughput is USB-speed regardless of the number below.
 */

const int PIN_A0 = A0;

void setup() {
  Serial.begin(460800);
  analogReadResolution(12);              // 0..4095
  analogSetAttenuation(ADC_11db);        // full ~0..3.3V input range
}

void loop() {
  // Raw sample — the browser converts to volts and extracts entropy bits.
  Serial.println(analogRead(PIN_A0));
}
