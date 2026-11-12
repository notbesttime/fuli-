"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";

import { AUTH_TOKEN_KEY, fetchCurrentUser, login, register, type AuthPayload, type AuthUser } from "@/services/api/auth";
import { saveUserPreferences, type UserPreferences } from "@/services/api/credits";

type UserStore = {
    token: string;
    user: AuthUser | null;
    isReady: boolean;
    isLoading: boolean;
    isSavingPreferences: boolean;
    savePreferences: (preferences: Partial<UserPreferences>) => Promise<UserPreferences>;
    setSession: (token: string, user: AuthUser) => void;
    clearSession: () => void;
    hydrateUser: () => Promise<void>;
    login: (payload: AuthPayload) => Promise<AuthUser>;
    register: (payload: AuthPayload) => Promise<AuthUser>;
};

export const useUserStore = create<UserStore>()(
    persist(
        (set, get) => ({
            token: "",
            user: null,
            isReady: false,
            isLoading: false,
            isSavingPreferences: false,
            savePreferences: async (preferences) => {
                const { token, user, isSavingPreferences } = get();
                if (!token || !user) throw new Error("请先登录");
                if (isSavingPreferences) throw new Error("正在保存偏好，请稍后重试");
                set({ isSavingPreferences: true });
                try {
                    const saved = await saveUserPreferences(token, preferences);
                    if (get().token !== token || get().user?.id !== user.id) throw new Error("登录状态已变更，请重试");
                    set((current) => ({ user: current.user ? { ...current.user, preferredGroup: saved.preferredGroup } : null }));
                    return saved;
                } finally {
                    if (get().token === token) set({ isSavingPreferences: false });
                }
            },
            setSession: (token, user) => set({ token, user, isReady: true, isSavingPreferences: false }),
            clearSession: () => set({ token: "", user: null, isReady: true, isSavingPreferences: false }),
            hydrateUser: async () => {
                const token = get().token;
                if (!token) {
                    set({ user: null, isReady: true });
                    return;
                }
                set({ isLoading: true });
                try {
                    const user = await fetchCurrentUser(token);
                    if (user.role === "guest") {
                        set({ token: "", user: null, isReady: true, isLoading: false });
                        return;
                    }
                    set({ user, isReady: true, isLoading: false });
                } catch {
                    set({ token: "", user: null, isReady: true, isLoading: false });
                }
            },
            login: async (payload) => {
                set({ isLoading: true });
                try {
                    const session = await login(payload);
                    set({ token: session.token, user: session.user, isReady: true, isLoading: false });
                    return session.user;
                } catch (error) {
                    set({ isLoading: false });
                    throw error;
                }
            },
            register: async (payload) => {
                set({ isLoading: true });
                try {
                    const session = await register(payload);
                    set({ token: session.token, user: session.user, isReady: true, isLoading: false });
                    return session.user;
                } catch (error) {
                    set({ isLoading: false });
                    throw error;
                }
            },
        }),
        {
            name: AUTH_TOKEN_KEY,
            partialize: (state) => ({ token: state.token }),
            onRehydrateStorage: () => (state) => {
                if (state) state.isReady = false;
            },
        },
    ),
);
