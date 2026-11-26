/** Trust the browser only after two-step is not still due. */
export function shouldTrustDeviceNow(stay: boolean, due: boolean) {
  return stay && !due;
}
