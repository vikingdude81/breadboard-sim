"""
Component library — specs for all supported parts.
"""

COMPONENTS = {
    # --- Resistors ---
    "R_100": {"type": "resistor", "label": "100Ω", "resistance": 100},
    "R_220": {"type": "resistor", "label": "220Ω", "resistance": 220},
    "R_330": {"type": "resistor", "label": "330Ω", "resistance": 330},
    "R_470": {"type": "resistor", "label": "470Ω", "resistance": 470},
    "R_1K":  {"type": "resistor", "label": "1kΩ",  "resistance": 1000},
    "R_4K7": {"type": "resistor", "label": "4.7kΩ","resistance": 4700},
    "R_10K": {"type": "resistor", "label": "10kΩ", "resistance": 10000},
    "R_100K":{"type": "resistor", "label": "100kΩ","resistance": 100000},

    # --- Capacitors (not yet simulated in DC, listed for layout) ---
    "C_100N": {"type": "capacitor", "label": "100nF", "capacitance": 100e-9},
    "C_10U":  {"type": "capacitor", "label": "10µF",  "capacitance": 10e-6},

    # --- LEDs ---
    "LED_RED":   {"type": "led", "label": "LED Red",   "vf": 2.0,  "color": "red"},
    "LED_GREEN": {"type": "led", "label": "LED Green", "vf": 2.2,  "color": "green"},
    "LED_BLUE":  {"type": "led", "label": "LED Blue",  "vf": 3.2,  "color": "blue"},
    "LED_YELLOW":{"type": "led", "label": "LED Yellow","vf": 2.1,  "color": "yellow"},
    "LED_WHITE": {"type": "led", "label": "LED White", "vf": 3.4,  "color": "white"},
    "LED_IR":    {"type": "led", "label": "LED IR",    "vf": 1.2,  "color": "infrared"},

    # --- Zener Diodes ---
    "Z_3V3":  {"type": "zener", "label": "Zener 3.3V", "vf": 0.7, "vz": 3.3},
    "Z_5V1":  {"type": "zener", "label": "Zener 5.1V", "vf": 0.7, "vz": 5.1},
    "Z_5V6":  {"type": "zener", "label": "Zener 5.6V", "vf": 0.7, "vz": 5.6},
    "Z_6V2":  {"type": "zener", "label": "Zener 6.2V", "vf": 0.7, "vz": 6.2},
    "Z_9V1":  {"type": "zener", "label": "Zener 9.1V", "vf": 0.7, "vz": 9.1},
    "Z_12V":  {"type": "zener", "label": "Zener 12V",  "vf": 0.7, "vz": 12.0},
    # QRNG: BZX79-C5V1 is a common avalanche noise Zener
    "Z_QRNG_5V1": {"type": "zener", "label": "Zener QRNG 5.1V (BZX79-C5V1)",
                   "vf": 0.7, "vz": 5.1, "noise_model": "avalanche"},

    # --- Regular Diodes ---
    "D_1N4148": {"type": "diode", "label": "1N4148",  "vf": 0.7},
    "D_1N4007": {"type": "diode", "label": "1N4007",  "vf": 0.7},

    # --- BJT Transistors (NPN) ---
    "Q_2N2222":  {"type": "bjt", "label": "2N2222 NPN",  "bjt_type": "NPN", "hfe": 100, "vbe": 0.7, "vceo": 40,  "ic_max": 0.6,
                  "noise_model": "bjt_avalanche", "vbe_avalanche": 7.5},
    # QRNG: 2N2222 B-E junction reverse-biased into avalanche at ~7.5V
    "Q_2N2222_QRNG": {"type": "bjt", "label": "2N2222 NPN (QRNG — B-E avalanche)",
                      "bjt_type": "NPN", "hfe": 100, "vbe": 0.7, "vceo": 40, "ic_max": 0.6,
                      "noise_model": "bjt_avalanche", "vbe_avalanche": 7.5, "noise_rms_uv": 800},
    "Q_2N3904":  {"type": "bjt", "label": "2N3904 NPN",  "bjt_type": "NPN", "hfe": 100, "vbe": 0.7, "vceo": 40,  "ic_max": 0.2},
    "Q_BC547":   {"type": "bjt", "label": "BC547 NPN",   "bjt_type": "NPN", "hfe": 110, "vbe": 0.7, "vceo": 45,  "ic_max": 0.1},
    "Q_TIP31C":  {"type": "bjt", "label": "TIP31C NPN",  "bjt_type": "NPN", "hfe": 25,  "vbe": 0.7, "vceo": 100, "ic_max": 3.0},

    # --- BJT Transistors (PNP) ---
    "Q_2N2907":  {"type": "bjt", "label": "2N2907 PNP",  "bjt_type": "PNP", "hfe": 100, "vbe": 0.7, "vceo": 40,  "ic_max": 0.6},
    "Q_2N3906":  {"type": "bjt", "label": "2N3906 PNP",  "bjt_type": "PNP", "hfe": 100, "vbe": 0.7, "vceo": 40,  "ic_max": 0.2},
    "Q_BC557":   {"type": "bjt", "label": "BC557 PNP",   "bjt_type": "PNP", "hfe": 110, "vbe": 0.7, "vceo": 45,  "ic_max": 0.1},

    # --- MOSFETs ---
    # Param keys match the solver/API: mtype (N|P), vth (magnitude), K, lam.
    "Q_2N7000":  {"type": "mosfet", "label": "2N7000 N-CH", "mtype": "N", "vth": 2.0, "K": 0.01,  "lam": 0.01},
    "Q_IRF540":  {"type": "mosfet", "label": "IRF540 N-CH",  "mtype": "N", "vth": 4.0, "K": 0.25,  "lam": 0.005},
    "Q_BS250":   {"type": "mosfet", "label": "BS250 P-CH",   "mtype": "P", "vth": 2.0, "K": 0.02,  "lam": 0.01},

    # --- ICs / Microcontrollers ---
    "IC_555":    {"type": "ic", "label": "NE555 Timer", "pins": 8, "description": "Astable/monostable timer"},
    "IC_LM741":  {"type": "ic", "label": "LM741 Op-Amp", "pins": 8, "description": "General purpose op-amp"},
    "IC_LM358":  {"type": "ic", "label": "LM358 Op-Amp", "pins": 8, "description": "Dual op-amp"},
    "IC_74HC14": {"type": "ic", "label": "74HC14 Schmitt", "pins": 14, "description": "Hex Schmitt-trigger inverter"},

    # --- Seeed XIAO Family ---
    "MCU_XIAO_SAMD21":  {"type": "mcu", "label": "Seeed XIAO SAMD21",
                          "pins": 14, "vcc": 3.3, "adc_bits": 12, "adc_channels": 11,
                          "description": "ARM Cortex-M0+, 256KB Flash"},
    "MCU_XIAO_ESP32C3": {"type": "mcu", "label": "Seeed XIAO ESP32-C3",
                          "pins": 14, "vcc": 3.3, "adc_bits": 12, "adc_channels": 6,
                          "description": "RISC-V ESP32-C3, WiFi+BT, ADC noise suitable for QRNG"},
    "MCU_XIAO_ESP32S3": {"type": "mcu", "label": "Seeed XIAO ESP32-S3",
                          "pins": 14, "vcc": 3.3, "adc_bits": 12, "adc_channels": 9,
                          "description": "Xtensa LX7, WiFi+BT, camera-capable, QRNG ready"},
    "MCU_XIAO_RP2040":  {"type": "mcu", "label": "Seeed XIAO RP2040",
                          "pins": 14, "vcc": 3.3, "adc_bits": 12, "adc_channels": 4,
                          "description": "Dual-core ARM Cortex-M0+"},

    # --- Power ---
    "BAT_9V":    {"type": "battery", "label": "9V Battery", "voltage": 9.0},
    "BAT_5V":    {"type": "battery", "label": "5V USB",     "voltage": 5.0},
    "BAT_3V3":   {"type": "battery", "label": "3.3V Reg",   "voltage": 3.3},
}


def get_component(cid: str):
    return COMPONENTS.get(cid)


def list_components(type_filter: str = None):
    if type_filter:
        return {k: v for k, v in COMPONENTS.items() if v["type"] == type_filter}
    return COMPONENTS
