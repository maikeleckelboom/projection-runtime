export interface ConformanceErrorDetails {
  readonly fixtureName?: string;
  readonly fixturePath?: string;
  readonly fixtureFile?: string;
  readonly relativePath?: string;
}

export class ConformanceError extends Error {
  readonly details: ConformanceErrorDetails;

  constructor(message: string, details: ConformanceErrorDetails = {}, options?: ErrorOptions) {
    super(message, options);
    this.name = "ConformanceError";
    this.details = details;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
