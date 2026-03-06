"use client";

import { useState } from "react";
import type { Resource } from "@/shared/types/game";
import type { GameAction } from "@/shared/types/actions";
import { ALL_RESOURCES, RESOURCE_COLORS } from "@/shared/constants";
import { ResourceIcon } from "@/app/components/icons/ResourceIcons";

interface MonopolyProps {
  type: "monopoly";
  playerIndex: number;
  onAction: (action: GameAction) => void;
  onClose: () => void;
}

interface YearOfPlentyProps {
  type: "year-of-plenty";
  playerIndex: number;
  onAction: (action: GameAction) => void;
  onClose: () => void;
}

type Props = MonopolyProps | YearOfPlentyProps;

export default function ResourceSelector(props: Props) {
  const [selected, setSelected] = useState<Resource[]>([]);

  const isMonopoly = props.type === "monopoly";

  function handleSelect(res: Resource) {
    if (isMonopoly) {
      props.onAction({
        type: "play-monopoly",
        playerIndex: props.playerIndex,
        resource: res,
      });
      props.onClose();
      return;
    }

    // Year of Plenty: toggle selection
    const idx = selected.indexOf(res);
    if (idx !== -1) {
      // Unselect: remove this occurrence
      const copy = [...selected];
      copy.splice(idx, 1);
      setSelected(copy);
    } else if (selected.length < 2) {
      setSelected([...selected, res]);
    }
  }

  function handleConfirm() {
    if (selected.length === 2) {
      props.onAction({
        type: "play-year-of-plenty",
        playerIndex: props.playerIndex,
        resource1: selected[0],
        resource2: selected[1],
      });
      props.onClose();
    }
  }

  function isSelected(res: Resource) {
    return selected.includes(res);
  }

  function selectionCount(res: Resource) {
    return selected.filter((r) => r === res).length;
  }

  const title = isMonopoly ? "MONOPOLY" : "YEAR OF PLENTY";
  const subtitle = isMonopoly
    ? "Choose a resource to steal"
    : "Pick 2 resources from the bank";

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-[#f0e6d0] pixel-border p-8 max-w-md w-full mx-4">
        {/* Header */}
        <div className="flex items-center justify-between mb-2">
          <h2 className="font-pixel text-[12px] text-gray-800">{title}</h2>
          <button
            onClick={props.onClose}
            className="font-pixel text-[10px] text-gray-600 hover:text-gray-900 pixel-btn bg-[#e8d8b8] px-2 py-1"
          >
            X
          </button>
        </div>

        {/* Instruction */}
        <p className="font-pixel text-[8px] text-gray-500 mb-5 text-center">{subtitle}</p>

        {/* Resource buttons */}
        <div className="flex gap-4 justify-center mb-5">
          {ALL_RESOURCES.map((res) => {
            const count = selectionCount(res);
            const active = count > 0;
            return (
              <button
                key={res}
                onClick={() => handleSelect(res)}
                className={`flex flex-col items-center gap-2 px-4 py-3 border-2 pixel-btn transition-all ${
                  active
                    ? "bg-green-200 border-green-600 shadow-[0_0_8px_rgba(34,197,94,0.6)]"
                    : "bg-[#e8d8b8] border-black hover:bg-amber-200"
                }`}
              >
                <div
                  className="w-12 h-12 flex items-center justify-center border-2 border-black"
                  style={{ backgroundColor: RESOURCE_COLORS[res] }}
                >
                  <ResourceIcon resource={res} size={28} />
                </div>
                <span className="font-pixel text-[7px] capitalize text-gray-700">{res}</span>
                {!isMonopoly && count > 0 && (
                  <span className="font-pixel text-[6px] text-green-700">x{count}</span>
                )}
              </button>
            );
          })}
        </div>

        {/* Year of Plenty: selected display + confirm */}
        {!isMonopoly && (
          <div className="flex flex-col items-center gap-3">
            {/* Selected resources display */}
            <div className="flex items-center gap-3 min-h-[32px]">
              <span className="font-pixel text-[8px] text-gray-500">SELECTED:</span>
              {selected.length === 0 && (
                <span className="font-pixel text-[7px] text-gray-400">None</span>
              )}
              {selected.map((r, i) => (
                <div key={i} className="flex items-center gap-1">
                  <div
                    className="w-7 h-7 flex items-center justify-center border-2 border-green-600"
                    style={{ backgroundColor: RESOURCE_COLORS[r] }}
                  >
                    <ResourceIcon resource={r} size={16} />
                  </div>
                  <span className="font-pixel text-[7px] capitalize text-gray-600">{r}</span>
                </div>
              ))}
            </div>

            {/* Confirm button */}
            <button
              onClick={handleConfirm}
              disabled={selected.length !== 2}
              className={`font-pixel text-[10px] px-6 py-2 pixel-btn border-2 transition-all ${
                selected.length === 2
                  ? "bg-green-500 border-green-700 text-white hover:bg-green-600 shadow-[0_0_6px_rgba(34,197,94,0.5)]"
                  : "bg-gray-300 border-gray-400 text-gray-500 cursor-not-allowed"
              }`}
            >
              CONFIRM
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
