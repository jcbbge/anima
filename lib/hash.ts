/**
 * hash.ts
 * SHA-256 content hashing via Deno native crypto.subtle.
 * No imports required — crypto is a Deno global.
 */

export async function generateHash(content: string): Promise<string> {
  if (!content || typeof content !== "string") {
    throw new Error("Content must be a non-empty string");
  }
  const buf = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(content),
  );
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
