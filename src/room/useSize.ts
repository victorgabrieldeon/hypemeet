import { useEffect, useRef, useState } from "react";

/** Tracks an element's content-box size. */
export function useSize<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry!.contentRect;
      setSize({ width, height });
    });
    observer.observe(ref.current!);
    return () => observer.disconnect();
  }, []);
  return [ref, size] as const;
}
