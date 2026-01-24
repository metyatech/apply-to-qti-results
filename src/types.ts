export type ScoringError = {
  path: string;
  identifier?: string;
  reason: string;
};

export class ScoringFailure extends Error {
  readonly payload: ScoringError;

  constructor(payload: ScoringError) {
    super(payload.reason);
    this.payload = payload;
  }
}
