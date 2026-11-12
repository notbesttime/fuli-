import type { AdminModelCost, AdminPricingSetting, AdminPublicModelChannelInfo } from "@/services/api/admin";

export type MarketBillingMode = "image" | "second" | "request";
type MarketResolutionPrice = { resolution: string; billingMode: MarketBillingMode; basePrice: number; price: number | null };

export type MarketGroupPrice = {
    id: string;
    name: string;
    desc: string;
    ratio: number;
    available: boolean;
    channels: { id: string; name: string; remark: string }[];
    price: number | null;
    resolutions: MarketResolutionPrice[];
};

export type MarketModel = {
    model: string;
    vendor: string;
    tags: string[];
    billingMode: MarketBillingMode;
    basePrice: number;
    prices: MarketGroupPrice[];
    resolutions: Omit<MarketResolutionPrice, "price">[];
    kind: "image" | "video" | "text";
};

export type MarketListing = { model: MarketModel; group: MarketGroupPrice };
export type MarketFilters = {
    platform: string | "all";
    groupId: string | "all";
    ratio: number | "all";
    billingMode: MarketBillingMode | "all";
    endpoint?: MarketModel["kind"] | "all";
    keyword: string;
};
export type MarketFacet = "platform" | "groupId" | "ratio" | "billingMode" | "endpoint";
export const marketEndpointLabels: Record<MarketModel["kind"], string> = {
    image: "图片",
    video: "视频",
    text: "文本",
};

export const marketBillingModeLabels: Record<MarketBillingMode, string> = {
    image: "按张",
    second: "按秒",
    request: "按次",
};

export function marketBillingUnit(mode: MarketBillingMode) {
    if (mode === "second") return "元/秒";
    if (mode === "request") return "元/次";
    return "元/张";
}

const priceFormatter = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 4, useGrouping: false });

export function formatMarketPrice(value: number) {
    return priceFormatter.format(value);
}

function round4(value: number) {
    return Math.round(value * 10000) / 10000;
}

function modelKind(model: string): MarketModel["kind"] {
    const name = model.toLowerCase();
    if (name.includes("seedance") || name.includes("video") || name.includes("-h3")) return "video";
    if (name.includes("seedream") || name.includes("gpt-image") || name.includes("image")) return "image";
    if (name.startsWith("workflow:") || name.includes("sdxl") || name.includes("flux")) return "image";
    return "text";
}

// 与后端一致，人民币单价优先；仅配算力点时按 creditRate 换算，保留四位小数。
function entryPrice(entry: AdminModelCost | undefined, creditRate = 1) {
    if (!entry) return 0;
    const price = Number(entry.price) || 0;
    if (price > 0) return round4(price);
    const credits = Number(entry.credits) || 0;
    if (credits > 0) return round4(credits * creditRate);
    return 0;
}

function kindBillingMode(kind: MarketModel["kind"]): MarketBillingMode {
    if (kind === "video") return "second";
    if (kind === "text") return "request";
    return "image";
}

// 只依据公开渠道的模型、工作流、启用状态和分组判断可用性，不读取凭据。
export function buildMarketModels(costs: AdminModelCost[] | undefined, pricing: AdminPricingSetting | undefined, availableModels: string[], channels: AdminPublicModelChannelInfo[] = []): MarketModel[] {
    const groups = pricing?.groups?.length ? pricing.groups : [{ id: "default", name: "默认分组", ratio: 1, desc: "" }];
    const items = costs || [];
    const creditRate = Number(pricing?.creditRate) > 0 ? Number(pricing.creditRate) : 1;
    const modelNames = Array.from(new Set([...items.map((item) => item.model), ...availableModels].filter(Boolean)));
    return modelNames
        .map((model) => {
            const entries = items.filter((item) => item.model === model);
            const base = entries.find((item) => !item.resolution);
            const kind = modelKind(model);
            const billingMode = base?.billingMode || kindBillingMode(kind);
            const basePrice = entryPrice(base, creditRate);
            const resolutions: MarketModel["resolutions"] = entries.filter((item) => item.resolution).map((item) => ({ resolution: item.resolution || "", billingMode: item.billingMode || billingMode, basePrice: entryPrice(item, creditRate) }));
            const modelChannels = channels.filter((channel) => {
                if (!channel.enabled) return false;
                if (model.startsWith("workflow:")) {
                    return channel.workflows?.some((workflow) => workflow.enabled && model === "workflow:system:" + channel.id + ":" + workflow.kind + ":" + workflow.workflowId);
                }
                return channel.models.includes(model);
            });
            return {
                model,
                vendor: base?.vendor || entries[0]?.vendor || "",
                tags: base?.tags || entries[0]?.tags || [],
                billingMode,
                basePrice,
                kind,
                resolutions,
                prices: groups.map((group) => {
                    const bound = modelChannels.filter((channel) => (channel.groups?.length ? channel.groups : ["default"]).includes(group.id));
                    const available = bound.length > 0;
                    return {
                        id: group.id,
                        name: group.name,
                        desc: group.desc || "",
                        ratio: group.ratio,
                        available,
                        channels: bound.map((channel) => ({ id: channel.id, name: channel.name, remark: channel.remark || "" })),
                        price: available ? round4(basePrice * group.ratio) : null,
                        resolutions: resolutions.map((entry) => ({ ...entry, price: available ? round4(entry.basePrice * group.ratio) : null })),
                    };
                }),
            };
        })
        .sort((a, b) => a.model.localeCompare(b.model));
}

export function marketPlatform(model: MarketModel) {
    return model.vendor.trim() || "未标注厂商";
}

export function buildMarketListings(models: MarketModel[]): MarketListing[] {
    return models
        .flatMap((model) => model.prices.map((group) => ({ model, group })))
        .sort((a, b) => a.group.ratio - b.group.ratio || a.group.name.localeCompare(b.group.name) || a.model.model.localeCompare(b.model.model));
}

export function filterMarketListings(listings: MarketListing[], filters: MarketFilters): MarketListing[] {
    const keyword = filters.keyword.trim().toLocaleLowerCase();
    return listings.filter(({ model, group }) => {
        if (filters.platform !== "all" && marketPlatform(model) !== filters.platform) return false;
        if (filters.groupId !== "all" && group.id !== filters.groupId) return false;
        if (filters.ratio !== "all" && group.ratio !== filters.ratio) return false;
        if (filters.billingMode !== "all" && model.billingMode !== filters.billingMode) return false;
        if (filters.endpoint && filters.endpoint !== "all" && model.kind !== filters.endpoint) return false;
        if (keyword && ![model.model, model.vendor, ...model.tags].some((value) => value.toLocaleLowerCase().includes(keyword))) return false;
        return true;
    });
}

export function marketFacetEnabled(listings: MarketListing[], filters: MarketFilters, facet: MarketFacet, value: string | number) {
    return filterMarketListings(listings, { ...filters, [facet]: value } as MarketFilters).length > 0;
}
