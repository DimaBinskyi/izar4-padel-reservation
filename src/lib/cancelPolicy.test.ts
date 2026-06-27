import { describe, it, expect } from 'vitest';
import { planCancel } from './cancelPolicy';

describe('planCancel', () => {
  it('uses remembered code when present', () => {
    expect(planCancel({ rememberedCode: 'sol24', apiCode: 'whatever', profileCode: 'luna25' }))
      .toEqual({ mode: 'remembered', codigo: 'sol24' });
  });
  it('one-tap when api code equals the profile code', () => {
    expect(planCancel({ rememberedCode: null, apiCode: 'sol24', profileCode: 'sol24' }))
      .toEqual({ mode: 'codeMatch', codigo: 'sol24' });
  });
  it('asks when api code differs from profile code', () => {
    expect(planCancel({ rememberedCode: null, apiCode: 'other', profileCode: 'sol24' }))
      .toEqual({ mode: 'ask' });
  });
  it('asks when no remembered code and api code unknown', () => {
    expect(planCancel({ rememberedCode: null, apiCode: '', profileCode: 'sol24' }))
      .toEqual({ mode: 'ask' });
  });
});
