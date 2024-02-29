export {};

declare global {
  interface Date {
    toTemporalInstant(): Temporal.Instant;
  }
}
