import type { RechargeSetting } from "@/services/api/redeem";
import type { ModelChannelProtocol } from "@/lib/model-channel";
import type { ModelCapabilities } from "@/stores/use-config-store";
import type { WorkflowEntry, WorkflowSummary } from "@/lib/workflow-channel";
import { apiDelete, apiGet, apiPost, compactApiParams } from "@/services/api/request";
import type { Prompt, PromptListResponse } from "@/services/api/prompts";
import type { AgentSkill, AgentSkillFile } from "@/services/api/agent-skills";

export type AdminPromptCategory = {
    category: string;
    name: string;
    description: string;
    file: string;
    githubUrl: string;
    remote: boolean;
};

export type AdminUser = {
    id: string;
    username: string;
    email: string;
    displayName: string;
    avatarUrl: string;
    role: "user" | "admin";
    group: string;
    credits: number;
    linuxDoId: string;
    status: "active" | "ban";
    lastLoginAt: string;
    createdAt: string;
    updatedAt: string;
};

export type AdminUserListResponse = {
    items: AdminUser[];
    total: number;
};

export type AdminCreditLog = {
    id: string;
    userId: string;
    userDisplayName: string;
    type: string;
    amount: number;
    balance: number;
    relatedId: string;
    remark: string;
    extra: string;
    createdAt: string;
};

export type AdminCreditLogListResponse = {
    items: AdminCreditLog[];
    total: number;
};

export type AdminUserQuery = {
    keyword?: string;
    role?: string;
    status?: string;
    group?: string;
    sortBy?: string;
    sortOrder?: string;
    page?: number;
    pageSize?: number;
};

export type AdminUserDetail = {
    user: AdminUser;
    summary: { totalSpent: number; billedRequests: number };
    apiKeyCount: number;
    activeApiKeyCount: number;
};

export async function fetchAdminUsers(token: string, query: AdminUserQuery = {}) {
    return apiGet<AdminUserListResponse>("/api/admin/users", compactApiParams(query), token);
}

export async function fetchAdminUserDetail(token: string, id: string) {
    return apiGet<AdminUserDetail>(`/api/admin/users/${encodeURIComponent(id)}`, undefined, token);
}

export async function updateAdminUserStatus(token: string, id: string, status: "active" | "ban") {
    return apiPost<AdminUser>(`/api/admin/users/${encodeURIComponent(id)}/status`, { status }, token);
}

export async function saveAdminUser(token: string, user: Partial<AdminUser> & { password?: string }) {
    return apiPost<AdminUser>("/api/admin/users", user, token);
}

export async function adjustAdminUserCredits(token: string, id: string, credits: number) {
    return apiPost<AdminUser>(`/api/admin/users/${encodeURIComponent(id)}/credits`, { credits }, token);
}

export async function deleteAdminUser(token: string, id: string) {
    return apiDelete<boolean>(`/api/admin/users/${encodeURIComponent(id)}`, token);
}

export type AdminAPIKey = {
    id: string;
    userId: string;
    username: string;
    userDisplayName: string;
    name: string;
    prefix: string;
    group: string;
    active: boolean;
    expiresAt: string;
    createdAt: string;
    lastUsedAt: string;
    expired: boolean;
};

export type AdminAPIKeyListResponse = {
    items: AdminAPIKey[];
    total: number;
};

export type AdminAPIKeyQuery = {
    keyword?: string;
    group?: string;
    status?: string;
    page?: number;
    pageSize?: number;
};

export async function fetchAdminAPIKeys(token: string, query: AdminAPIKeyQuery = {}) {
    return apiGet<AdminAPIKeyListResponse>("/api/admin/api-keys", compactApiParams(query), token);
}

export async function saveAdminAPIKey(token: string, id: string, input: { name?: string; group?: string; expiresAt?: string; active?: boolean }) {
    return apiPost<AdminAPIKey>(`/api/admin/api-keys/${encodeURIComponent(id)}`, input, token);
}

export async function updateAdminAPIKeyStatus(token: string, id: string, active: boolean) {
    return apiPost<AdminAPIKey>(`/api/admin/api-keys/${encodeURIComponent(id)}/status`, { active }, token);
}

export async function deleteAdminAPIKey(token: string, id: string) {
    return apiDelete<boolean>(`/api/admin/api-keys/${encodeURIComponent(id)}`, token);
}

export async function fetchAdminCreditLogs(token: string, query: AdminUserQuery & { date?: string } = {}) {
    return apiGet<AdminCreditLogListResponse>("/api/admin/credit-logs", compactApiParams(query), token);
}

export async function saveAdminCreditLog(token: string, log: Partial<AdminCreditLog>) {
    return apiPost<AdminCreditLog>("/api/admin/credit-logs", log, token);
}

export async function deleteAdminCreditLog(token: string, id: string) {
    return apiDelete<boolean>(`/api/admin/credit-logs/${encodeURIComponent(id)}`, token);
}

export async function fetchAdminPromptCategories(token: string) {
    return apiGet<AdminPromptCategory[]>("/api/admin/prompt-categories", undefined, token);
}

export async function syncAdminPromptCategory(token: string, category: string) {
    return apiPost<AdminPromptCategory[]>("/api/admin/prompt-categories/sync", { category }, token);
}

export async function syncAdminPromptCategoriesAll(token: string) {
    return apiPost<AdminPromptCategory[]>("/api/admin/prompt-categories/sync-all", {}, token);
}

export type AdminPromptQuery = {
    keyword?: string;
    category?: string;
    tag?: string[];
    page?: number;
    pageSize?: number;
};

export type AdminAsset = {
    id: string;
    title: string;
    type: "text" | "image" | "video" | "audio";
    coverUrl: string;
    tags: string[];
    category: string;
    description: string;
    content: string;
    url: string;
    createdAt: string;
    updatedAt: string;
};

export type AdminAssetListResponse = {
    items: AdminAsset[];
    tags: string[];
    total: number;
};

export async function fetchAdminPrompts(token: string, query: AdminPromptQuery = {}) {
    return apiGet<PromptListResponse>("/api/admin/prompts", compactApiParams(query), token);
}

export async function saveAdminPrompt(token: string, prompt: Partial<Prompt>) {
    return apiPost<Prompt>("/api/admin/prompts", prompt, token);
}

export async function deleteAdminPrompt(token: string, id: string) {
    return apiDelete<boolean>(`/api/admin/prompts/${encodeURIComponent(id)}`, token);
}

export async function deleteAdminPrompts(token: string, ids: string[]) {
    return apiPost<boolean>("/api/admin/prompts/batch-delete", { ids }, token);
}

export function fetchAdminAgentSkills(token: string) {
    return apiGet<AgentSkill[]>("/api/admin/agent-skills", undefined, token);
}

export function saveAdminAgentSkill(token: string, skill: Partial<AgentSkill>) {
    return apiPost<AgentSkill>("/api/admin/agent-skills", skill, token);
}

export function fetchAdminAgentSkillFiles(token: string, id: string) {
    return apiGet<AgentSkillFile[]>(`/api/admin/agent-skills/${encodeURIComponent(id)}/files`, undefined, token);
}

export function deleteAdminAgentSkill(token: string, id: string) {
    return apiDelete<boolean>(`/api/admin/agent-skills/${encodeURIComponent(id)}`, token);
}

export type AdminAssetQuery = {
    keyword?: string;
    type?: string;
    tag?: string[];
    page?: number;
    pageSize?: number;
};

export async function fetchAdminAssets(token: string, query: AdminAssetQuery = {}) {
    return apiGet<AdminAssetListResponse>("/api/admin/assets", compactApiParams(query), token);
}

export async function saveAdminAsset(token: string, asset: Partial<AdminAsset>) {
    return apiPost<AdminAsset>("/api/admin/assets", asset, token);
}

export async function deleteAdminAsset(token: string, id: string) {
    return apiDelete<boolean>(`/api/admin/assets/${encodeURIComponent(id)}`, token);
}

export type AdminModelChannel = {
    id: string;
    protocol: ModelChannelProtocol;
    name: string;
    baseUrl: string;
    apiKey: string;
    models: string[];
    groups?: string[];
    modelCapabilities?: ModelCapabilities;
    parameterTranslation?: string;
    weight: number;
    timeout: number;
    enabled: boolean;
    remark: string;
    uploadApiKey?: string;
    bridgeId?: string;
    comfyUrl?: string;
    workflowDir?: string;
    workflows?: WorkflowEntry[];
};

export type AdminPublicModelChannelSettings = {
    availableModels: string[];
    availableWorkflows: string[];
    modelCosts: AdminModelCost[];
    pricing: AdminPricingSetting;
    channels: AdminPublicModelChannelInfo[];
    defaultModel: string;
    defaultImageModel: string;
    defaultVideoModel: string;
    defaultTextModel: string;
    systemPrompt: string;
    systemPrompts: {
        image: string;
        video: string;
        text: string;
        workflow: string;
        workflowAgent: string;
    };
    allowCustomChannel: boolean;
    allowUserRemoteChannel: boolean;
};

export type AdminBillingMode = "image" | "second" | "request";

export type AdminModelCost = {
    model: string;
    resolution?: string;
    billingMode?: AdminBillingMode;
    price?: number;
    credits: number;
    vendor?: string;
    tags?: string[];
};

export type AdminModelGroup = {
    id: string;
    name: string;
    ratio: number;
    desc?: string;
};

export type AdminPricingSetting = {
    currency: string;
    creditRate: number;
    groups: AdminModelGroup[];
};

export type AdminPublicModelChannelInfo = {
	parameterTranslationModels?: string[];
    id: string;
    protocol: AdminModelChannel["protocol"];
    name: string;
    baseUrl: string;
    models: string[];
    groups?: string[];
    modelCapabilities?: ModelCapabilities;
    weight: number;
    timeout: number;
    enabled: boolean;
    remark: string;
    workflows?: WorkflowSummary[];
};

export type AdminAnnouncement = {
    id: string;
    title: string;
    content: string;
    type: "info" | "success" | "warning";
    publishDate: string;
    enabled: boolean;
    pinned: boolean;
};

export type AdminPublicSettings = {
    announcements?: AdminAnnouncement[];
    recharge: RechargeSetting;
    modelChannel: AdminPublicModelChannelSettings;
    auth: {
        allowRegister: boolean;
        emailVerification: boolean;
        linuxDo: {
            enabled: boolean;
        };
    };
    storage: {
        mode: string;
        allowUserProvider: boolean;
    };
    legal?: AdminLegalSetting;
};

export type AdminLegalDocument = {
    title: string;
    content: string;
    enabled: boolean;
    updatedAt?: string;
};

export type AdminLegalSetting = {
    terms: AdminLegalDocument;
    privacy: AdminLegalDocument;
    about: AdminLegalDocument;
};

export type AdminStorageProvider = {
    id: string;
    name: string;
    type: "s3" | "webdav";
    endpoint: string;
    allowPrivateNetwork?: boolean;
    region: string;
    bucket: string;
    bucketInHost: boolean;
    accessKeyId: string;
    secretAccessKey: string;
    publicBaseUrl: string;
    pathPrefix: string;
    username: string;
    password: string;
    weight: number;
    enabled: boolean;
    ownerUserId: string;
    capacityBytes: number;
    capacityCheckedAt: string;
    capacityExceeded: boolean;
};

export type AdminChannelHealthSetting = {
    retryTimes: number;
    deadCooldownMinutes: number;
    rateLimitCooldownSec: number;
    upstreamFailureLimit: number;
    upstreamCooldownMinutes: number;
    timeoutRetry: boolean;
};

export type AdminChannelHealthInfo = {
    id: string;
    status: string;
    reason: string;
    upstreamError: string;
    failures: number;
    circuitCount: number;
    cooldownUntil: string;
    lastFailedAt: string;
    updatedAt: string;
};

export type AdminPrivateSettings = {
    channels: AdminModelChannel[];
    channelHealth: AdminChannelHealthSetting;
    promptSync: {
        enabled: boolean;
        cron: string;
    };
    aiLog: {
        localDirectReportEnabled: boolean;
        cleanup: {
            enabled: boolean;
            retentionDays: number;
            cron: string;
        };
    };
    auth: {
        linuxDo: {
            clientId: string;
            clientSecret: string;
        };
    };
    storage: {
        mode: string;
        allowUserProvider: boolean;
        allowUserGlobalProvider: boolean;
        autoSyncAllAssets: boolean;
        providers: AdminStorageProvider[];
        roundRobinCursor: number;
        capacityCheck: {
            enabled: boolean;
            cron: string;
        };
        capacityLimitBytes: number;
    };
};

export type AdminAICallLog = {
    id: string;
    userId: string;
    userDisplayName: string;
    endpoint: string;
    method: string;
    model: string;
    channelId: string;
    channelName: string;
    status: number;
    failed: boolean;
    durationMs: number;
    credits: number;
    requestBody: string;
    responseBody: string;
    error: string;
    createdAt: string;
};

export type AdminAICallLogListResponse = {
    items: AdminAICallLog[];
    total: number;
};

export type AdminAICallLogQuery = {
    keyword?: string;
    model?: string;
    channel?: string;
    result?: string;
    startDate?: string;
    endDate?: string;
    page?: number;
    pageSize?: number;
};

export type AdminAICallLogGroupStat = {
    key: string;
    calls: number;
    failed: number;
    failureRate: number;
    avgDurationMs: number;
    credits: number;
};

export type AdminAICallLogDailyStat = {
    date: string;
    calls: number;
    failed: number;
    credits: number;
};

export type AdminAICallLogStats = {
    total: number;
    success: number;
    failed: number;
    failureRate: number;
    avgDurationMs: number;
    p95DurationMs: number;
    credits: number;
    userCount: number;
    modelCount: number;
    channelCount: number;
    models: string[];
    channels: string[];
    daily: AdminAICallLogDailyStat[];
    byModel: AdminAICallLogGroupStat[];
    byUser: AdminAICallLogGroupStat[];
    byChannel: AdminAICallLogGroupStat[];
};

export type AdminAICallLogExport = {
    fileName: string;
    content: string;
    total: number;
    truncated: boolean;
};

export async function fetchAdminAICallLogs(token: string, query: AdminAICallLogQuery = {}) {
    return apiGet<AdminAICallLogListResponse>("/api/admin/ai-logs", compactApiParams(query), token);
}

export async function fetchAdminAICallLogStats(token: string, query: AdminAICallLogQuery = {}) {
    return apiGet<AdminAICallLogStats>("/api/admin/ai-logs/stats", compactApiParams(query), token);
}

export async function exportAdminAICallLogs(token: string, query: AdminAICallLogQuery = {}) {
    return apiGet<AdminAICallLogExport>("/api/admin/ai-logs/export", compactApiParams(query), token);
}

export async function deleteAdminAICallLogs(token: string, olderThanDays = 7) {
    return apiDelete<{ removedFiles: number }>(`/api/admin/ai-logs?olderThanDays=${encodeURIComponent(String(olderThanDays))}`, token);
}

export type AdminSettings = {
    public: AdminPublicSettings;
    private: AdminPrivateSettings;
};

export async function fetchAdminSettings(token: string) {
    return apiGet<AdminSettings>("/api/admin/settings", undefined, token);
}

export async function saveAdminSettings(token: string, settings: AdminSettings) {
    return apiPost<AdminSettings>("/api/admin/settings", settings, token);
}

export type AdminChannelActionRequest = {
    index?: number;
    channel: AdminModelChannel;
    model?: string;
};

export async function fetchChannelModels(token: string, payload: AdminChannelActionRequest) {
    return apiPost<string[]>("/api/admin/settings/channel-models", payload, token);
}

export async function testChannelModel(token: string, payload: AdminChannelActionRequest) {
    return apiPost<string>("/api/admin/settings/channel-test", payload, token);
}

export async function fetchChannelHealth(token: string) {
    return apiGet<AdminChannelHealthInfo[]>("/api/admin/channel-health", undefined, token);
}

export async function restoreChannelHealth(token: string, channelId: string) {
    return apiPost<{ restored: boolean }>("/api/admin/channel-health/restore", { channelId }, token);
}

export type StorageCapacityResult = {
    bytes: number;
    limitBytes: number;
    overLimit: boolean;
    checkedAt: string;
    providerName: string;
};

export async function measureAdminStorageProvider(token: string, payload: { index: number; provider: AdminStorageProvider }) {
    return apiPost<StorageCapacityResult>("/api/admin/storage/measure", payload, token);
}
