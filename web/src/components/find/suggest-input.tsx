"use client";
// A text box with a short list of suggestions under it, in the site's own
// menu style (the browser's <datalist> can't be styled). Suggestions match the
// part after the last comma; picking one hands the whole text back through
// `onPick`. At most six show, so the list never scrolls. The list sits in the
// top layer (popover), so a scrolling chip row can't clip it; it's placed
// under the nearest [data-suggest-anchor] (the visible box), else the input.
import { useEffect, useId, useRef, useState } from "react";

const MAX = 6;

type InputProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "list" | "role">;

export function SuggestInput({ value, onChange, onPick, options, onKeyDown, onBlur, ...input }: InputProps & {
  value: string;
  onChange: (v: string) => void;
  /** A suggestion was picked: the text with it in place of the part being typed. */
  onPick: (text: string) => void;
  options: readonly string[];
}) {
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const [active, setActive] = useState(-1);
  const [dismissed, setDismissed] = useState(false);
  const [focused, setFocused] = useState(false);

  const cut = value.lastIndexOf(",") + 1;
  const token = value.slice(cut).trim().toLowerCase();
  const matches = token
    ? [...options.filter((o) => o.toLowerCase().startsWith(token)), ...options.filter((o) => !o.toLowerCase().startsWith(token) && o.toLowerCase().includes(token))]
        .filter((o) => o.toLowerCase() !== token)
        .slice(0, MAX)
    : [];
  const open = focused && !dismissed && matches.length > 0 && !input.readOnly;

  // Show or hide the list, and keep it under the box while anything scrolls.
  useEffect(() => {
    const list = listRef.current;
    const el = inputRef.current;
    if (!list || !el) return;
    if (!open) {
      if (list.matches(":popover-open")) list.hidePopover();
      return;
    }
    const place = () => {
      const box = (el.closest("[data-suggest-anchor]") ?? el).getBoundingClientRect();
      list.style.top = `${box.bottom + 4}px`;
      list.style.left = `${box.left}px`;
      list.style.minWidth = `${box.width}px`;
    };
    place();
    if (!list.matches(":popover-open")) list.showPopover();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open]);

  const pick = (o: string) => {
    setActive(-1);
    onPick(`${value.slice(0, cut)}${cut ? " " : ""}${o}`);
  };

  return (
    <>
      <input
        {...input}
        ref={inputRef}
        value={value}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && active >= 0 ? `${listId}-${active}` : undefined}
        autoComplete="off"
        onChange={(e) => {
          onChange(e.target.value);
          setActive(-1);
          setDismissed(false);
        }}
        onFocus={() => setFocused(true)}
        onBlur={(e) => {
          setFocused(false);
          setActive(-1);
          onBlur?.(e);
        }}
        onKeyDown={(e) => {
          if (open && e.key === "ArrowDown") {
            e.preventDefault();
            setActive((a) => (a + 1) % matches.length);
          } else if (open && e.key === "ArrowUp") {
            e.preventDefault();
            setActive((a) => (a <= 0 ? matches.length - 1 : a - 1));
          } else if (open && e.key === "Enter" && active >= 0) {
            e.preventDefault();
            pick(matches[active]);
          } else if (open && e.key === "Escape") {
            e.preventDefault();
            setDismissed(true);
          }
          onKeyDown?.(e);
        }}
      />
      <ul ref={listRef} id={listId} role="listbox" popover="manual" className="suggest">
        {open &&
          matches.map((o, i) => (
            <li
              key={o}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              // Keep the focus in the box, so picking doesn't blur it first.
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setActive(i)}
              onClick={() => pick(o)}
              className="suggest-option"
            >
              {o}
            </li>
          ))}
      </ul>
    </>
  );
}
