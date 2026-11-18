import type { ReactNode } from "react";
import { command, native } from "./bridge";
export function MessageText({
  text,
  onError,
}: {
  text: string;
  onError: (error: unknown) => void;
}) {
  const links = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s<>]+)/g;
  const parts: ReactNode[] = [];
  let cursor = 0;
  let match: RegExpExecArray | null;
  while ((match = links.exec(text)) !== null) {
    parts.push(text.slice(cursor, match.index));
    const url = match[2] ?? match[3];
    parts.push(
      <a
        key={match.index}
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(event) => {
          if (native) {
            event.preventDefault();
            void command("open_source", { url }).catch(onError);
          }
        }}
      >
        {match[1] ?? url}
      </a>,
    );
    cursor = links.lastIndex;
  }
  parts.push(text.slice(cursor));
  return <>{parts}</>;
}
