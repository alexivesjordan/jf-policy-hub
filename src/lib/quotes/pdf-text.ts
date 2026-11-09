import { extractTextItems } from "unpdf";

type TextItem = {
  str: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

/** Turn PDF text positions into lines, close to pdftotext -layout. */
export async function pdfBytesToLayoutText(bytes: Uint8Array): Promise<string> {
  const { items: pages } = await extractTextItems(bytes);
  return pages
    .map((page) => layoutPage(page as TextItem[]))
    .filter((page) => page.length > 0)
    .join("\n");
}

function layoutPage(items: TextItem[]): string {
  const usable = items.filter((item) => item.str.trim().length > 0);
  usable.sort((a, b) => (Math.abs(a.y - b.y) > 2 ? b.y - a.y : a.x - b.x));
  const groups: TextItem[][] = [];
  for (const item of usable) {
    const current = groups[groups.length - 1];
    const previous = current?.[current.length - 1];
    if (!current || !previous || Math.abs(previous.y - item.y) > 3) groups.push([item]);
    else current.push(item);
  }
  return groups
    .map((group) => {
      const ordered = [...group].sort((a, b) => a.x - b.x);
      let text = "";
      let previous: TextItem | undefined;
      for (const part of ordered) {
        if (previous) {
          const gap = part.x - (previous.x + previous.width);
          if (gap > 1.5 && !text.endsWith(" ") && !part.str.startsWith(" ")) text += " ";
        }
        text += part.str;
        previous = part;
      }
      return text.replace(/\s+/g, " ").trim();
    })
    .filter(Boolean)
    .join("\n");
}
