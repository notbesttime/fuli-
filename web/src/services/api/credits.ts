import { apiGet, apiPut, compactApiParams } from "@/services/api/request";

export type BillingStrategy = "subscription_first" | "subscription_only" | "wallet_only";

export type CreditLog = {
    id: string;
    type: "redeem" | "admin_adjust" | "ai_consume" | "ai_refund" | string;
    amount: number;
    balance: number;
    relatedId: string;
    remark: string;
    extra: string;
    createdAt: string;
};

export type CreditLogList = {
    items: CreditLog[];
    total: number;
    summary: { totalSpent: number; billedRequests: number };
};

export type CreditOverview = {
    balance: number;
    todaySpent: number;
    todayCalls: number;
    totalSpent: number;
    totalCalls: number;
    dailySpending: { date: string; spent: number; calls: number }[];
    modelSpending: { model: string; spent: number; calls: number }[];
    recentCreditLogs: CreditLog[];
};

export type UserPreferences = { billingStrategy: BillingStrategy; preferredGroup: string };

export async function fetchCreditLogs(token: string, query: { page?: number; pageSize?: number; earnedOnly?: boolean } = {}) {
    return apiGet<CreditLogList>("/api/v1/credit-logs", compactApiParams({ page: query.page, pageSize: query.pageSize, earnedOnly: query.earnedOnly ? "true" : undefined }), token);
}

export async function fetchCreditOverview(token: string) {
    return apiGet<CreditOverview>("/api/v1/dashboard/overview", undefined, token);
}

export async function fetchUserPreferences(token: string) {
    return apiGet<UserPreferences>("/api/v1/user-preferences", undefined, token);
}

export async function saveUserPreferences(token: string, preferences: Partial<UserPreferences>) {
    return apiPut<UserPreferences>("/api/v1/user-preferences", preferences, token);
}
