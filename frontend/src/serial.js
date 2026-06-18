/**
 * Web Serial transport for the Live Bench.
 *
 * Reads newline-delimited decimal ADC samples streamed by the XIAO firmware
 * (firmware/qrng_live). Web Serial requires Chrome/Edge over localhost or
 * https, and requestPort() must be triggered from a user gesture.
 */

export function serialSupported() {
  return typeof navigator !== 'undefined' && 'serial' in navigator
}

export async function openSerial(baudRate = 460800) {
  if (!serialSupported()) {
    throw new Error('Web Serial not supported — use Chrome or Edge over localhost.')
  }
  const port = await navigator.serial.requestPort()
  await port.open({ baudRate })
  return port
}

/**
 * Start reading lines from an open port.
 * @param port        open SerialPort
 * @param onLine      called with each trimmed text line
 * @param onError     called if the read loop throws
 * @returns stop()    async fn that cancels the reader and closes the port
 */
export function startReader(port, onLine, onError) {
  let stopped = false
  const decoder = new TextDecoderStream()
  const piped = port.readable.pipeTo(decoder.writable).catch(() => {})
  const reader = decoder.readable.getReader()

  ;(async () => {
    let buf = ''
    try {
      while (!stopped) {
        const { value, done } = await reader.read()
        if (done) break
        buf += value
        let i
        while ((i = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, i).trim()
          buf = buf.slice(i + 1)
          if (line) onLine(line)
        }
      }
    } catch (e) {
      if (!stopped) onError?.(e)
    }
  })()

  return async () => {
    stopped = true
    try { await reader.cancel() } catch { /* already closing */ }
    try { reader.releaseLock() } catch { /* noop */ }
    try { await piped } catch { /* noop */ }
    try { await port.close() } catch { /* noop */ }
  }
}

// ── Entropy / statistics over a window of raw ADC samples ─────────────────────

/**
 * Compute QRNG-relevant metrics from raw samples, using the chosen number of
 * least-significant bits as the raw entropy source.
 */
export function entropyMetrics(samples, lsbBits = 1) {
  const n = samples.length
  if (n === 0) return null
  const mask = (1 << lsbBits) - 1
  const levels = 1 << lsbBits
  const counts = new Array(levels).fill(0)
  for (let i = 0; i < n; i++) counts[samples[i] & mask]++

  // Shannon + min-entropy of the lsb symbol (bits per sample, normalized /lsbBits → per bit)
  let shannon = 0, pmax = 0
  for (const c of counts) {
    if (!c) continue
    const p = c / n
    shannon -= p * Math.log2(p)
    if (p > pmax) pmax = p
  }
  const minH = -Math.log2(pmax || 1e-12)

  // Bit-0 bias and von Neumann throughput (pairs: 01→0, 10→1, drop 00/11)
  let ones = 0, vnOut = 0, pairs = 0
  for (let i = 0; i < n; i++) ones += samples[i] & 1
  for (let i = 0; i + 1 < n; i += 2) {
    const a = samples[i] & 1, b = samples[i + 1] & 1
    pairs++
    if (a !== b) vnOut++
  }
  const p1 = ones / n

  return {
    n,
    shannonPerBit: shannon / lsbBits,
    minEntropyPerBit: minH / lsbBits,
    bias: Math.abs(p1 - 0.5),
    p1,
    vnBitsPerSample: vnOut / n,   // whitened output bits per input sample
    lsbBits,
  }
}
