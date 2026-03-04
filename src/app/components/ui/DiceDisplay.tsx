"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import type { DiceRoll } from "@/shared/types/game";
interface Props {
  roll: DiceRoll | null;
  canRoll: boolean;
  onRoll: () => void;
  onAnimationStart?: () => void;
}

const PIP_POSITIONS: Record<number, [number, number][]> = {
  1: [[50, 50]],
  2: [[30, 30], [70, 70]],
  3: [[30, 30], [50, 50], [70, 70]],
  4: [[30, 30], [70, 30], [30, 70], [70, 70]],
  5: [[30, 30], [70, 30], [50, 50], [30, 70], [70, 70]],
  6: [[30, 25], [70, 25], [30, 50], [70, 50], [30, 75], [70, 75]],
};

const ROLL_ANIMATION_MS = 600;

function randomDie(): number {
  return Math.floor(Math.random() * 6) + 1;
}

function DieFace({ value, shaking }: { value: number; shaking?: boolean }) {
  const pips = PIP_POSITIONS[value] || [];
  return (
    <div
      className={`w-11 h-11 bg-[#fffff5] flex items-center justify-center pixel-border-sm ${shaking ? "dice-shaking" : ""}`}
    >
      <svg viewBox="0 0 100 100" className="w-8 h-8">
        {pips.map(([x, y], i) => (
          <rect key={i} x={x - 8} y={y - 8} width={16} height={16} fill="#1a1a2e" />
        ))}
      </svg>
    </div>
  );
}

export default function DiceDisplay({ roll, canRoll, onRoll, onAnimationStart }: Props) {
  const [isRolling, setIsRolling] = useState(false);
  const [rollingValues, setRollingValues] = useState<[number, number]>([1, 1]);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  const handleClick = useCallback(() => {
    if (!canRoll || isRolling) return;

    setIsRolling(true);
    onAnimationStart?.();

    // Cycle random values every 80ms
    intervalRef.current = setInterval(() => {
      setRollingValues([randomDie(), randomDie()]);
    }, 80);

    // Stop after animation and fire the actual roll
    timeoutRef.current = setTimeout(() => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      intervalRef.current = null;
      setIsRolling(false);
      onRoll();
    }, ROLL_ANIMATION_MS);
  }, [canRoll, isRolling, onRoll, onAnimationStart]);

  // Rolling animation state
  if (isRolling) {
    return (
      <div className="flex items-center gap-1.5 cursor-default">
        <DieFace value={rollingValues[0]} shaking />
        <DieFace value={rollingValues[1]} shaking />
      </div>
    );
  }

  // Show result
  if (roll) {
    return (
      <div className="flex items-center gap-1.5">
        <DieFace value={roll.die1} />
        <DieFace value={roll.die2} />
      </div>
    );
  }

  // Clickable dice — show static faces with throb animation
  return (
    <div
      onClick={handleClick}
      className={`flex items-center gap-1.5 ${
        canRoll
          ? "cursor-pointer dice-throb"
          : "cursor-not-allowed opacity-50"
      }`}
      title={canRoll ? "Click to roll!" : undefined}
    >
      <DieFace value={3} />
      <DieFace value={4} />
    </div>
  );
}
