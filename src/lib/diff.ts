import { diffLines, type Change } from "diff";

export type DiffKind = "same" | "add" | "remove" | "empty";

export type DiffPair = {
  left: { text: string; kind: DiffKind };
  right: { text: string; kind: DiffKind };
};

function linesOf(value: string) {
  if (value.length === 0) return [];
  return value.replace(/\n$/, "").split("\n");
}

export function sideBySide(before: string, after: string): DiffPair[] {
  const parts: Change[] = diffLines(before ?? "", after ?? "");
  const rows: DiffPair[] = [];

  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index];
    const lines = linesOf(part.value);

    if (part.removed && parts[index + 1]?.added) {
      const nextLines = linesOf(parts[index + 1].value);
      const length = Math.max(lines.length, nextLines.length);
      for (let line = 0; line < length; line += 1) {
        rows.push({
          left: {
            text: lines[line] ?? "",
            kind: lines[line] === undefined ? "empty" : "remove",
          },
          right: {
            text: nextLines[line] ?? "",
            kind: nextLines[line] === undefined ? "empty" : "add",
          },
        });
      }
      index += 1;
      continue;
    }

    if (part.removed) {
      for (const line of lines) {
        rows.push({
          left: { text: line, kind: "remove" },
          right: { text: "", kind: "empty" },
        });
      }
      continue;
    }

    if (part.added) {
      for (const line of lines) {
        rows.push({
          left: { text: "", kind: "empty" },
          right: { text: line, kind: "add" },
        });
      }
      continue;
    }

    for (const line of lines) {
      rows.push({
        left: { text: line, kind: "same" },
        right: { text: line, kind: "same" },
      });
    }
  }

  return rows;
}
