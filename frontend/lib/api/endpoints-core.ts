import { ApiError, api } from "./client";
import type { ApiResponseSchema } from "./client";

const UNAVAILABLE = 503;

async function fetchWithUnavailableMessage<ResponseData>(
  path: string,
  schema: ApiResponseSchema<ResponseData>,
  unavailableMessage: string,
): Promise<ResponseData> {
  try {
    return await api(path, schema);
  } catch (error) {
    if (error instanceof ApiError && error.status === UNAVAILABLE) {
      throw new Error(unavailableMessage, { cause: error });
    }
    throw error;
  }
}

export { UNAVAILABLE, fetchWithUnavailableMessage };
