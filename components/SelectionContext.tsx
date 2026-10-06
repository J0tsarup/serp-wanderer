"use client";

import { createContext, useContext, useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from "react";

// Shares the keyword table's checkbox selection with the page header, so the
// "Refresh now" button can become "Refresh selected" and check just those.
type SelectionState = {
  selected: Set<string>;
  setSelected: Dispatch<SetStateAction<Set<string>>>;
  // The table registers its own "check selected" routine here (it owns the
  // per-row spinners and error display), and the header button calls it.
  checkSelectedRef: MutableRefObject<(() => Promise<void>) | null>;
};

const SelectionContext = createContext<SelectionState | null>(null);

export function SelectionProvider({ children }: { children: React.ReactNode }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const checkSelectedRef = useRef<(() => Promise<void>) | null>(null);
  return (
    <SelectionContext.Provider value={{ selected, setSelected, checkSelectedRef }}>{children}</SelectionContext.Provider>
  );
}

export function useSelection(): SelectionState {
  const ctx = useContext(SelectionContext);
  if (!ctx) throw new Error("useSelection must be used inside <SelectionProvider>");
  return ctx;
}
