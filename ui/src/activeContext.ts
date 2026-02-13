import { createContext, useContext } from "react";

const ActiveContextCtx = createContext<string>("");

export const ActiveContextProvider = ActiveContextCtx.Provider;

export function useActiveContext(): string {
  return useContext(ActiveContextCtx);
}
