import { test } from 'node:test';
import assert from 'node:assert/strict';
import { robotTimeline, uzForTurkishVoice } from '../../src/features/robot/voice';

test('Uzbek is respelled so a Turkish voice reads it naturally', () => {
  assert.equal(uzForTurkishVoice('Kitob o‘qish, g‘oya, shirin choy, qalam, xat, jo‘ja'), 'Kitob okiş, ğoya, şirin çoy, kalam, hat, coca');
  assert.equal(uzForTurkishVoice('O‘zbekiston, Shahar, Chiroq'), 'Ozbekiston, Şahar, Çirok');
  assert.equal(uzForTurkishVoice("ma’lumot o'qing"), 'malumot oking');
});

test('robot language: every letter gets a moment, pauses at spaces and full stops, long lines speed up', () => {
  const { at, total } = robotTimeline('Salom. Men Buki!');
  assert.equal(at.length, [...'Salom. Men Buki!'].length);
  for (let i = 1; i < at.length; i++) assert.ok(at[i] >= at[i - 1], 'time only moves forward');
  const afterDot = at[6] - at[5];
  const afterLetter = at[1] - at[0];
  assert.ok(afterDot > afterLetter * 3, 'a full stop is a real pause');
  assert.ok(total > 0.8 && total < 2, `short line takes about a second (${total})`);
  const long = robotTimeline('a'.repeat(600)).total;
  assert.ok(long < 12, `long lines stay short enough (${long.toFixed(1)}s)`);
  assert.equal(robotTimeline('🤖💜').total, 0.12, 'emoji make no sound');
});
