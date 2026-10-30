import mammoth from "mammoth";
import TurndownService from "turndown";
import { extractTextItems } from "unpdf";

const turndown = new TurndownService({
  headingStyle: "atx",
  bulletListMarker: "-",
  codeBlockStyle: "fenced",
  strongDelimiter: "**",
  emDelimiter: "*",
});

export type DocumentKind = "docx" | "pdf";

type TextItem = {
  str: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize: number;
};

type Line = {
  text: string;
  fontSize: number;
  y: number;
};

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
  const markdown = tidyMarkdown(turndown.turndown(html.value || ""));
  if (markdown.length > 0) return markdown;

  const raw = await mammoth.extractRawText({ buffer });
  return tidyMarkdown(raw.value);
}

export async function pdfToMarkdown(bytes: Uint8Array) {
  const { items: pages } = await extractTextItems(bytes);
  const sections = pages
    .map((page) => linesToMarkdown(linesFromItems(page as TextItem[])))
    .filter((section) => section.length > 0);
  return tidyMarkdown(sections.join("\n\n"));
}

export async function documentToMarkdown(kind: DocumentKind, bytes: Uint8Array) {
  return kind === "pdf" ? pdfToMarkdown(bytes) : docxToMarkdown(bytes);
}

function tidyMarkdown(value: string) {
  return value.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

function linesFromItems(items: TextItem[]): Line[] {
  const usable = items.filter((item) => item.str.trim().length > 0);
  usable.sort((a, b) => (Math.abs(a.y - b.y) > 2 ? b.y - a.y : a.x - b.x));

  const groups: TextItem[][] = [];
  for (const item of usable) {
    const current = groups[groups.length - 1];
    const previous = current?.[current.length - 1];
    const tolerance = Math.max(2, (item.height || item.fontSize || 10) * 0.45);
    if (!current || !previous || Math.abs(previous.y - item.y) > tolerance) {
      groups.push([item]);
    } else {
      current.push(item);
    }
  }

  return groups
    .map((parts) => {
      const ordered = [...parts].sort((a, b) => a.x - b.x);
      let text = "";
      let previous: TextItem | undefined;
      for (const part of ordered) {
        if (previous) {
          const gap = part.x - (previous.x + previous.width);
          const needsSpace = gap > Math.max(1.5, previous.fontSize * 0.15);
          if (needsSpace && !text.endsWith(" ") && !part.str.startsWith(" ")) text += " ";
        }
        text += part.str;
        previous = part;
      }
      return {
        text: text.replace(/\s+/g, " ").trim(),
        fontSize: Math.max(...ordered.map((part) => part.fontSize || part.height || 0)),
        y: ordered[0]?.y ?? 0,
      };
    })
    .filter((line) => line.text.length > 0);
}

function linesToMarkdown(lines: Line[]) {
  if (lines.length === 0) return "";
  const sizes = lines.map((line) => line.fontSize).sort((a, b) => a - b);
  const median = sizes[Math.floor(sizes.length / 2)] || 12;
  const blocks: string[] = [];
  let previous: Line | undefined;

  for (const line of lines) {
    const gap = previous ? previous.y - line.y : 0;
    const breakParagraph = Boolean(previous && gap > Math.max(previous.fontSize, line.fontSize) * 1.45);
    const bullet = line.text.match(/^(?:[•●▪◦]|[-*–])\s+(.+)$/);
    const numbered = line.text.match(/^(\d{1,3})[.)]\s+(.+)$/);
    const heading =
      !bullet &&
      !numbered &&
      line.fontSize >= median * 1.28 &&
      line.text.length <= 140;

    if (heading) {
      if (blocks.length > 0) blocks.push("");
      blocks.push(`${line.fontSize >= median * 1.6 ? "#" : "##"} ${line.text}`);
    } else if (bullet) {
      if (blocks.length > 0 && blocks[blocks.length - 1] !== "" && !blocks[blocks.length - 1].startsWith("- ")) {
        blocks.push("");
      }
      blocks.push(`- ${bullet[1]}`);
    } else if (numbered) {
      if (blocks.length > 0 && blocks[blocks.length - 1] !== "" && !/^\d+\. /.test(blocks[blocks.length - 1])) {
        blocks.push("");
      }
      blocks.push(`${numbered[1]}. ${numbered[2]}`);
    } else if (
      !breakParagraph &&
      blocks.length > 0 &&
      blocks[blocks.length - 1] !== "" &&
      !blocks[blocks.length - 1].startsWith("#") &&
      !blocks[blocks.length - 1].startsWith("- ") &&
      !/^\d+\. /.test(blocks[blocks.length - 1])
    ) {
      blocks[blocks.length - 1] = `${blocks[blocks.length - 1]} ${line.text}`.trim();
    } else {
      if (breakParagraph && blocks.length > 0 && blocks[blocks.length - 1] !== "") blocks.push("");
      blocks.push(line.text);
    }
    previous = line;
  }

  return blocks.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}
