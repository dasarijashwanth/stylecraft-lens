// components/help/FaqMarkdown.tsx
// Dependency-free renderer for the narrow markdown subset actually used in
// lib/faq-seed-data.ts: **bold** spans, "- " bullet lists, "1. " numbered
// lists, and plain paragraphs. Content is admin-authored/seeded (not
// user-submitted), so this builds real React elements — never
// dangerouslySetInnerHTML — for simplicity and consistent styling, not XSS
// defense.
import React from "react";

const BULLET_RE = /^-\s+/;
const NUMBERED_RE = /^\d+\.\s+/;
const BOLD_RE = /\*\*(.+?)\*\*/g;

function renderInline(text: string, keyPrefix: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let i = 0;
  BOLD_RE.lastIndex = 0;
  while ((match = BOLD_RE.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }
    nodes.push(<strong key={`${keyPrefix}-b${i++}`}>{match[1]}</strong>);
    lastIndex = BOLD_RE.lastIndex;
  }
  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }
  return nodes;
}

interface Block {
  type: "ul" | "ol" | "p";
  lines: string[];
}

function groupIntoBlocks(lines: string[]): Block[] {
  const blocks: Block[] = [];
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    const type: Block["type"] = BULLET_RE.test(line) ? "ul" : NUMBERED_RE.test(line) ? "ol" : "p";
    const stripped = type === "ul" ? line.replace(BULLET_RE, "") : type === "ol" ? line.replace(NUMBERED_RE, "") : line;
    const last = blocks[blocks.length - 1];
    if (last && last.type === type && type !== "p") {
      last.lines.push(stripped);
    } else {
      blocks.push({ type, lines: [stripped] });
    }
  }
  return blocks;
}

export default function FaqMarkdown({ text, className }: { text: string; className?: string }) {
  const blocks = groupIntoBlocks(text.split("\n"));

  return (
    <div className={className}>
      {blocks.map((block, blockIdx) => {
        const key = `block-${blockIdx}`;
        if (block.type === "ul") {
          return (
            <ul key={key} className="list-disc pl-5 space-y-1 my-2">
              {block.lines.map((line, i) => (
                <li key={`${key}-${i}`}>{renderInline(line, `${key}-${i}`)}</li>
              ))}
            </ul>
          );
        }
        if (block.type === "ol") {
          return (
            <ol key={key} className="list-decimal pl-5 space-y-1 my-2">
              {block.lines.map((line, i) => (
                <li key={`${key}-${i}`}>{renderInline(line, `${key}-${i}`)}</li>
              ))}
            </ol>
          );
        }
        return (
          <p key={key} className="my-2 first:mt-0 last:mb-0">
            {renderInline(block.lines[0], key)}
          </p>
        );
      })}
    </div>
  );
}
