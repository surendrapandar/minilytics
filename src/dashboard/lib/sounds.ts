// Tiny notification sounds made with the Web Audio API, so there are no audio files to host.

let ctx: AudioContext | null = null;

function tone(freq: number, start: number, duration: number, volume = 0.15, type: OscillatorType = 'sine') {
  if (!ctx) ctx = new AudioContext();
  const t = ctx.currentTime + start;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(volume, t + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
  osc.connect(gain).connect(ctx.destination);
  osc.start(t);
  osc.stop(t + duration + 0.05);
}

/** Soft "someone arrived" ping. */
export function playVisitor() {
  try {
    tone(880, 0, 0.25, 0.08);
  } catch {}
}

/** Cash-register style chime for a payment. */
export function playPayment() {
  try {
    tone(1318.5, 0, 0.18, 0.12, 'triangle');
    tone(1760, 0.09, 0.35, 0.12, 'triangle');
    tone(2637, 0.18, 0.45, 0.08, 'sine');
  } catch {}
}

/** Browsers only allow audio after a user gesture; call this from the sound toggle's click. */
export function unlockAudio() {
  try {
    if (!ctx) ctx = new AudioContext();
    void ctx.resume();
  } catch {}
}
