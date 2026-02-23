import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';

const scrollPositions = new Map<string, number>();

/**
 * Saves scroll position when leaving and restores it when returning.
 * Uses the full URL (path + search) as the key so filtered views are restored correctly.
 */
export function useScrollRestoration() {
  const location = useLocation();
  const key = location.pathname + location.search;
  const restoredRef = useRef(false);

  // Save scroll position on every scroll
  useEffect(() => {
    const handleScroll = () => {
      scrollPositions.set(key, window.scrollY);
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', handleScroll);
    };
  }, [key]);

  // Restore scroll position on mount
  useEffect(() => {
    if (restoredRef.current) return;
    restoredRef.current = true;

    const saved = scrollPositions.get(key);
    if (saved != null && saved > 0) {
      // Wait for content to render before scrolling
      requestAnimationFrame(() => {
        window.scrollTo(0, saved);
      });
    }
  }, [key]);
}
