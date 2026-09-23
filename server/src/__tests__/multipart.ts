/**
 * A multipart/form-data body for app.inject, built by the platform FormData
 * exactly as a browser would send it: text fields first, then one file part.
 */
export async function multipartUpload(
  fields: Record<string, string>,
  content: string | Buffer,
  contentType: string,
): Promise<{ payload: Buffer; headers: { "content-type": string } }> {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.append(key, value);
  form.append("file", new Blob([content], { type: contentType }), fields.name ?? "upload");
  const request = new Request("http://upload.invalid/", { method: "POST", body: form });
  return {
    payload: Buffer.from(await request.arrayBuffer()),
    headers: { "content-type": request.headers.get("content-type")! },
  };
}
