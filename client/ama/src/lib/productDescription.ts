export type ProductDescriptionBlock =
  | { type: "paragraph"; text: string }
  | { type: "list"; items: string[] };

const BULLET_LINE_RE = /^[-*•]\s+(.+)$/;
const NUMBERED_LINE_RE = /^\d+[\.\)]\s+(.+)$/;

export function parseProductDescription(
  raw: string | null | undefined
): ProductDescriptionBlock[] {
  const text = String(raw || "").replace(/\r\n/g, "\n").trim();
  if (!text) return [];

  const lines = text.split("\n");
  const blocks: ProductDescriptionBlock[] = [];
  let paragraphLines: string[] = [];
  let listItems: string[] = [];

  const flushParagraph = () => {
    if (!paragraphLines.length) return;
    blocks.push({
      type: "paragraph",
      text: paragraphLines.join(" ").trim(),
    });
    paragraphLines = [];
  };

  const flushList = () => {
    if (!listItems.length) return;
    blocks.push({
      type: "list",
      items: [...listItems],
    });
    listItems = [];
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();

    if (!line) {
      flushParagraph();
      flushList();
      continue;
    }

    const bulletMatch = line.match(BULLET_LINE_RE) || line.match(NUMBERED_LINE_RE);
    if (bulletMatch) {
      flushParagraph();
      listItems.push(bulletMatch[1].trim());
      continue;
    }

    flushList();
    paragraphLines.push(line);
  }

  flushParagraph();
  flushList();

  return blocks;
}
