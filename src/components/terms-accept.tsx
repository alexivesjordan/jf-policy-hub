export const CHARGES_HEADING = "Additional charges (ex VAT)";

/**
 * Uncontrolled checkbox. It is always enabled. The label wraps the input and
 * does not also use htmlFor, so one click ticks it once. Submission still
 * requires accept=yes.
 */
export function TermsAcceptBox({ versionLabel }: { versionLabel: string }) {
  return (
    <label className="relative z-10 flex min-h-11 cursor-pointer items-start gap-3 text-sm leading-6">
      <input
        type="checkbox"
        name="accept"
        value="yes"
        className="mt-1 size-5 shrink-0 cursor-pointer appearance-auto accent-[#ce0037]"
      />
      <span>
        By ticking this box you accept the Jordan Fitness Installation Terms and Conditions (version {versionLabel}), including the additional charges below.
      </span>
    </label>
  );
}
