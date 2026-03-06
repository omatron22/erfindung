"use client";

import { useEffect, useState } from "react";
import { HelmetPixel, RoadPixel, DiceFacePixel, MonopolyPixel } from "@/app/components/icons/PixelIcons";

export interface Announcement {
  playerName: string;
  playerColor: string;
  type:
    | "largest-army"
    | "longest-road"
    | "doubles"
    | "sheep-nuke-rolled"
    | "sheep-nuke-destroyed"
    | "sheep-nuke-doubles"
    | "knight"
    | "monopoly";
  /** Extra text for detail lines (e.g. per-player nuke summaries) */
  detail?: string;
  /** Secondary info like dice total or resource name */
  extra?: string;
}

interface Props {
  announcement: Announcement | null;
  onDismiss: () => void;
}

function getAnnouncementConfig(announcement: Announcement) {
  switch (announcement.type) {
    case "largest-army":
      return {
        title: "LARGEST ARMY",
        bgColor: "bg-purple-900/90",
        borderColor: "border-purple-400",
        textColor: "text-purple-200",
        duration: 3000,
      };
    case "longest-road":
      return {
        title: "LONGEST ROAD",
        bgColor: "bg-amber-900/90",
        borderColor: "border-amber-400",
        textColor: "text-amber-200",
        duration: 3000,
      };
    case "doubles":
      return {
        title: "DOUBLES! ROLL AGAIN!",
        bgColor: "bg-cyan-900/90",
        borderColor: "border-cyan-400",
        textColor: "text-cyan-200",
        duration: 2000,
      };
    case "sheep-nuke-rolled":
      return {
        title: `SHEEP NUKE! ROLLED ${announcement.extra ?? ""}!`,
        bgColor: "bg-red-900/90",
        borderColor: "border-red-400",
        textColor: "text-red-200",
        duration: 2500,
      };
    case "sheep-nuke-destroyed":
      return {
        title: "SHEEP NUKE!",
        bgColor: "bg-red-900/90",
        borderColor: "border-orange-400",
        textColor: "text-orange-200",
        duration: 3500,
      };
    case "sheep-nuke-doubles":
      return {
        title: "FREE NUKE! DOUBLES!",
        bgColor: "bg-red-900/90",
        borderColor: "border-yellow-400",
        textColor: "text-yellow-200",
        duration: 2500,
      };
    case "knight":
      return {
        title: "KNIGHT PLAYED!",
        bgColor: "bg-purple-900/90",
        borderColor: "border-purple-400",
        textColor: "text-purple-200",
        duration: 2000,
      };
    case "monopoly":
      return {
        title: `MONOPOLY ON ${(announcement.extra ?? "").toUpperCase()}!`,
        bgColor: "bg-emerald-900/90",
        borderColor: "border-emerald-400",
        textColor: "text-emerald-200",
        duration: 2500,
      };
  }
}

function AnnouncementIcon({ announcement }: { announcement: Announcement }) {
  switch (announcement.type) {
    case "largest-army":
    case "knight":
      return <HelmetPixel size={40} color={announcement.playerColor} />;
    case "longest-road":
      return <RoadPixel size={40} color={announcement.playerColor} />;
    case "doubles":
      return (
        <div className="flex gap-2">
          <DiceFacePixel value={3} size={28} />
          <DiceFacePixel value={3} size={28} />
        </div>
      );
    case "sheep-nuke-rolled":
    case "sheep-nuke-destroyed":
    case "sheep-nuke-doubles":
      return <span className="font-pixel text-[32px] leading-none">*</span>;
    case "monopoly":
      return <MonopolyPixel size={40} color={announcement.playerColor} />;
  }
}

export default function AnnouncementOverlay({ announcement, onDismiss }: Props) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!announcement) { setVisible(false); return; }
    setVisible(true);
    const config = getAnnouncementConfig(announcement);
    const timer = setTimeout(() => {
      setVisible(false);
      setTimeout(onDismiss, 400);
    }, config.duration);
    return () => clearTimeout(timer);
  }, [announcement]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!announcement) return null;

  const config = getAnnouncementConfig(announcement);

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center pointer-events-none transition-opacity duration-400 ${
        visible ? "opacity-100" : "opacity-0"
      }`}
    >
      <div className={`${config.bgColor} border-4 ${config.borderColor} px-10 py-6 text-center max-w-md`} style={{ backdropFilter: "blur(4px)" }}>
        <div className="flex justify-center mb-3">
          <AnnouncementIcon announcement={announcement} />
        </div>
        <div className="font-pixel text-[10px] text-gray-400 mb-1">
          {announcement.playerName.toUpperCase()}
        </div>
        <div className={`font-pixel text-[16px] ${config.textColor}`}>
          {config.title}
        </div>
        {announcement.detail && (
          <div className="font-pixel text-[9px] text-gray-300 mt-2 leading-relaxed whitespace-pre-line">
            {announcement.detail}
          </div>
        )}
      </div>
    </div>
  );
}
