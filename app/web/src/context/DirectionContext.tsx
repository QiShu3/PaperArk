import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

const STORAGE_KEY = 'papers-direction';
export const GLOBAL_DIRECTION = 'global';

interface DirectionContextValue {
  direction: string;
  setDirection: (d: string) => void;
}

const DirectionContext = createContext<DirectionContextValue | null>(null);

export function DirectionProvider({ children }: { children: ReactNode }) {
  const [direction, setDirectionState] = useState<string>(GLOBAL_DIRECTION);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) setDirectionState(saved);
    } catch {
      // localStorage unavailable
    }
  }, []);

  const setDirection = (d: string) => {
    setDirectionState(d);
    try {
      localStorage.setItem(STORAGE_KEY, d);
    } catch {
      // localStorage unavailable
    }
  };

  const value = useMemo(() => ({ direction, setDirection }), [direction]);
  return <DirectionContext.Provider value={value}>{children}</DirectionContext.Provider>;
}

export function useDirection(): DirectionContextValue {
  const ctx = useContext(DirectionContext);
  if (!ctx) throw new Error('useDirection must be used within DirectionProvider');
  return ctx;
}
