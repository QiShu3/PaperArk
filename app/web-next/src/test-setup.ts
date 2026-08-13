import '@testing-library/jest-dom/vitest';

if (typeof window !== 'undefined') {
  if (!window.matchMedia) {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: (query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      }),
    });
  }

  if (!window.ResizeObserver) {
    class ResizeObserverMock {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    (window as unknown as Record<string, unknown>).ResizeObserver = ResizeObserverMock;
  }

  if (typeof window.IntersectionObserver !== 'function') {
    class IntersectionObserverMock {
      root = null;
      rootMargin = '';
      thresholds = [];
      observe() {}
      unobserve() {}
      disconnect() {}
      takeRecords() {
        return [];
      }
    }
    (window as unknown as Record<string, unknown>).IntersectionObserver = IntersectionObserverMock;
  }

  const getComputedStyle = (elt: Element) => {
    const style = (elt as HTMLElement).style;
    return {
      ...style,
      getPropertyValue: (prop: string) => style.getPropertyValue(prop) || '',
      getPropertyPriority: () => '',
    } as CSSStyleDeclaration;
  };
  Object.defineProperty(window, 'getComputedStyle', {
    value: getComputedStyle,
  });

  if (typeof window.requestAnimationFrame !== 'function') {
    window.requestAnimationFrame = (cb: FrameRequestCallback) => setTimeout(cb, 0) as unknown as number;
  }
}
