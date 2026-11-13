import { createContext } from "react";
import type { DrawerTabActionId } from "../../keyboard/actions";

/** Identifies the native tab so panels only omit a heading duplicated by that tab. */
export const ResourceDrawerTabContext = createContext<DrawerTabActionId | null>(null);
