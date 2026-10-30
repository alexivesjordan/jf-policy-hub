import "server-only";

import mammoth from "mammoth";
import TurndownService from "turndown";

const turndown = new TurndownService({
  headingStyle: "atx",
  bulletListMarker: "-",
  codeBlockStyle: "fenced",
  strongDelimiter: "**",
  emDelimiter: "*",
});

export type DocumentKind = "docx" | "pdf";

export function detectDocument(filename: string, bytes: Uint8Array): DocumentKind | null {
  const lower = filename.toLowerCase();
  const head = Buffer.from(bytes.subarray(0, 1024)).toString("latin1");

  if (lower.endsWith(".pdf") && head.includes("%PDF")) return "pdf";

  if (lower.endsWith(".docx") && bytes[0] === 0x50 && bytes[1] === 0x4b) {
    const probe = Buffer.from(bytes).toString("latin1");
    if (probe.includes("word/document.xml")) return "docx";
  }

  return null;
}

export async function docxToMarkdown(bytes: Uint8Array) {
  const buffer = Buffer.from(bytes);
  const html = await mammoth.convertToHtml({ buffer });
  const markdown = turndown
    .turndown(html.value || "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  if (markdown.length > 0) return markdown;

  const raw = await mammoth.extractRawText({ buffer });
  return raw.value.replace(/\n{3,}/g, "\n\n").trim();
}
