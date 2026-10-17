import { useEffect, useState } from "react";
import type { RefObject } from "react";

export function useElementSize(
  ref: RefObject<HTMLElement | null>,
  ready: boolean,
) {
  const [size, setSize] = useState({ width: Infinity, height: Infinity });
  useEffect(() => {
    const element = ref.current;
    if (!ready || !element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => {
      setSize({
        width: entry.contentRect.width,
        height: entry.contentRect.height,
      });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref, ready]);
  return size;
}
