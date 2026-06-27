export type CancelPlan =
  | { mode: 'remembered'; codigo: string }
  | { mode: 'codeMatch'; codigo: string }
  | { mode: 'ask' };

export function planCancel(opts: {
  rememberedCode: string | null;
  apiCode: string;
  profileCode: string;
}): CancelPlan {
  if (opts.rememberedCode) return { mode: 'remembered', codigo: opts.rememberedCode };
  if (opts.apiCode && opts.apiCode === opts.profileCode) {
    return { mode: 'codeMatch', codigo: opts.apiCode };
  }
  return { mode: 'ask' };
}
