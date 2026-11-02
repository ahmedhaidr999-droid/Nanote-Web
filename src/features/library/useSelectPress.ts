'use client';
// Shared long-press-to-select pointer logic for library items (cards & rows).
// A 480 ms press-and-hold (with <10 px movement) enters multi-selection and
// selects the pressed item; the click that follows the long-press is
// suppressed so the notebook never opens. Context menus are prevented while
// the press is armed (Android fires them at ~500 ms).
import { useCallback, useRef } from 'react';

const HOLD_MS = 480;
const MOVE_TOL_PX = 10;

export interface SelectPressHandlers {
  onPointerDown: (e: React.PointerEvent) => void;
  onPointerMove: (e: React.PointerEvent) => void;
  onPointerUp: () => void;
  onPointerCancel: () => void;
  onPointerLeave: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
  /** true exactly once right after a long-press fired (consumes the flag) */
  consumeLongPress: () => boolean;
}

export function useSelectPress(onLongPress: () => void, enabled: boolean): SelectPressHandlers {
  const timerRef = useRef<number | null>(null);
  const startRef = useRef<{ x: number; y: number } | null>(null);
  const suppressClickRef = useRef(false);

  const clear = useCallback(() => {
    if (timerRef.current != null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    startRef.current = null;
  }, []);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (!enabled || e.button !== 0) return;
      startRef.current = { x: e.clientX, y: e.clientY };
      clear();
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null;
        suppressClickRef.current = true;
        // release the suppression shortly after — a stray late click only
        // lands within one tick of the press
        window.setTimeout(() => { suppressClickRef.current = false }, 450);
        onLongPress();
      }, HOLD_MS);
    },
    [enabled, clear, onLongPress],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!startRef.current) return;
      if (
        Math.abs(e.clientX - startRef.current.x) > MOVE_TOL_PX ||
        Math.abs(e.clientY - startRef.current.y) > MOVE_TOL_PX
      ) {
        clear();
      }
    },
    [clear],
  );

  const consumeLongPress = useCallback(() => {
    const v = suppressClickRef.current;
    suppressClickRef.current = false;
    return v;
  }, []);

  const onContextMenu = useCallback(
    (e: React.MouseEvent) => {
      // the hold must not pop the platform context menu mid-press
      if (enabled) e.preventDefault();
    },
    [enabled],
  );

  return {
    onPointerDown,
    onPointerMove,
    onPointerUp: clear,
    onPointerCancel: clear,
    onPointerLeave: clear,
    onContextMenu,
    consumeLongPress,
  };
}
