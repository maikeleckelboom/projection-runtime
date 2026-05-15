import type { JsonValue } from "./json";
import { panic } from "./panic";

export type ErrorSeverity = "warning" | "error" | "fatal";

export interface ErrorMeta {
  readonly severity: ErrorSeverity;
  readonly recoverable: boolean;
  readonly boundarySafe: boolean;
  readonly docsUrl?: string;
  readonly tags?: readonly string[];
  readonly domainHint?: string;
}

export interface ErrorDetails {
  readonly where?: string;
  readonly detail?: string;
  readonly feature?: string;
  readonly reason?: string;
  readonly [key: string]: JsonValue | undefined;
}

export interface ErrorEnvelope {
  readonly code: string;
  readonly message: string;
  readonly meta: ErrorMeta;
  readonly details?: ErrorDetails;
}

export type ErrorKeyFromCode<Code extends string> = Code extends `${string}.${infer Key}`
  ? Key
  : never;

export class ExclaveError<Code extends string = string> extends Error {
  readonly code: Code;
  readonly details: ErrorDetails;
  readonly meta: ErrorMeta;

  constructor(
    code: Code,
    message: string,
    details: ErrorDetails,
    meta: ErrorMeta,
    cause?: unknown,
  ) {
    super(message, { cause });

    this.name = "ExclaveError";
    this.code = code;
    this.details = details;
    this.meta = meta;

    Object.setPrototypeOf(this, new.target.prototype);
  }

  toJSON(): ErrorEnvelope & { readonly code: Code } {
    return {
      code: this.code,
      message: this.message,
      meta: this.meta,
      details: this.details,
    };
  }
}

export function isExclaveError(value: unknown): value is ExclaveError {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as {
    readonly name?: unknown;
    readonly code?: unknown;
    readonly message?: unknown;
  };

  return (
    candidate.name === "ExclaveError" &&
    typeof candidate.code === "string" &&
    typeof candidate.message === "string"
  );
}

type StringKeyOf<T> = Extract<keyof T, string>;

export interface ErrorDescriptor {
  readonly code: string;
  readonly message: string;
  readonly meta: ErrorMeta;
}

export type ErrorRegistry = Record<string, ErrorDescriptor>;

export interface DomainDef {
  readonly message: string;
  readonly meta: ErrorMeta;
}

type DomainKeys<Defs extends { readonly [K in keyof Defs]: DomainDef }> = StringKeyOf<Defs>;

export type DomainRegistry<
  Prefix extends string,
  Defs extends { readonly [K in keyof Defs]: DomainDef },
> = {
  readonly [Key in DomainKeys<Defs>]: {
    readonly code: `${Prefix}.${Key}`;
    readonly message: Defs[Key]["message"];
    readonly meta: Defs[Key]["meta"];
  };
};

export interface ErrorDomain<Prefix extends string, Registry extends ErrorRegistry> {
  readonly prefix: Prefix;
  readonly registry: Registry;
}

export type ErrorCodeOf<D extends ErrorDomain<string, ErrorRegistry>> =
  D["registry"][keyof D["registry"]]["code"];

export type ErrorKeyOf<D extends ErrorDomain<string, ErrorRegistry>> = StringKeyOf<D["registry"]>;

export type ErrorFactoryOf<D extends ErrorDomain<string, ErrorRegistry>> = <
  Key extends ErrorKeyOf<D>,
>(
  key: Key,
  details?: ErrorDetails,
  cause?: unknown,
) => ExclaveError<D["registry"][Key]["code"]>;

type ErrorFactoryForRegistry<Registry extends ErrorRegistry> = <Key extends StringKeyOf<Registry>>(
  key: Key,
  details?: ErrorDetails,
  cause?: unknown,
) => ExclaveError<Registry[Key]["code"]>;

export type KeyedErrorFactoryOf<
  D extends ErrorDomain<string, ErrorRegistry>,
  DetailsByKey extends Record<ErrorKeyOf<D>, ErrorDetails>,
> = <Key extends ErrorKeyOf<D>>(
  key: Key,
  details: DetailsByKey[Key],
  cause?: unknown,
) => ExclaveError<D["registry"][Key]["code"]>;

export type ErrorDomainWithFactory<
  Prefix extends string,
  Defs extends { readonly [K in keyof Defs]: DomainDef },
> = ErrorDomain<Prefix, DomainRegistry<Prefix, Defs>> & {
  readonly createError: ErrorFactoryOf<ErrorDomain<Prefix, DomainRegistry<Prefix, Defs>>>;
};

export function createErrorFactory<Registry extends ErrorRegistry>(
  registry: Registry,
): ErrorFactoryForRegistry<Registry> {
  return <Key extends StringKeyOf<Registry>>(
    key: Key,
    details: ErrorDetails = {},
    cause?: unknown,
  ): ExclaveError<Registry[Key]["code"]> => {
    const descriptor = registry[key];

    if (descriptor === undefined) {
      panic(`unknown error key: ${key}`);
    }

    return new ExclaveError(descriptor.code, descriptor.message, details, descriptor.meta, cause);
  };
}

export function defineErrorDomain<
  const Prefix extends string,
  const Defs extends { readonly [K in keyof Defs]: DomainDef },
>(prefix: Prefix, defs: Defs): ErrorDomainWithFactory<Prefix, Defs> {
  const registry: Record<string, ErrorDescriptor> = {};

  for (const key of Object.keys(defs) as DomainKeys<Defs>[]) {
    const def = defs[key];

    if (def === undefined) {
      panic(`unknown error definition: ${key}`);
    }

    registry[key] = {
      code: `${prefix}.${key}`,
      message: def.message,
      meta: def.meta,
    };
  }

  const typedRegistry = registry as DomainRegistry<Prefix, Defs>;
  const domain: ErrorDomain<Prefix, DomainRegistry<Prefix, Defs>> = {
    prefix,
    registry: typedRegistry,
  };

  const createError: ErrorFactoryOf<typeof domain> = createErrorFactory(typedRegistry);

  return {
    ...domain,
    createError,
  };
}
