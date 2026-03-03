import { useState } from "react";
import type { Resource } from "@/shared/types/game";

interface BankTradeInfo {
  valid: boolean;
  giving: Resource;
  ratio: number;
  receivingCount: number;
}

/**
 * Manages trade UI state: offering, requesting, trade mode, shake animations.
 */
export function useTradeUI(
  myPlayerIndex: number,
  playerResources: Record<Resource, number> | null,
  portsAccess: Array<Resource | "any"> | null,
) {
  const [tradeMode, setTradeMode] = useState(false);
  const [offering, setOffering] = useState<Resource[]>([]);
  const [requesting, setRequesting] = useState<Resource[]>([]);
  const [shakenResource, setShakenResource] = useState<Resource | null>(null);

  function getTradeRatio(resource: Resource): number {
    if (!portsAccess) return 4;
    if (portsAccess.includes(resource)) return 2;
    if (portsAccess.includes("any")) return 3;
    return 4;
  }

  function getBankTradeInfo(): BankTradeInfo | null {
    if (offering.length === 0) return null;
    const res = offering[0];
    if (!offering.every((r) => r === res)) return null;
    const ratio = getTradeRatio(res);
    if (offering.length >= ratio && offering.length % ratio === 0) {
      return { valid: true, giving: res, ratio, receivingCount: offering.length / ratio };
    }
    return null;
  }

  function addToOffering(resource: Resource) {
    if (!playerResources) return;
    const offeringCounts: Record<Resource, number> = { brick: 0, lumber: 0, ore: 0, grain: 0, wool: 0 };
    for (const r of offering) offeringCounts[r]++;
    if (offeringCounts[resource] >= playerResources[resource]) return;
    if (!tradeMode) setTradeMode(true);
    setOffering([...offering, resource]);
  }

  function removeFromOffering(index: number) {
    setOffering(offering.filter((_, i) => i !== index));
  }

  function addToRequesting(resource: Resource) {
    setRequesting([...requesting, resource]);
  }

  function removeFromRequesting(index: number) {
    setRequesting(requesting.filter((_, i) => i !== index));
  }

  function closeTrade() {
    setTradeMode(false);
    setOffering([]);
    setRequesting([]);
  }

  return {
    tradeMode,
    setTradeMode,
    offering,
    requesting,
    shakenResource,
    setShakenResource,
    getTradeRatio,
    getBankTradeInfo,
    addToOffering,
    removeFromOffering,
    addToRequesting,
    removeFromRequesting,
    closeTrade,
  };
}
