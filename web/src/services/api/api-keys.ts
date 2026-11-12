import { apiDelete, apiGet, apiPost } from "@/services/api/request";

export type ApiKeySummary = {
    id: string;
    name: string;
    prefix: string;
    group: string;
    active: boolean;
    createdAt: string;
    lastUsedAt?: string;
};

export type ApiKeyListResponse = { items: ApiKeySummary[] };

export type CreatedApiKey = {
    id: string;
    name: string;
    secret: string;
    group: string;
    createdAt: string;
};

export async function fetchApiKeys(token: string) {
    return apiGet<ApiKeyListResponse>("/api/v1/api-keys", undefined, token);
}

export async function createApiKey(token: string, payload: { name: string; group: string }) {
    return apiPost<CreatedApiKey>("/api/v1/api-keys", payload, token);
}

export async function revokeApiKey(token: string, id: string) {
    return apiDelete<void>("/api/v1/api-keys/" + encodeURIComponent(id), token);
}
