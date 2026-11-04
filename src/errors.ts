/** Thrown when a tape file cannot be parsed or fails validation. */
export class TapeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TapeError";
  }
}

/** Thrown when a request matches no interaction in `"strict"` mode. */
export class NoMatchError extends Error {
  constructor(
    message: string,
    /** The method and URL that found no tape entry. */
    public readonly request: { method: string; url: string },
  ) {
    super(message);
    this.name = "NoMatchError";
  }
}
