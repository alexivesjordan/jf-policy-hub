import { generateOrbitToken, hashOrbitToken } from "../src/lib/orbit/token-hash";
import { orbitStoragePath, prepareOrbitUpload } from "../src/lib/orbit/prepare-upload";

const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

async function main() {
  const first = generateOrbitToken();
  const second = generateOrbitToken();
  assert(first.token.length === 43, "token length");
  assert(first.hashHex.length === 64, "hash length");
  assert(hashOrbitToken(first.token) === first.hashHex, "hash mismatch");
  assert(first.token !== second.token, "tokens collided");
  assert(!first.token.includes(first.hashHex), "token contained the hash");
  assert(hashOrbitToken("not-a-token") === null, "short token was accepted");

  const image = await prepareOrbitUpload("qc", "image/png", png);
  assert(image.mimeType === "image/jpeg", "image was not stored as jpeg");
  assert(image.extension === "jpg", "image extension");
  assert(image.bytes.length > 0, "resized image was empty");

  const pdf = await prepareOrbitUpload("terms", "application/pdf", Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\n"));
  assert(pdf.mimeType === "application/pdf", "pdf mime changed");
  assert(pdf.extension === "pdf", "pdf extension");

  let rejected = false;
  try {
    await prepareOrbitUpload("terms", "image/png", png);
  } catch {
    rejected = true;
  }
  assert(rejected, "terms bucket accepted an image");

  const path = orbitStoragePath("ops", "22222222-2222-4222-8222-222222222222", "jpg");
  assert(path.startsWith("ops/22222222-2222-4222-8222-222222222222/"), "storage path shape");
  assert(!path.includes("..") && !path.includes("customer"), "storage path leaked a name");

  console.log("orbit m0 app checks passed");
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "check failed";
  console.error(message);
  process.exit(1);
});
