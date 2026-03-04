"use client";

import { useState, useEffect, useRef } from "react";
import type { DiceRoll } from "@/shared/types/game";
import { playDiceRoll } from "@/app/utils/sounds";

interface Props {
  diceResult: DiceRoll;
  playerName: string;
  playerColor: string;
  onSequenceComplete: () => void;
  isFreeNuke?: boolean;
}

const PIP_POSITIONS: Record<number, [number, number][]> = {
  1: [[50, 50]],
  2: [[30, 30], [70, 70]],
  3: [[30, 30], [50, 50], [70, 70]],
  4: [[30, 30], [70, 30], [30, 70], [70, 70]],
  5: [[30, 30], [70, 30], [50, 50], [30, 70], [70, 70]],
  6: [[30, 25], [70, 25], [30, 50], [70, 50], [30, 75], [70, 75]],
};

function randomDie(): number {
  return Math.floor(Math.random() * 6) + 1;
}

function NukeDieFace({ value, shaking }: { value: number; shaking?: boolean }) {
  const pips = PIP_POSITIONS[value] || [];
  return (
    <div
      className={`w-20 h-20 bg-[#fffff5] flex items-center justify-center border-4 border-red-600 ${shaking ? "dice-shaking" : ""}`}
      style={{ boxShadow: "0 0 20px rgba(220, 38, 38, 0.6), 0 0 40px rgba(220, 38, 38, 0.3)" }}
    >
      <svg viewBox="0 0 100 100" className="w-14 h-14">
        {pips.map(([x, y], i) => (
          <rect key={i} x={x - 10} y={y - 10} width={20} height={20} fill="#1a1a2e" />
        ))}
      </svg>
    </div>
  );
}

type Phase = "countdown" | "rolling" | "result";

export default function NukeSequenceOverlay({
  diceResult,
  playerName,
  playerColor,
  onSequenceComplete,
  isFreeNuke,
}: Props) {
  const [phase, setPhase] = useState<Phase>("countdown");
  const [countdown, setCountdown] = useState(3);
  const [rollingValues, setRollingValues] = useState<[number, number]>([randomDie(), randomDie()]);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const completedRef = useRef(false);

  // Countdown phase: 3 → 2 → 1, then switch to rolling
  useEffect(() => {
    if (phase !== "countdown") return;

    if (countdown <= 0) {
      setPhase("rolling");
      return;
    }

    const timer = setTimeout(() => {
      setCountdown((c) => c - 1);
    }, 1000);

    return () => clearTimeout(timer);
  }, [phase, countdown]);

  // Rolling phase: cycle dice values, then show result
  useEffect(() => {
    if (phase !== "rolling") return;

    playDiceRoll();

    intervalRef.current = setInterval(() => {
      setRollingValues([randomDie(), randomDie()]);
    }, 80);

    const timer = setTimeout(() => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      setPhase("result");
    }, 1200);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      clearTimeout(timer);
    };
  }, [phase]);

  // Result phase: pause then complete
  useEffect(() => {
    if (phase !== "result") return;

    const timer = setTimeout(() => {
      if (!completedRef.current) {
        completedRef.current = true;
        onSequenceComplete();
      }
    }, 800);

    return () => clearTimeout(timer);
  }, [phase, onSequenceComplete]);

  // Cleanup
  useEffect(() => {
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80">
      {/* Countdown phase */}
      {phase === "countdown" && (
        <div className="flex flex-col items-center gap-6 animate-pulse">
          <div
            className="font-pixel text-[20px] md:text-[28px] text-center tracking-wider"
            style={{
              color: isFreeNuke ? "#facc15" : "#ef4444",
              textShadow: `0 0 20px ${isFreeNuke ? "rgba(250,204,21,0.6)" : "rgba(239,68,68,0.6)"}`,
            }}
          >
            {isFreeNuke ? "FREE NUKE — DOUBLES!" : "SHEEP NUKE INCOMING"}
          </div>
          <div
            className="font-pixel text-[10px]"
            style={{ color: playerColor }}
          >
            {playerName.toUpperCase()}
          </div>
          {countdown > 0 && (
            <div
              className="font-pixel text-[48px] md:text-[64px] text-red-500"
              style={{
                textShadow: "0 0 30px rgba(239, 68, 68, 0.8)",
                animation: "nuke-countdown-pop 1s ease-out",
              }}
              key={countdown}
            >
              {countdown}
            </div>
          )}
        </div>
      )}

      {/* Rolling phase */}
      {phase === "rolling" && (
        <div className="flex flex-col items-center gap-4">
          <div
            className="font-pixel text-[14px] text-red-500"
            style={{ textShadow: "0 0 15px rgba(239, 68, 68, 0.6)" }}
          >
            ROLLING...
          </div>
          <div className="flex items-center gap-4">
            <NukeDieFace value={rollingValues[0]} shaking />
            <NukeDieFace value={rollingValues[1]} shaking />
          </div>
        </div>
      )}

      {/* Result phase */}
      {phase === "result" && (
        <div className="flex flex-col items-center gap-4">
          <div className="flex items-center gap-4">
            <NukeDieFace value={diceResult.die1} />
            <NukeDieFace value={diceResult.die2} />
          </div>
          <div
            className="font-pixel text-[24px] text-white"
            style={{ textShadow: "0 0 10px rgba(255,255,255,0.5)" }}
          >
            {diceResult.total}
          </div>
          {diceResult.total === 7 && (
            <div
              className="font-pixel text-[14px] text-yellow-400 animate-pulse"
              style={{ textShadow: "0 0 15px rgba(250, 204, 21, 0.6)" }}
            >
              PICK A NUMBER!
            </div>
          )}
        </div>
      )}

      {/* CSS animation for countdown pop */}
      <style jsx>{`
        @keyframes nuke-countdown-pop {
          0% { transform: scale(2); opacity: 0; }
          30% { transform: scale(1); opacity: 1; }
          100% { transform: scale(1); opacity: 1; }
        }
      `}</style>
    </div>
  );
}
