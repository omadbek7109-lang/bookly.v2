import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useSettings } from '../../app/AppContext';
import { navigate, routes, useRoute } from '../../app/router';
import { Icon } from '../../components/Icon';
import type { MessageKey } from '../../i18n';
import { audioContext, hushAll, speak, type SpeakHandle } from './voice';

/**
 * Buki — the little helper robot. Round, friendly, explains the screen you are on.
 * - Tips are per screen; a short guided tour walks through the whole app.
 * - Sounds: tiny synthesized chirps (Web Audio, no files). Voice: reads the tip aloud when the device has a
 *   voice for the app language. Both can be switched off in Profile.
 * - Battery friendly: no endless CSS animation; eyes blink from a timer that stops when the app is hidden.
 */

type Mood = 'idle' | 'talk' | 'happy';
export function RobotFace({ size = 56, mood = 'idle', blink = false }: { size?: number; mood?: Mood; blink?: boolean }) {
  const eyeH = blink ? 1.5 : mood === 'happy' ? 5 : 9;
  return (
    <svg className={`robot-face is-${mood}`} viewBox="0 0 64 64" width={size} height={size} aria-hidden="true">
      <defs>
        <linearGradient id="rb-head" x1="0" y1="0" x2="1" y2="1"><stop offset="0" style={{ stopColor: 'var(--lavender)' }} /><stop offset="1" style={{ stopColor: 'var(--primary)' }} /></linearGradient>
        <radialGradient id="rb-glow" cx=".5" cy=".5" r=".5"><stop offset="0" stopColor="#fff" /><stop offset="1" style={{ stopColor: 'var(--pink)' }} /></radialGradient>
      </defs>
      {/* antenna */}
      <path d="M32 9v7" style={{ stroke: 'var(--indigo-deep)' }} strokeWidth="2.4" strokeLinecap="round" />
      <circle className="robot-bulb" cx="32" cy="7" r="4" fill="url(#rb-glow)" />
      {/* ears */}
      <rect x="4" y="28" width="6" height="12" rx="3" style={{ fill: 'var(--indigo)' }} />
      <rect x="54" y="28" width="6" height="12" rx="3" style={{ fill: 'var(--indigo)' }} />
      {/* head */}
      <circle cx="32" cy="35" r="23" fill="url(#rb-head)" />
      <ellipse cx="25" cy="22" rx="9" ry="4" fill="#fff" opacity=".28" />
      {/* face screen */}
      <rect x="16" y="25" width="32" height="22" rx="11" style={{ fill: 'var(--indigo-deep)' }} />
      {/* eyes */}
      <rect className="robot-eye" x="22.5" y={36 - eyeH / 2} width="6" height={eyeH} rx="3" fill="#fff" />
      <rect className="robot-eye" x="35.5" y={36 - eyeH / 2} width="6" height={eyeH} rx="3" fill="#fff" />
      {/* cheeks */}
      <circle cx="19" cy="44" r="2.6" fill="#fda4af" opacity=".75" />
      <circle cx="45" cy="44" r="2.6" fill="#fda4af" opacity=".75" />
      {/* mouth */}
      {mood === 'talk'
        ? <ellipse className="robot-mouth" cx="32" cy="43" rx="3.4" ry="2.2" fill="#fff" />
        : <path d="M28 42.5q4 3.2 8 0" fill="none" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" />}
    </svg>
  );
}

// ------------------------------------------------------------------ sounds
/** A tiny two-note "beep-boop" made on the fly. kind: hello (rising), tip (soft), bye (falling). */
export function chirp(kind: 'hello' | 'tip' | 'bye' = 'tip') {
  const audio = audioContext();
  if (!audio) return;
  try {
    const notes = kind === 'hello' ? [660, 990, 1320] : kind === 'bye' ? [880, 590] : [880, 1180];
    const t0 = audio.currentTime + 0.01;
    notes.forEach((f, i) => {
      const o = audio.createOscillator(); const g = audio.createGain();
      o.type = 'sine';
      o.frequency.setValueAtTime(f, t0 + i * 0.09);
      o.frequency.exponentialRampToValueAtTime(f * 1.12, t0 + i * 0.09 + 0.07);
      g.gain.setValueAtTime(0.0001, t0 + i * 0.09);
      g.gain.exponentialRampToValueAtTime(0.07, t0 + i * 0.09 + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + i * 0.09 + 0.085);
      o.connect(g).connect(audio.destination);
      o.start(t0 + i * 0.09); o.stop(t0 + i * 0.09 + 0.1);
    });
  } catch { /* audio blocked: stay quiet */ }
}

// ------------------------------------------------------------------ tips
const TIPS: Record<string, MessageKey[]> = {
  home: ['robot.tip.home.1', 'robot.tip.home.2', 'robot.tip.home.3'],
  books: ['robot.tip.books.1', 'robot.tip.books.2', 'robot.tip.books.3'],
  studio: ['robot.tip.studio.1', 'robot.tip.studio.2'],
  templates: ['robot.tip.studio.2'],
  profile: ['robot.tip.profile.1', 'robot.tip.profile.2', 'robot.tip.profile.3'],
  cover: ['robot.tip.cover.1', 'robot.tip.cover.2'],
  export: ['robot.tip.export.1', 'robot.tip.export.2'],
  import: ['robot.tip.import.1'],
  cloud: ['robot.tip.cloud.1'],
  help: ['robot.tip.help.1'],
  about: ['robot.tip.help.1'],
  admin: ['robot.tip.admin.1'],
};
const TOUR: { text: MessageKey; to?: string; cta?: MessageKey }[] = [
  { text: 'robot.tour.1' },
  { text: 'robot.tour.2', to: routes.create(), cta: 'robot.tour.open' },
  { text: 'robot.tour.3' },
  { text: 'robot.tour.4', to: routes.cover(), cta: 'robot.tour.open' },
  { text: 'robot.tour.5', to: routes.export(), cta: 'robot.tour.open' },
  { text: 'robot.tour.6', to: routes.profile(), cta: 'robot.tour.open' },
];

interface RobotCtx { say: (text: string) => void; startTour: () => void }
const Ctx = createContext<RobotCtx>({ say: () => {}, startTour: () => {} });
export const useRobot = () => useContext(Ctx);

/** Screens where Buki stays out of the way (full-screen writing/reading). */
const HIDDEN = new Set(['editor', 'reader', 'create']);

export function RobotProvider({ children }: { children: ReactNode }) {
  const { t, settings, update } = useSettings();
  const route = useRoute();
  const screen = route.parts[0] ?? 'home';
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [tour, setTour] = useState<number | null>(null);
  const [tipIdx, setTipIdx] = useState(0);
  const [mood, setMood] = useState<Mood>('idle');
  const [blink, setBlink] = useState(false);
  const [shown, setShown] = useState<number | null>(null);
  const [voiceMode, setVoiceMode] = useState<'' | 'voice' | 'robot'>('');
  const handle = useRef<SpeakHandle | null>(null);
  const token = useRef(0);
  const r = settings.robot;
  const visible = r.enabled && !HIDDEN.has(screen);

  const hush = useCallback(() => { token.current++; handle.current?.stop(); handle.current = null; hushAll(); setShown(null); }, []);

  const talk = useCallback((line: string, sound: 'hello' | 'tip' | 'bye' = 'tip') => {
    hush();
    const my = token.current;
    setText(line); setOpen(true); setMood('talk');
    if (r.voice) {
      // Buki speaks: device voice if there is one, otherwise his own robot language with the text typing along
      const h = speak(line, settings.locale, {
        onProgress: (n) => { if (token.current === my) setShown(n >= line.length ? null : n); },
        onEnd: () => { if (token.current === my) { setShown(null); setMood('happy'); } },
      });
      handle.current = h; setVoiceMode(h.mode);
    } else {
      setVoiceMode('');
      if (r.sounds) chirp(sound);
      window.setTimeout(() => { if (token.current === my) setMood('happy'); }, Math.min(2400, 600 + line.length * 18));
    }
  }, [r.sounds, r.voice, settings.locale, hush]);

  const tips = TIPS[screen] ?? TIPS.home;
  const nextTip = useCallback(() => {
    const i = (tipIdx + 1) % tips.length;
    setTipIdx(i); talk(t(tips[i]));
  }, [tipIdx, tips, talk, t]);

  // new screen → first tip of that screen next time the bubble opens
  useEffect(() => { setTipIdx(0); if (tour === null) setOpen(false); hush(); }, [screen]); // eslint-disable-line react-hooks/exhaustive-deps

  // first visit: Buki says hello once
  useEffect(() => {
    if (!r.enabled || settings.robotIntroSeen || !settings.introSeen) return;
    const id = window.setTimeout(() => { talk(t('robot.hello'), 'hello'); update({ robotIntroSeen: true }); }, 1200);
    return () => window.clearTimeout(id);
  }, [r.enabled, settings.robotIntroSeen, settings.introSeen]); // eslint-disable-line react-hooks/exhaustive-deps

  // eyes blink now and then (timer, not an endless animation), only while visible
  useEffect(() => {
    if (!visible || settings.reducedMotion) return;
    let alive = true; let id = 0;
    const loop = () => {
      id = window.setTimeout(() => {
        if (!alive) return;
        if (!document.hidden) { setBlink(true); window.setTimeout(() => alive && setBlink(false), 160); }
        loop();
      }, 3200 + Math.random() * 3200);
    };
    loop();
    return () => { alive = false; window.clearTimeout(id); };
  }, [visible, settings.reducedMotion]);

  // while the page scrolls Buki tucks into the screen edge, so he never sits on top of what you are reading
  const [tucked, setTucked] = useState(false);
  useEffect(() => {
    if (!visible) return;
    let t = 0;
    const onScroll = () => {
      setTucked(true);
      window.clearTimeout(t);
      t = window.setTimeout(() => setTucked(false), 900);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => { window.removeEventListener('scroll', onScroll); window.clearTimeout(t); };
  }, [visible]);

  useEffect(() => { if (!r.voice) hush(); }, [r.voice]);
  useEffect(() => () => hush(), []);

  const ctx = useMemo<RobotCtx>(() => ({
    say: (line) => talk(line),
    startTour: () => { if (!r.enabled) update({ robot: { ...r, enabled: true } }); setTour(0); talk(t(TOUR[0].text), 'hello'); },
  }), [talk, r, update, t]);

  const close = () => { setOpen(false); setTour(null); setMood('idle'); hush(); if (r.sounds) chirp('bye'); };
  const step = tour !== null ? TOUR[tour] : null;
  const goStep = (i: number) => { if (i >= TOUR.length) { close(); return; } setTour(i); talk(t(TOUR[i].text)); };

  return (
    <Ctx.Provider value={ctx}>
      {children}
      {visible && (
        <div className={`robot ${open ? 'is-open' : ''} ${tucked && !open ? 'is-tucked' : ''}`} data-testid="robot">
          {open && (
            <div className="robot-bubble" role="dialog" aria-live="polite" aria-label={t('robot.name')} data-testid="robot-bubble">
              <div className="robot-bubble-head">
                <strong>{t('robot.name')}</strong>
                {tour !== null && <small>{tour + 1}/{TOUR.length}</small>}
                <button type="button" className={`robot-mini ${r.voice ? 'is-on' : ''}`} onClick={() => update({ robot: { ...r, voice: !r.voice } })}
                  aria-label={t('robot.voice')} aria-pressed={r.voice} data-testid="robot-voice"><Icon name={r.voice ? 'music' : 'minus'} size={15} /></button>
                <button type="button" className="robot-mini" onClick={close} aria-label={t('common.close')} data-testid="robot-close"><Icon name="x" size={15} /></button>
              </div>
              <p data-testid="robot-text" data-full={text} data-voice={voiceMode}>
                {shown === null ? text : <><span aria-hidden="true">{text.slice(0, shown)}</span><span className="robot-ghost" aria-hidden="true">{text.slice(shown)}</span><span className="sr-only">{text}</span></>}
              </p>
              <div className="robot-actions">
                {step ? (
                  <>
                    {step.to && <button type="button" className="robot-btn ghost" onClick={() => navigate(step.to!)} data-testid="robot-open">{t(step.cta!)}</button>}
                    <button type="button" className="robot-btn" onClick={() => goStep(tour! + 1)} data-testid="robot-next">{tour! + 1 < TOUR.length ? t('robot.next') : t('robot.finish')}</button>
                  </>
                ) : (
                  <>
                    <button type="button" className="robot-btn ghost" onClick={() => navigate(routes.help())} data-testid="robot-help">{t('robot.helpCenter')}</button>
                    <button type="button" className="robot-btn" onClick={nextTip} data-testid="robot-next">{t('robot.anotherTip')}</button>
                  </>
                )}
              </div>
            </div>
          )}
          <button type="button" className={`robot-btn-main ${blink ? 'is-blink' : ''}`} onClick={() => (open ? close() : talk(t(tips[tipIdx]), 'hello'))}
            aria-label={t('robot.open')} aria-expanded={open} data-testid="robot-button">
            <RobotFace mood={shown !== null ? 'talk' : mood} blink={blink} size={54} />
          </button>
        </div>
      )}
    </Ctx.Provider>
  );
}
