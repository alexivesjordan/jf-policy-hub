import { canUseOperations, canUsePeople, homeRedirect } from "../src/lib/access";
import type { Profile } from "../src/lib/types";
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

  const opsOnly: Profile = {
    id: "00000000-0000-4000-8000-000000000001",
    email: "ops.only@jordanfitness.com",
    full_name: null,
    role: "staff",
    is_active: true,
    access_granted: true,
    last_sign_in_at: null,
    created_at: "2026-11-05T00:00:00Z",
    updated_at: "2026-11-05T00:00:00Z",
    modules: [
      { module_id: "people", enabled: false },
      { module_id: "operations", enabled: true },
    ],
  };
  assert(canUseOperations(opsOnly) && !canUsePeople(opsOnly), "operations licence");
  assert(homeRedirect(opsOnly) === null, "operations home");
  assert(homeRedirect(null) === "/login", "signed out home");
  const neither: Profile = {
    ...opsOnly,
    modules: [{ module_id: "operations", enabled: false }],
  };
  assert(homeRedirect(neither) === "/no-access", "no module home");

  console.log("orbit m0 app checks passed");
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "check failed";
  console.error(message);
  process.exit(1);
});
