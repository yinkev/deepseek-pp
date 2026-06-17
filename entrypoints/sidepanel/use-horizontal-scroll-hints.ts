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

type HorizontalScrollHintsOptions = {
  /** When true, adds ds-scroll-compact for icon-only top tabs at narrow widths. */
  compact?: boolean;
};

export function useHorizontalScrollHints<T extends HTMLElement>(options: HorizontalScrollHintsOptions = {}) {
  const enableCompact = options.compact !== false;
  const [node, setNode] = useState<T | null>(null);
  const [state, setState] = useState({ overflowStart: false, overflowEnd: false, compact: false });

  const ref = useCallback((element: T | null) => {
    setNode(element);
  }, []);

  useEffect(() => {
    if (!node) return;

    const update = () => setState(readOverflowState(node));
    update();

    const resizeObserver = typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(update)
      : null;
    resizeObserver?.observe(node);

    const mutationObserver = typeof MutationObserver !== 'undefined'
      ? new MutationObserver(update)
      : null;
    mutationObserver?.observe(node, {
      childList: true,
      subtree: true,
      characterData: true,
    });

    node.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);

    return () => {
      resizeObserver?.disconnect();
      mutationObserver?.disconnect();
      node.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
    };
  }, [node]);

  const className = [
    state.overflowStart ? 'ds-scroll-hint-start' : '',
    state.overflowEnd ? 'ds-scroll-hint-end' : '',
    enableCompact && state.compact ? 'ds-scroll-compact' : '',
  ].filter(Boolean).join(' ');

  return { ref, className, ...state };
}