export function ServiceSheetNote({ sheet }: { sheet: { submitted: boolean; pdfUrl: string | null } | null }) {
  if (!sheet?.submitted) return null;
  return (
    <p className="text-base">
      Job sheet is in.
      {sheet.pdfUrl ? (
        <>
          {" "}
          <a className="font-semibold underline" href={sheet.pdfUrl}>Open the PDF</a>
        </>
      ) : null}
    </p>
  );
}
