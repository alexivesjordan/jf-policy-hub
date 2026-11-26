import { describe, expect, it } from "vitest";
import { EMAIL_CODE_UNAVAILABLE, emailCodesAvailable, emailSendAccepted } from "@/lib/two-step-email";
import { shouldTrustDeviceNow } from "@/lib/two-step-device";

describe("email codes", () => {
  it("stays closed when the mail key is missing", () => {
    expect(emailCodesAvailable({})).toBe(false);
    expect(emailCodesAvailable({ RESEND_API_KEY: "  " })).toBe(false);
    expect(EMAIL_CODE_UNAVAILABLE).not.toMatch(/\d{6}/);
  });

  it("opens only when a message is actually sent", () => {
    expect(emailCodesAvailable({ RESEND_API_KEY: "re_test" })).toBe(true);
    expect(emailSendAccepted("sent")).toBe(true);
    expect(emailSendAccepted("redirected")).toBe(true);
    expect(emailSendAccepted("logged")).toBe(false);
    expect(emailSendAccepted("failed")).toBe(false);
  });
});

describe("stay signed in", () => {
  it("does not trust the device while two-step is still due", () => {
    expect(shouldTrustDeviceNow(true, true)).toBe(false);
    expect(shouldTrustDeviceNow(true, false)).toBe(true);
    expect(shouldTrustDeviceNow(false, false)).toBe(false);
  });
});
