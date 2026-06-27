import { describe, it, expect } from 'vitest';
import { buildPushText } from './pushText';
describe('buildPushText', () => {
  it('localizes by locale and falls back to uk', () => {
    expect(buildPushText('en', 'freed', { time: '19:00', fecha: '20260628' }).body).toContain('Slot freed');
    expect(buildPushText('ru', 'grabbed', { time: '19:00', fecha: '20260628' }).title).toBe('🎯 Pádel');
    expect(buildPushText('xx', 'limitOff', {}).body).toContain('ліміт'); // unknown → uk
  });
});
