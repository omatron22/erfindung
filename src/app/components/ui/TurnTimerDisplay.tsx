"use client";

import { useState, useEffect } from "react";

interface Props {
  deadline: number | null | undefined;
}

export default function TurnTimerDisplay({ deadline }: Props) {
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);

  useEffect(() => {
    if (!deadline) {
      setSecondsLeft(null);
      return;
    }

    function tick() {
      const remaining = Math.max(0, Math.ceil((deadline! - Date.now()) / 1000));
      setSecondsLeft(remaining);
    }

    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [deadline]);

  if (secondsLeft === null) return null;

  const color =
    secondsLeft <= 5 ? "text-red-400" :
    secondsLeft <= 15 ? "text-red-400" :
    secondsLeft <= 30 ? "text-yellow-400" :
    "text-green-400";

  const pulsing = secondsLeft <= 5 ? "animate-pulse" : "";

  return (
    <div className={`font-pixel text-[10px] ${color} ${pulsing} tabular-nums`}>
      {Math.floor(secondsLeft / 60)}:{String(secondsLeft % 60).padStart(2, "0")}
    </div>
  );
}
