// Small shared primitives for the API layer: opaque JSON blobs and
// reader/fetch option contracts that stay independent of the wire types.

export type ApiJsonValue =
  | string
  | number
  | boolean
  | null
  | ApiOpaqueObject
  | ApiJsonValue[];

export interface ApiOpaqueObject {
  readonly [key: string]: ApiJsonValue | undefined;
  readonly __apiOpaqueObject?: never;
}

export interface StreamReader {
  readonly read: () => Promise<ReadableStreamReadResult<Uint8Array>>;
  readonly cancel: () => Promise<void>;
}

export interface ApiRequestInit {
  readonly method?: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: string;
  readonly signal?: AbortSignal;
}
export interface AgenticResearchCitation {
  readonly id?: number | null;
  readonly title?: string | null;
  readonly url?: string | null;
  readonly source?: string | null;
}

export interface AgenticResearchResult {
  readonly success: boolean;
  readonly answer: string;
  readonly reasoning?: readonly unknown[];
  readonly citations?: readonly AgenticResearchCitation[];
}
