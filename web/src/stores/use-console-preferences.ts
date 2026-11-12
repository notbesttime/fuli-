import { create } from "zustand";
import { persist } from "zustand/middleware";

export type ConsoleLocale = "zh-CN" | "en-US";

type ConsolePreferences = {
    locale: ConsoleLocale;
    setLocale: (locale: ConsoleLocale) => void;
};

export const useConsolePreferences = create<ConsolePreferences>()(
    persist(
        (set) => ({ locale: "zh-CN", setLocale: (locale) => set({ locale }) }),
        { name: "fulipaint:console-preferences-v1" },
    ),
);
