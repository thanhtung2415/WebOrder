import { create } from "zustand";

const storageKey = "weborder.activeBranchId";

interface BranchState {
  activeBranchId: string | null;
  setActiveBranchId: (branchId: string | null) => void;
}

export const useBranchStore = create<BranchState>((set) => ({
  activeBranchId: window.localStorage.getItem(storageKey),
  setActiveBranchId: (branchId) => {
    if (branchId) {
      window.localStorage.setItem(storageKey, branchId);
    } else {
      window.localStorage.removeItem(storageKey);
    }
    set({ activeBranchId: branchId });
  }
}));
