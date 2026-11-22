import React from 'react';

interface Props {
  content: string;
  onCitationClick?: (citationIndex: number) => void;
}

function renderInline(
  text: string,
  onCitationClick?: (citationIndex: number) => void
): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  const regex = /(\*\*[^*]+\*\*|`[^`]+`|\[\d+\])/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null = regex.exec(text);
  let key = 0;

  while (match !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
    const token = match[0];
    if (token.startsWith('**') && token.endsWith('**')) {
      parts.push(
        <strong key={key++} className="font-semibold text-white">
          {token.slice(2, -2)}
        </strong>
      );
    } else if (token.startsWith('`') && token.endsWith('`')) {
      parts.push(
        <code key={key++} className="font-mono text-[0.875em] bg-slate-800/90 text-teal-300 px-1.5 py-0.5 rounded">
          {token.slice(1, -1)}
        </code>
      );
    } else if (/^\[\d+\]$/.test(token)) {
      const idx = Number(token.slice(1, -1));
      if (onCitationClick) {
        parts.push(
          <button
            key={key++}
            type="button"
            onClick={() => onCitationClick(idx)}
            className="inline-flex items-center justify-center font-mono text-[11px] font-semibold text-teal-300 bg-teal-950/70 hover:bg-teal-900/70 border border-teal-800 rounded px-1.5 py-0.5 mx-0.5 align-baseline transition-colors"
            title={`Jump to source ${idx}`}
          >
            {idx}
          </button>
        );
      } else {
        parts.push(
          <span key={key++} className="font-mono text-xs font-medium text-teal-400">
            {token}
          </span>
        );
      }
    }
    lastIndex = match.index + token.length;
    match = regex.exec(text);
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return parts;
}

export const MarkdownProse: React.FC<Props> = ({ content, onCitationClick }) => {
  const lines = content.split('\n');
  const blocks: React.ReactNode[] = [];
  let listItems: { ordered: boolean; text: string }[] = [];
  let keyCounter = 0;

  const flushList = () => {
    if (listItems.length === 0) return;
    const isOrdered = listItems[0].ordered;
    const ListTag = isOrdered ? 'ol' : 'ul';
    blocks.push(
      <ListTag
        key={keyCounter++}
        className={`my-2.5 space-y-1.5 pl-5 text-[15px] leading-relaxed text-slate-200 ${
          isOrdered ? 'list-decimal' : 'list-disc'
        }`}
      >
        {listItems.map((item, idx) => (
          <li key={idx} className="pl-1">
            {renderInline(item.text, onCitationClick)}
          </li>
        ))}
      </ListTag>
    );
    listItems = [];
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      flushList();
      continue;
    }

    if (line.startsWith('### ')) {
      flushList();
      blocks.push(
        <h4 key={keyCounter++} className="text-sm font-semibold font-display text-white mt-4 mb-1.5">
          {renderInline(line.slice(4), onCitationClick)}
        </h4>
      );
      continue;
    }

    if (line.startsWith('## ') || line.startsWith('# ')) {
      flushList();
      const text = line.replace(/^#{1,2}\s+/, '');
      blocks.push(
        <h3 key={keyCounter++} className="text-base font-semibold font-display text-white mt-4 mb-2">
          {renderInline(text, onCitationClick)}
        </h3>
      );
      continue;
    }

    const bulletMatch = line.match(/^[-*•]\s+(.*)$/);
    if (bulletMatch) {
      if (listItems.length > 0 && listItems[0].ordered) flushList();
      listItems.push({ ordered: false, text: bulletMatch[1] });
      continue;
    }

    const orderedMatch = line.match(/^\d+\.\s+(.*)$/);
    if (orderedMatch) {
      if (listItems.length > 0 && !listItems[0].ordered) flushList();
      listItems.push({ ordered: true, text: orderedMatch[1] });
      continue;
    }

    flushList();
    blocks.push(
      <p key={keyCounter++} className="text-[15px] leading-relaxed text-slate-200 my-2 first:mt-0 last:mb-0">
        {renderInline(line, onCitationClick)}
      </p>
    );
  }

  flushList();

  return <div className="max-w-[72ch]">{blocks}</div>;
};
