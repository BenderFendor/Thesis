// Small shared primitives for the API layer: opaque JSON blobs and
// reader/fetch option contracts that stay independent of the wire types.

type ApiJsonValue = string | number | boolean | null | ApiOpaqueObject | readonly ApiJsonValue[];

interface ApiOpaqueObject {
  readonly [key: string]: ApiJsonValue | undefined;
  readonly __apiOpaqueObject?: never;
}

interface StreamReader {
  readonly read: () => Promise<ReadableStreamReadResult<Uint8Array>>;
  readonly cancel: () => Promise<void>;
}

interface ApiRequestInit {
  readonly method?: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: string;
  readonly signal?: AbortSignal;
}
interface AgenticResearchCitation {
  readonly id?: number | null;
  readonly title?: string | null;
  readonly url?: string | null;
  readonly source?: string | null;
}

interface AgenticResearchResult {
  readonly success: boolean;
  readonly answer: string;
  readonly reasoning?: readonly unknown[];
  readonly citations?: readonly AgenticResearchCitation[];
}
export type { ApiJsonValue, ApiOpaqueObject, StreamReader, ApiRequestInit, AgenticResearchCitation, AgenticResearchResult };
