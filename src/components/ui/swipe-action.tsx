"use client";

import {
  useRef,
  useCallback,
  useState,
  useEffect,
  type ReactNode,
  type TouchEvent,
} from "react";
import { cn } from "@/lib/utils";

const SWIPE_THRESHOLD = 30;
const AXIS_LOCK_PX = 8;
const AW = 80;

type GestureAxis = "undecided" | "horizontal" | "vertical";

interface SwipeActionProps {
  children: ReactNode;
  onSwipeLeft?: () => void;
  onSwipeRight?: () => void;
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
  leftLabel?: string;
  rightLabel?: string;
  className?: string;
}

export function SwipeAction({
  children,
  onSwipeLeft,
  onSwipeRight,
  leftIcon,
  rightIcon,
  leftLabel,
  rightLabel,
  className,
}: SwipeActionProps) {
  const startXRef = useRef(0);
  const startYRef = useRef(0);
  const currentXRef = useRef(0);
  const axisRef = useRef<GestureAxis>("undecided");
  const isDraggingRef = useRef(false);
  const [translateX, setTranslateX] = useState(0);
  const [isAnimating, setIsAnimating] = useState(false);

  const canSwipeLeft = Boolean(onSwipeLeft && rightIcon);
  const canSwipeRight = Boolean(onSwipeRight && leftIcon);

  const handleTouchStart = useCallback(
    (e: TouchEvent<HTMLLIElement>) => {
      if (!canSwipeLeft && !canSwipeRight) return;
      const touch = e.touches[0];
      if (!touch) return;
      startXRef.current = touch.clientX;
      startYRef.current = touch.clientY;
      currentXRef.current = 0;
      axisRef.current = "undecided";
      isDraggingRef.current = true;
      setIsAnimating(false);
    },
    [canSwipeLeft, canSwipeRight],
  );

  const handleTouchMove = useCallback(
    (e: TouchEvent<HTMLLIElement>) => {
      if (!isDraggingRef.current || axisRef.current === "vertical") return;
      const touch = e.touches[0];
      if (!touch) return;

      const deltaX = touch.clientX - startXRef.current;
      const deltaY = touch.clientY - startYRef.current;

      if (axisRef.current === "undecided") {
        if (Math.max(Math.abs(deltaX), Math.abs(deltaY)) < AXIS_LOCK_PX) return;
        if (Math.abs(deltaY) > Math.abs(deltaX)) {
          axisRef.current = "vertical";
          isDraggingRef.current = false;
          return;
        }
        axisRef.current = "horizontal";
      }

      let clampedDelta = deltaX;
      if (deltaX > 0 && !canSwipeRight) clampedDelta = 0;
      if (deltaX < 0 && !canSwipeLeft) clampedDelta = 0;

      clampedDelta = Math.max(-AW, Math.min(AW, clampedDelta));
      currentXRef.current = clampedDelta;
      setTranslateX(clampedDelta);
    },
    [canSwipeLeft, canSwipeRight],
  );

  const reset = useCallback(() => {
    isDraggingRef.current = false;
    axisRef.current = "undecided";
    setIsAnimating(true);

    const delta = currentXRef.current;

    if (delta < -SWIPE_THRESHOLD && canSwipeLeft) {
      setTranslateX(-AW);
      onSwipeLeft?.();
      setTimeout(() => setTranslateX(0), 200);
    } else if (delta > SWIPE_THRESHOLD && canSwipeRight) {
      setTranslateX(AW);
      onSwipeRight?.();
      setTimeout(() => setTranslateX(0), 200);
    } else {
      setTranslateX(0);
    }
  }, [canSwipeLeft, canSwipeRight, onSwipeLeft, onSwipeRight]);

  const handleTouchEnd = useCallback(() => {
    if (!isDraggingRef.current || axisRef.current !== "horizontal") {
      isDraggingRef.current = false;
      axisRef.current = "undecided";
      return;
    }
    reset();
  }, [reset]);

  const handleTouchCancel = useCallback(() => {
    isDraggingRef.current = false;
    axisRef.current = "undecided";
    setIsAnimating(true);
    setTranslateX(0);
  }, []);

  useEffect(() => {
    if (isAnimating) {
      const timer = setTimeout(() => setIsAnimating(false), 200);
      return () => clearTimeout(timer);
    }
  }, [isAnimating]);

  const showLeft = translateX > 0 && canSwipeRight;
  const showRight = translateX < 0 && canSwipeLeft;

  return (
    <li
      className={cn(
        "overflow-hidden touch-pan-y",
        showLeft && "bg-emerald-600",
        showRight && "bg-destructive",
        className,
      )}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={handleTouchCancel}
    >
      <div
        className={cn(
          "flex",
          isAnimating && "transition-transform duration-200 ease-out",
        )}
        style={{ transform: `translateX(${translateX}px)` }}
      >
        {showLeft && (
          <span
            className="flex shrink-0 items-center justify-start text-white"
            style={{ width: AW }}
            aria-hidden="true"
          >
            <span className="flex items-center gap-1">
              {leftIcon}
              {leftLabel && (
                <span className="text-xs font-medium">{leftLabel}</span>
              )}
            </span>
          </span>
        )}

        <div
          className="bg-card text-card-foreground shrink-0"
          style={{
            width:
              showLeft || showRight
                ? `calc(100% - ${AW}px + ${Math.abs(translateX)}px)`
                : "100%",
          }}
        >
          {children}
        </div>

        {showRight && (
          <span
            className="flex shrink-0 items-center justify-end text-white"
            style={{ width: AW }}
            aria-hidden="true"
          >
            <span className="flex items-center gap-1">
              {rightLabel && (
                <span className="text-xs font-medium">{rightLabel}</span>
              )}
              {rightIcon}
            </span>
          </span>
        )}
      </div>
    </li>
  );
}
