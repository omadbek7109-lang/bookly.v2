/** Lets screens replay the opening intro (Profile → "Kirish animatsiyasini qayta ko‘rish"). */
export function replayIntro(): void {
  try {
    const s = JSON.parse(localStorage.getItem('bookly.settings') || '{}');
    s.introSeen = false;
    localStorage.setItem('bookly.settings', JSON.stringify(s));
  } catch { /* ignore */ }
  location.reload();
}
