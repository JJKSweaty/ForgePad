import { useEffect, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { ArrowUpRight, Search, X } from "lucide-react";
import type { Question } from "./api";
import type { Page } from "./App";
export function CommandPalette({
  open,
  onOpenChange,
  questions,
  onPractice,
  onNavigate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  questions: Question[];
  onPractice: (id: string) => void;
  onNavigate: (page: Page) => void;
}) {
  const [query, setQuery] = useState(""),
    [index, setIndex] = useState(0);
  useEffect(() => {
    if (open) {
      setQuery("");
      setIndex(0);
    }
  }, [open]);
  const pages: { id: Page; title: string }[] = [
    { id: "dashboard", title: "Dashboard" },
    { id: "roadmaps", title: "Roadmaps" },
    { id: "questions", title: "Question Library" },
    { id: "interview", title: "Mock Interview" },
    { id: "progress", title: "Progress" },
    { id: "settings", title: "Settings" },
  ];
  const items = [
    ...pages
      .filter(
        (p) => !query || p.title.toLowerCase().includes(query.toLowerCase()),
      )
      .map((p) => ({
        id: p.id,
        title: p.title,
        detail: "Go to",
        action: () => onNavigate(p.id),
      })),
    ...questions
      .filter(
        (q) =>
          !q.archived &&
          (!query ||
            `${q.title} ${q.topics.join(" ")}`
              .toLowerCase()
              .includes(query.toLowerCase())),
      )
      .slice(0, 10)
      .map((q) => ({
        id: q.id,
        title: q.title,
        detail: q.topics.slice(0, 2).join(" · "),
        action: () => onPractice(q.id),
      })),
  ];
  function choose(i: number) {
    const item = items[i];
    if (item) {
      onOpenChange(false);
      item.action();
    }
  }
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content
          className="command-dialog"
          aria-describedby="command-description"
        >
          <Dialog.Title className="sr-only">Search ForgePad</Dialog.Title>
          <Dialog.Description className="sr-only" id="command-description">
            Search questions and workspace pages. Use arrow keys to choose and
            Enter to open.
          </Dialog.Description>
          <div className="command-input">
            <Search size={18} />
            <input
              autoFocus
              aria-label="Search questions and pages"
              role="combobox"
              aria-expanded={true}
              aria-controls="command-results"
              aria-activedescendant={
                items[index] ? `command-${items[index].id}` : undefined
              }
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setIndex(0);
              }}
              placeholder="Search questions or go to…"
              onKeyDown={(e) => {
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setIndex((i) => Math.min(i + 1, items.length - 1));
                }
                if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setIndex((i) => Math.max(0, i - 1));
                }
                if (e.key === "Enter") {
                  e.preventDefault();
                  choose(index);
                }
              }}
            />
            <Dialog.Close className="icon-button" aria-label="Close search">
              <X size={16} />
            </Dialog.Close>
          </div>
          <div
            className="command-results"
            id="command-results"
            role="listbox"
            aria-label="Search results"
          >
            {items.map((item, i) => (
              <button
                role="option"
                aria-selected={index === i}
                id={`command-${item.id}`}
                key={item.id}
                onPointerEnter={() => setIndex(i)}
                onClick={() => choose(i)}
              >
                <span>
                  <strong>{item.title}</strong>
                  <small>{item.detail}</small>
                </span>
                <ArrowUpRight size={15} />
              </button>
            ))}
            {!items.length && <p>No matching questions or pages.</p>}
          </div>
          <div className="command-footer">
            <span>↑ ↓ navigate</span>
            <span>↵ open</span>
            <span>esc close</span>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
