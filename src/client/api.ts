/** A refused request: the server's message, its HTTP status and the full response body. */
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public data: any,
  ) {
    super(message);
  }
}
export async function api(path: string, body?: unknown) {
  const r = await fetch("/api" + path, {
    method: body === undefined ? "GET" : "POST",
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await r.json();
  if (!r.ok)
    throw new ApiError(data.error?.message ?? "Request failed", r.status, data);
  return data;
}
/** Streams a recording to the journey's media store; returns the stored media. */
export async function uploadMedia(journey: string, blob: Blob) {
  const r = await fetch(`/api/journeys/${encodeURIComponent(journey)}/media`, {
    method: "PUT",
    headers: { "Content-Type": blob.type },
    body: blob,
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok)
    throw new ApiError(data.error?.message ?? "Upload failed", r.status, data);
  return data as { id: string; mime: string; size: number };
}
