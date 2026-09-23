import type { ApiClient } from "../api/client.js";

/** Upload a picked file to a jurisdiction and return its stored id. */
export async function uploadPickedFile(
  client: ApiClient,
  jurisdictionId: string,
  file: File,
): Promise<string> {
  const result = await client.uploadFile(jurisdictionId, {
    name: file.name,
    contentType: file.type || "application/octet-stream",
    file,
  });
  return result.id;
}
