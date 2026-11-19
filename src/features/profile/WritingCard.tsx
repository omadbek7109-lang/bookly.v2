import { useSettings, useLibrary } from '../../app/AppContext';
import { Segmented } from '../../components/ui';
import type { MessageKey } from '../../i18n';
import { achievements, ACHIEVEMENTS, lastDays, streakOf, todayKey, useWritingLog } from '../../services/stats/writing';

const GOALS = [150, 300, 500, 1000];

/** Daily writing goal with a progress ring, the streak, the last 7 days and the achievements. */
export function WritingCard() {
  const { t, settings, update } = useSettings();
  const { books } = useLibrary();
  const log = useWritingLog();
  const goal = settings.writingGoal || 300;
  const today = log.days[todayKey()] ?? 0;
  const pct = Math.min(1, today / goal);
  const streak = streakOf(log.days, goal);
  const week = lastDays(7);
  const wmax = Math.max(goal, ...week.map((d) => log.days[d] ?? 0));
  const ach = achievements(books, log, goal);
  const got = ACHIEVEMENTS.filter((a) => ach[a.id]).length;
  const R = 34, C = 2 * Math.PI * R;
  return (
    <section className="writing-card glass" data-testid="writing-card">
      <div className="writing-top">
        <svg className="goal-ring" viewBox="0 0 84 84" width="84" height="84" role="img" aria-label={t('goal.aria', { n: today, g: goal })}>
          <circle cx="42" cy="42" r={R} className="goal-track" />
          <circle cx="42" cy="42" r={R} className="goal-fill" strokeDasharray={C} strokeDashoffset={C * (1 - pct)} transform="rotate(-90 42 42)" />
          <text x="42" y="40" textAnchor="middle" className="goal-num">{today}</text>
          <text x="42" y="55" textAnchor="middle" className="goal-of">/ {goal}</text>
        </svg>
        <div className="writing-text">
          <strong>{pct >= 1 ? t('goal.done') : t('goal.title')}</strong>
          <small>{pct >= 1 ? t('goal.doneText') : t('goal.left', { n: Math.max(0, goal - today) })}</small>
          <span className="streak" data-testid="streak">🔥 {t('goal.streak', { n: streak })} · {t('goal.best', { n: Math.max(log.best, streak) })}</span>
        </div>
      </div>
      <div className="week-bars" aria-hidden="true">
        {week.map((d) => {
          const v = log.days[d] ?? 0;
          return (
            <span key={d} className={`wb ${v >= goal ? 'is-goal' : ''}`}>
              <i style={{ height: `${Math.max(6, (v / wmax) * 100)}%` }} />
              <small>{new Date(`${d}T12:00:00`).toLocaleDateString(settings.locale === 'uz' ? 'uz-Latn' : settings.locale, { weekday: 'narrow' })}</small>
            </span>
          );
        })}
      </div>
      <Segmented value={String(GOALS.includes(goal) ? goal : 300)} onChange={(v) => update({ writingGoal: Number(v) })} label={t('goal.pick')}
        options={GOALS.map((g) => ({ value: String(g), label: t('goal.words', { n: g }) }))} />
      <div className="ach-head"><strong>{t('ach.title')}</strong><small>{got}/{ACHIEVEMENTS.length}</small></div>
      <ul className="ach-grid" data-testid="achievements">
        {ACHIEVEMENTS.map((a) => (
          <li key={a.id} className={ach[a.id] ? 'is-got' : ''} title={t(`ach.${a.id}.hint` as MessageKey)} data-got={ach[a.id] ? '1' : '0'}>
            <span className="ach-icon" aria-hidden="true">{a.icon}</span>
            <span>{t(`ach.${a.id}` as MessageKey)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
