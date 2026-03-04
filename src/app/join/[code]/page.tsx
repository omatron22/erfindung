"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { useSocket } from "@/app/hooks/useSocket";
import { useMultiplayerStore } from "@/app/stores/multiplayerStore";
import { loadPreferences } from "@/app/utils/preferences";
import SettingsDropdown from "@/app/components/ui/SettingsDropdown";

export default function JoinPage() {
  const params = useParams();
  const router = useRouter();
  const code = (params.code as string)?.toUpperCase();
  const { socket, connected } = useSocket();
  const { roomCode, setRoomJoined, setError, error } = useMultiplayerStore();
  const [name, setName] = useState(() => loadPreferences()?.name ?? "");
  const [joining, setJoining] = useState(false);

  // Listen for join response
  useEffect(() => {
    if (!socket) return;

    const onJoined = ({
      roomCode,
      playerIndex,
      reconnectToken,
    }: {
      roomCode: string;
      playerIndex: number;
      reconnectToken: string;
    }) => {
      setRoomJoined(roomCode, playerIndex, reconnectToken);
      router.push("/game/online");
    };

    const onError = ({ message }: { message: string }) => {
      setError(message);
      setJoining(false);
    };

    socket.on("room:joined", onJoined);
    socket.on("game:error", onError);

    return () => {
      socket.off("room:joined", onJoined);
      socket.off("game:error", onError);
    };
  }, [socket, router, setRoomJoined, setError]);

  // If already in a room, redirect
  useEffect(() => {
    if (roomCode) router.push("/game/online");
  }, [roomCode, router]);

  function handleJoin() {
    if (!socket || !connected || !name.trim()) return;

    // Check for reconnect token
    let reconnectToken: string | undefined;
    try {
      reconnectToken = localStorage.getItem(`catan-reconnect-${code}`) ?? undefined;
    } catch {}

    setJoining(true);
    socket.emit("room:join", {
      roomCode: code,
      playerName: name.trim(),
      reconnectToken,
    });
  }

  return (
    <main className="min-h-safe-screen flex items-center justify-center bg-[#2a6ab5] px-4 relative">
      <SettingsDropdown className="absolute top-4 right-4 z-20" />
      <div className="bg-[#f0e6d0] pixel-border p-6 md:p-8 w-full max-w-80 text-center relative">
        <button
          onClick={() => router.push("/")}
          className="absolute top-2 left-2 font-pixel text-[8px] text-gray-500 hover:text-gray-800"
          title="Back to menu"
        >
          &larr; BACK
        </button>
        <h1
          className="font-pixel text-[20px] text-amber-400 mb-2"
          style={{ textShadow: "2px 2px 0 #000" }}
        >
          ERFINDUNG
        </h1>
        <p className="font-pixel text-[8px] text-gray-600 mb-6">
          JOIN ROOM <span className="text-amber-600 text-[12px]">{code}</span>
        </p>

        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleJoin()}
          placeholder="Your name..."
          maxLength={20}
          className="w-full bg-white px-3 py-2 text-[11px] text-gray-800 border-2 border-black focus:outline-none mb-4"
          autoFocus
        />

        {error && (
          <p className="font-pixel text-[7px] text-red-600 mb-3">{error}</p>
        )}

        {!connected && (
          <p className="font-pixel text-[7px] text-gray-500 mb-3">
            Connecting to server...
          </p>
        )}

        <button
          onClick={handleJoin}
          disabled={!connected || !name.trim() || joining}
          className="w-full py-3 bg-amber-400 text-gray-900 font-pixel text-[11px] pixel-btn disabled:opacity-50"
        >
          {joining ? "JOINING..." : "JOIN GAME"}
        </button>
      </div>
    </main>
  );
}
