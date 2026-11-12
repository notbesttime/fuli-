import { apiGet, apiPost } from "@/services/api/request";

export const AUTH_TOKEN_KEY = "infinite-canvas-auth-token-v1";

export type UserRole = "guest" | "user" | "admin";

export type AuthUser = {
    id: string;
    username: string;
    email: string;
    displayName: string;
    avatarUrl: string;
    role: UserRole;
    group: string;
    preferredGroup?: string;
    credits: number;
    createdAt: string;
    updatedAt: string;
};

export type AuthSession = {
    token: string;
    user: AuthUser;
};

export type AuthPayload = {
    username: string;
    password: string;
    email?: string;
    code?: string;
};

export async function login(payload: AuthPayload) {
    return apiPost<AuthSession>("/api/auth/login", payload);
}

export async function register(payload: AuthPayload) {
    return apiPost<AuthSession>("/api/auth/register", payload);
}

export type EmailCodePayload = {
    email: string;
    purpose: "register" | "recover";
};

export async function requestEmailCode(payload: EmailCodePayload) {
    return apiPost<{ ok: boolean }>("/api/auth/email-code", payload);
}

export type ResetPasswordPayload = {
    email: string;
    code: string;
    newPassword: string;
};

export async function resetPassword(payload: ResetPasswordPayload) {
    return apiPost<{ ok: boolean }>("/api/auth/reset-password", payload);
}

export async function fetchCurrentUser(token?: string) {
    return apiGet<AuthUser>("/api/auth/me", undefined, token);
}
