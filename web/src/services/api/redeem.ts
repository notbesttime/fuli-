import type { AuthUser } from "@/services/api/auth";
import { apiGet, apiPost, compactApiParams } from "@/services/api/request";

export type RechargeTier = { amount: number; url: string };

export type RechargeSetting = {
    enabled: boolean;
    storeUrl: string;
    notice: string;
    contact: string;
    largeAmount: number;
    tiers: RechargeTier[];
};

export type RedeemCode = {
    id: string;
    code: string;
    amount: number;
    credits: number;
    status: "unused" | "used" | "void" | "expired";
    batch: string;
    usedBy: string;
    usedAt?: string | null;
    expiresAt?: string | null;
    remark: string;
    createdAt: string;
    userDisplayName: string;
};

export type RedeemCodeList = { items: RedeemCode[]; total: number };
export type RedeemRecord = Pick<RedeemCode, "id" | "code" | "amount" | "credits" | "usedAt" | "createdAt">;
export type RedeemRecordList = { items: RedeemRecord[]; total: number };
export type RedeemPageQuery = { page?: number; pageSize?: number };
export type AdminRedeemCodeQuery = RedeemPageQuery & { keyword?: string; type?: RedeemCode["status"] };
export type CreateRedeemCodesPayload = { amount: number; count: number; expiresAt?: string; remark: string };

export async function fetchAdminRedeemCodes(token: string, query: AdminRedeemCodeQuery = {}) {
    return apiGet<RedeemCodeList>("/api/admin/redeem-codes", compactApiParams(query), token);
}

export async function createAdminRedeemCodes(token: string, payload: CreateRedeemCodesPayload) {
    return apiPost<RedeemCodeList>("/api/admin/redeem-codes", payload, token);
}

export async function voidAdminRedeemCode(token: string, id: string) {
    return apiPost<boolean>(`/api/admin/redeem-codes/${encodeURIComponent(id)}/void`, {}, token);
}

export async function redeemCode(token: string, code: string) {
    return apiPost<{ user: AuthUser; credits: number; amount: number }>("/api/v1/redeem", { code: code.trim() }, token);
}

export async function fetchRedeemRecords(token: string, query: RedeemPageQuery = {}) {
    return apiGet<RedeemRecordList>("/api/v1/redeem-records", compactApiParams(query), token);
}
