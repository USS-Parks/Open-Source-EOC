import type { ApiClient } from "../api/client.js";

/** Read a browser File as base64 (no data: prefix), for the JSON upload API. */
export function readAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const s = String(reader.result);
      const comma = s.indexOf(",");
      resolve(comma === -1 ? s : s.slice(comma + 1));
    };
    reader.onerror = () => reject(reader.error ?? new Error("read failed"));
    reader.readAsDataURL(file);
  });
}

/** Upload a picked file to a jurisdiction and return its stored id. */
export async function uploadPickedFile(
  client: ApiClient,
  jurisdictionId: string,
  file: File,
): Promise<string> {
  const dataBase64 = await readAsBase64(file);
  const result = await client.uploadFile(jurisdictionId, {
    name: file.name,
    contentType: file.type || "application/octet-stream",
    dataBase64,
  });
  return result.id;
}
