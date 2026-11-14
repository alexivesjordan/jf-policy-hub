export const CHARGES_HEADING = "Additional charges (ex VAT)";

/** Native checkbox so the form posts accept=yes, and so Space toggles it once it is enabled. */
export function TermsAcceptBox({
  ready,
  versionLabel,
}: {
  ready: boolean;
  versionLabel: string;
}) {
  return (
    <label htmlFor="access-terms-accept" className="flex min-h-11 cursor-pointer items-start gap-3 text-sm leading-6">
      <input
        id="access-terms-accept"
        type="checkbox"
        name="accept"
        value="yes"
        disabled={!ready}
        className="mt-1 size-5 shrink-0 appearance-auto accent-[#ce0037]"
      />
      <span>
        By ticking this box you accept the Jordan Fitness Installation Terms and Conditions (version {versionLabel}), including the additional charges below.
      </span>
    </label>
  );
}
