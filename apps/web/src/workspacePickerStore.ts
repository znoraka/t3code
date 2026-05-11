import { create } from "zustand";

interface WorkspacePickerStore {
  open: boolean;
  setOpen: (open: boolean) => void;
  toggle: () => void;
}

export const useWorkspacePickerStore = create<WorkspacePickerStore>((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
  toggle: () => set((state) => ({ open: !state.open })),
}));
