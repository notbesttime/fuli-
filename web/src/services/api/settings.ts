import type { RechargeSetting } from "@/services/api/redeem";

export const DEFAULT_RECHARGE_SETTING: RechargeSetting = {
    enabled: true,
    storeUrl: "https://wzyp.cn/shop/QKH7GGGF",
    notice: "小铺购买含平台服务费，直接联系我充值更便宜；大额充值请联系我。",
    contact: "",
    largeAmount: 100,
    tiers: [0.1, 1, 5, 10, 20, 30].map((amount) => ({ amount, url: "" })),
};

export function safeHttpUrl(value: string) {
    try {
        const url = new URL(value.trim());
        return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password ? url.href : "";
    } catch {
        return "";
    }
}

export function normalizeRechargeSetting(setting?: Partial<RechargeSetting> | null): RechargeSetting {
    const tiers = Array.isArray(setting?.tiers) ? setting.tiers.filter((tier) => tier && Number.isFinite(tier.amount) && tier.amount > 0).map((tier) => ({ amount: tier.amount, url: safeHttpUrl(tier.url || "") })) : [];
    return {
        enabled: setting?.enabled !== false,
        storeUrl: safeHttpUrl(setting?.storeUrl ?? DEFAULT_RECHARGE_SETTING.storeUrl),
        notice: setting?.notice ?? DEFAULT_RECHARGE_SETTING.notice,
        contact: setting?.contact?.trim() || "",
        largeAmount: Number.isFinite(setting?.largeAmount) && Number(setting?.largeAmount) > 0 ? Number(setting?.largeAmount) : DEFAULT_RECHARGE_SETTING.largeAmount,
        tiers: Array.isArray(setting?.tiers) ? tiers : DEFAULT_RECHARGE_SETTING.tiers.map((tier) => ({ ...tier })),
    };
}
