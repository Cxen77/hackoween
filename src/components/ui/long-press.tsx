"use client";

import React, { useCallback, useEffect, useId, useRef, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { cn } from "@/lib/utils";

const CELL = { type: "spring", stiffness: 520, damping: 34, mass: 0.45 } as const;
const POP = { type: "spring", stiffness: 640, damping: 22, mass: 0.7 } as const;
const INSTANT = { duration: 0 } as const;

export type UseLongPressOptions = {
  onLongPress?: () => void;
  onClick?: () => void;
  duration?: number;
  steps?: number;
  moveTolerance?: number;
  haptic?: boolean;
  disabled?: boolean;
  onCancel?: () => void;
};

type Phase = "idle" | "holding" | "fired";

export function useLongPress({
  onLongPress,
  onClick,
  duration = 500,
  steps = 12,
  moveTolerance = 8,
  haptic = true,
  disabled = false,
  onCancel,
}: UseLongPressOptions) {
  const cells = Math.max(1, Math.round(steps));

  const [step, setStep] = useState(0);
  const [holding, setHolding] = useState(false);

  const phase = useRef<Phase>("idle");
  const raf = useRef(0);
  const startedAt = useRef(0);
  const origin = useRef<{ x: number; y: number } | null>(null);
  const settle = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fire = useRef(onLongPress);
  fire.current = onLongPress;
  const clickCb = useRef(onClick);
  clickCb.current = onClick;
  const cancelled = useRef(onCancel);
  cancelled.current = onCancel;

  const reset = useCallback(() => {
    cancelAnimationFrame(raf.current);
    raf.current = 0;
    if (settle.current) {
      clearTimeout(settle.current);
      settle.current = null;
    }
    origin.current = null;
    phase.current = "idle";
    setHolding(false);
    setStep(0);
  }, []);

  const end = useCallback(() => {
    if (phase.current !== "holding") return;
    reset();
    cancelled.current?.();
  }, [reset]);

  const begin = useCallback(
    (point?: { x: number; y: number }) => {
      if (disabled || phase.current !== "idle") return;

      phase.current = "holding";
      origin.current = point ?? null;
      startedAt.current = performance.now();
      setHolding(true);
      setStep(0);

      const tick = (now: number) => {
        const p = Math.min(1, (now - startedAt.current) / duration);

        const s = Math.floor(p * cells);
        setStep((prev) => (prev === s ? prev : s));

        if (p < 1) {
          raf.current = requestAnimationFrame(tick);
          return;
        }

        raf.current = 0;
        phase.current = "fired";
        setStep(cells);
        if (haptic && typeof navigator !== "undefined") {
          try {
            navigator.vibrate?.(12);
          } catch {}
        }
        fire.current?.();

        settle.current = setTimeout(() => {
          if (phase.current === "fired") reset();
        }, 260);
      };

      raf.current = requestAnimationFrame(tick);
    },
    [disabled, duration, cells, haptic, reset]
  );

  useEffect(() => {
    const bail = () => end();
    const onVisibility = () => document.hidden && end();
    window.addEventListener("blur", bail);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("blur", bail);
      document.removeEventListener("visibilitychange", onVisibility);
      cancelAnimationFrame(raf.current);
      if (settle.current) clearTimeout(settle.current);
    };
  }, [end]);

  const bind = {
    onPointerDown: (e: React.PointerEvent) => {
      if (e.button !== 0 && e.pointerType === "mouse") return;
      try {
        e.currentTarget.setPointerCapture?.(e.pointerId);
      } catch {}
      begin({ x: e.clientX, y: e.clientY });
    },
    onPointerMove: (e: React.PointerEvent) => {
      const from = origin.current;
      if (phase.current !== "holding" || !from) return;
      if (Math.hypot(e.clientX - from.x, e.clientY - from.y) > moveTolerance) {
        end();
      }
    },
    onPointerUp: end,
    onPointerCancel: end,
    onPointerLeave: end,
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.repeat) return;
      if (e.key === " " || e.key === "Enter") {
        e.preventDefault();
        begin();
      }
    },
    onKeyUp: (e: React.KeyboardEvent) => {
      if (e.key === " " || e.key === "Enter") end();
      if (e.key === "Escape") end();
    },
    onBlur: end,
    onClick: (e: React.MouseEvent) => {
      if (phase.current === "fired") {
        e.preventDefault();
        e.stopPropagation();
      } else {
        clickCb.current?.();
      }
    },
    onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
  };

  return {
    bind,
    step,
    steps: cells,
    holding,
    fired: step === cells,
    progress: step / cells,
  };
}

export type LongPressButtonProps = {
  onLongPress?: () => void;
  onClick?: () => void;
  children: React.ReactNode;
  duration?: number;
  steps?: number;
  disabled?: boolean;
  active?: boolean;
  className?: string;
  fillColor?: string;
};

export function LongPressButton({
  onLongPress,
  onClick,
  children,
  duration = 500,
  steps = 12,
  disabled = false,
  active = false,
  className = "",
  fillColor = "#0284c7",
}: LongPressButtonProps) {
  const hintId = useId();
  const reduced = useReducedMotion() === true;
  const { bind, step, steps: cells, holding, fired } = useLongPress({
    onLongPress: onLongPress || onClick,
    onClick,
    duration,
    steps,
    disabled,
  });

  const progress = fired ? 1 : step / cells;

  return (
    <motion.button
      type="button"
      aria-disabled={disabled}
      aria-describedby={hintId}
      initial={false}
      animate={{ scale: !reduced && fired ? 1.025 : 1 }}
      transition={reduced ? INSTANT : POP}
      className={cn(
        "long-press-button",
        holding && "holding",
        fired && "fired",
        active && "active-playing",
        disabled && "disabled",
        className
      )}
      style={{ touchAction: "manipulation", WebkitTouchCallout: "none" }}
      {...bind}
    >
      <span className="long-press-content-grid">
        {/* Base layer */}
        <span className="long-press-base-layer">
          {children}
        </span>

        {/* Animated fill overlay */}
        <motion.span
          aria-hidden
          initial={false}
          animate={{
            clipPath: `inset(0 ${((1 - progress) * 100).toFixed(2)}% 0 0)`,
          }}
          transition={reduced ? INSTANT : CELL}
          className="long-press-fill-layer"
          style={{ color: fillColor }}
        >
          {children}
        </motion.span>
      </span>

      <span id={hintId} className="sr-only">
        Press and hold or click to animate scenario
      </span>
    </motion.button>
  );
}
