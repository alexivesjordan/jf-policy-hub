const CUSTOMER_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** True when Cin7 and the quote have no customer email, so booking must collect one. */
export function bookingEmailMissing(stored: string | null | undefined) {
  return !stored?.trim();
}

/** The confirm button stays off until a stored address exists or the rep types one. */
export function bookingEmailReady(stored: string | null | undefined, typed: string) {
  if (!bookingEmailMissing(stored)) return true;
  return CUSTOMER_EMAIL.test(typed.trim());
}
