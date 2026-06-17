import { useCallback, useEffect, useState } from 'react';

function readOverflowState(element: HTMLElement) {
  const { scrollLeft, scrollWidth, clientWidth } = element;
  const maxScroll = Math.max(0, scrollWidth - clientWidth);
  return {
    overflowStart: scrollLeft > 2,
    overflowEnd: scrollLeft < maxScroll - 2,
    compact: scrollWidth > clientWidth + 1,
  };
}

export function useHorizontalScrollHints<T extends HTMLElement>() {
  const [node, setNode] = useState<T | null>(null);
  const [state, setState] = useState({ overflowStart: false, overflowEnd: false, compact: false });

  const ref = useCallback((element: T | null) => {
    setNode(element);
  }, []);

  useEffect(() => {
    if (!node) return;

    const update = () => setState(readOverflowState(node));
    update();

    const observer = typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(update)
      : null;
    observer?.observe(node);
    node.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);

    return () => {
      observer?.disconnect();
      node.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
    };
  }, [node]);

  const className = [
    state.overflowStart ? 'ds-scroll-hint-start' : '',
    state.overflowEnd ? 'ds-scroll-hint-end' : '',
    state.compact ? 'ds-scroll-compact' : '',
  ].filter(Boolean).join(' ');

  return { ref, className, ...state };
}