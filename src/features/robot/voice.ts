/**
 * How Buki talks.
 *
 * 1. A real voice from the device when it has one for the app language.
 * 2. Uzbek text with no Uzbek voice: a Turkish voice reads Latin Uzbek quite well once a few letters are
 *    respelled the Turkish way (sh → ş, ch → ç, g‘ → ğ, …).
 * 3. No speech engine at all (Android Telegram's WebView has none): Buki's own "robot language" — a short
 *    synthesized blip for every letter (vowels sing, consonants click), timed with the text appearing on screen.
 *    Web Audio only, no files, works everywhere.
 */
export type Locale = 'uz' | 'ru' | 'en';
export interface SpeakHandle { mode: 'voice' | 'robot'; stop(): void }
interface Opts {
  /** How many UTF-16 characters of the line are spoken so far. Only called when the number changes. */
  onProgress?: (shown: number) => void;
  /** Mouth open/closed, for lip-sync. Only called when it changes (a few times a second). */
  onMouth?: (open: boolean) => void;
  onEnd?: () => void;
}

let ctx: AudioContext | null = null;
export function audioContext(): AudioContext | null {
  try {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    ctx ??= new AC();
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch { return null; }
}

// ------------------------------------------------------------------ device voices
const synth = (): SpeechSynthesis | null => { try { return typeof speechSynthesis !== 'undefined' ? speechSynthesis : null; } catch { return null; } };
try { synth()?.getVoices(); } catch { /* voices load lazily in Chrome; asking early warms them up */ }

/** Latin Uzbek spelled so a Turkish voice pronounces it naturally. */
export function uzForTurkishVoice(text: string): string {
  return text
    .replace(/[oO][‘’ʻʼ'`]/g, (m) => (m[0] === 'O' ? 'O' : 'o'))
    .replace(/[gG][‘’ʻʼ'`]/g, (m) => (m[0] === 'G' ? 'Ğ' : 'ğ'))
    .replace(/Sh/g, 'Ş').replace(/sh/g, 'ş').replace(/SH/g, 'Ş')
    .replace(/Ch/g, 'Ç').replace(/ch/g, 'ç').replace(/CH/g, 'Ç')
    .replace(/q/g, 'k').replace(/Q/g, 'K')
    .replace(/x/g, 'h').replace(/X/g, 'H')
    .replace(/j/g, 'c').replace(/J/g, 'C')
    .replace(/[‘’ʻʼ`]/g, '');
}

/** Picks a device voice for the language; for Uzbek falls back to Turkish. */
export function pickVoice(locale: Locale): { voice: SpeechSynthesisVoice; respell: boolean } | null {
  const s = synth();
  if (!s) return null;
  let voices: SpeechSynthesisVoice[] = [];
  try { voices = s.getVoices(); } catch { return null; }
  const find = (p: string) => voices.find((v) => v.lang.toLowerCase().replace('_', '-').startsWith(p));
  const own = find(locale);
  if (own) return { voice: own, respell: false };
  if (locale === 'uz') { const tr = find('tr'); if (tr) return { voice: tr, respell: true }; }
  return null;
}

const clean = (text: string) => text.replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu, '').replace(/\s+/g, ' ').trim();

function speakWithVoice(text: string, locale: Locale, o: Opts): SpeakHandle | null {
  const pick = pickVoice(locale);
  const s = synth();
  if (!pick || !s) return null;
  try {
    s.cancel();
    const u = new SpeechSynthesisUtterance(pick.respell ? uzForTurkishVoice(clean(text)) : clean(text));
    u.voice = pick.voice; u.lang = pick.voice.lang; u.rate = 1.0; u.pitch = 1.3;
    let done = false;
    // the engine tells us when each word starts: the mouth opens on a word and closes shortly after
    let shut = 0;
    const flap = () => { o.onMouth?.(true); window.clearTimeout(shut); shut = window.setTimeout(() => !done && o.onMouth?.(false), 150); };
    u.onboundary = flap;
    u.onstart = flap;
    const end = () => { if (!done) { done = true; window.clearTimeout(shut); o.onMouth?.(false); o.onEnd?.(); } };
    u.onend = end; u.onerror = end;
    s.speak(u);
    o.onProgress?.(text.length);
    return { mode: 'voice', stop: () => { done = true; window.clearTimeout(shut); try { s.cancel(); } catch { /* ignore */ } } };
  } catch { return null; }
}

// ------------------------------------------------------------------ Buki's robot language
const VOWEL: Record<string, number> = {
  a: 1, e: 1.26, i: 1.5, o: 0.88, u: 0.78, ı: 1.4,
  а: 1, е: 1.26, ё: 1.1, и: 1.5, о: 0.88, у: 0.78, э: 1.2, ы: 1.35, ю: 0.82, я: 1.08,
};
/**
 * Buki's timbre in ONE oscillator per letter: a triangle wave plus a little square an octave up (what used to
 * be two oscillators and two gain nodes). Built once per audio context.
 */
let wave: PeriodicWave | null = null;
let waveCtx: AudioContext | null = null;
function bukiWave(ac: AudioContext): PeriodicWave {
  if (wave && waveCtx === ac) return wave;
  const N = 24;
  const real = new Float32Array(N + 1);
  const imag = new Float32Array(N + 1);
  for (let n = 1; n <= N; n += 2) imag[n] += (8 / (Math.PI * Math.PI * n * n)) * (((n - 1) / 2) % 2 ? -1 : 1); // triangle
  for (let n = 1; 2 * n <= N; n += 2) imag[2 * n] += 0.18 * (4 / (Math.PI * n)); // square, one octave up
  wave = ac.createPeriodicWave(real, imag); waveCtx = ac;
  return wave;
}

/** Seconds per character, before any speed-up for long lines. */
const STEP = 0.058;

/** Timeline: when each character appears (seconds from start). Spaces and punctuation are short pauses. */
export function robotTimeline(text: string): { at: number[]; total: number } {
  const chars = [...text];
  const speed = chars.length > 140 ? 140 / chars.length : 1; // long lines are spoken a little faster
  const at: number[] = [];
  let t = 0;
  for (const ch of chars) {
    at.push(t);
    if (/\s/.test(ch)) t += 0.07 * speed;
    else if (/[.!?…]/.test(ch)) t += 0.26 * speed;
    else if (/[,;:—–-]/.test(ch)) t += 0.14 * speed;
    else if (/[\p{L}\p{N}]/u.test(ch)) t += STEP * speed;
  }
  return { at, total: t + 0.12 };
}

function robotSpeak(text: string, o: Opts): SpeakHandle {
  const chars = [...text];
  const { at, total } = robotTimeline(text);
  const ac = audioContext();
  let master: GainNode | null = null;
  let start = performance.now() / 1000;
  if (ac) {
    try {
      master = ac.createGain();
      master.gain.value = 0.9;
      const filter = ac.createBiquadFilter();
      filter.type = 'lowpass'; filter.frequency.value = 2600; filter.Q.value = 0.8;
      master.connect(filter).connect(ac.destination);
      const t0 = ac.currentTime + 0.03;
      const timbre = bukiWave(ac);
      start = performance.now() / 1000 + 0.03;
      chars.forEach((ch, i) => {
        const c = ch.toLowerCase();
        if (!/[\p{L}\p{N}]/u.test(c)) return;
        const isVowel = c in VOWEL;
        // consonants: a quick click of noise-ish pitch; vowels: a little sung tone
        const base = isVowel ? 430 * VOWEL[c] : 300 + ((c.codePointAt(0)! * 53) % 170);
        const when = t0 + at[i];
        const dur = isVowel ? 0.075 : 0.04;
        const osc = ac.createOscillator();
        const g = ac.createGain();
        osc.setPeriodicWave(timbre);
        osc.frequency.setValueAtTime(base, when);
        osc.frequency.exponentialRampToValueAtTime(base * (isVowel ? 1.08 : 0.92), when + dur);
        g.gain.setValueAtTime(0.0001, when);
        g.gain.exponentialRampToValueAtTime(isVowel ? 0.075 : 0.045, when + 0.008);
        g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
        osc.connect(g).connect(master!);
        osc.start(when); osc.stop(when + dur + 0.02);
      });
    } catch { master = null; }
  }
  // Text appears in step with the sound (or silently, when audio is blocked). The callbacks fire only when
  // something visible changes, so the screen is redrawn a few times a second — not on every timer tick.
  const len: number[] = []; // UTF-16 length of the first i characters
  { let n = 0; len.push(0); for (const ch of chars) { n += ch.length; len.push(n); } }
  let shown = 0;
  let mouth = false;
  let mouthAt = 0;
  let finished = false;
  const tick = window.setInterval(() => {
    const el = performance.now() / 1000 - start;
    const before = shown;
    while (shown < chars.length && at[shown] <= el) shown++;
    if (shown !== before) {
      o.onProgress?.(len[shown]);
      const open = (chars[shown - 1]?.toLowerCase() ?? '') in VOWEL;
      // at most ~8 mouth moves a second: lively enough to read as talking, cheap to draw
      if (open !== mouth && el - mouthAt >= 0.12) { mouth = open; mouthAt = el; o.onMouth?.(open); }
    }
    if (el >= total) { stop(false); }
  }, 50);
  function stop(cancelled = true) {
    if (finished) return;
    finished = true;
    window.clearInterval(tick);
    if (cancelled && master) { try { master.gain.value = 0; master.disconnect(); } catch { /* ignore */ } }
    if (mouth) o.onMouth?.(false);
    o.onProgress?.(text.length);
    o.onEnd?.();
  }
  return { mode: 'robot', stop: () => stop(true) };
}

/** Says the line: device voice when there is one, otherwise Buki's robot language. */
export function speak(text: string, locale: Locale, o: Opts = {}): SpeakHandle {
  return speakWithVoice(text, locale, o) ?? robotSpeak(text, o);
}

export function hushAll(): void { try { synth()?.cancel(); } catch { /* ignore */ } }
