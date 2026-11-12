import type { ComponentProps } from "react";
import { Zap } from "lucide-react";

import { normalizeVideoResolutionValue } from "@/components/video-settings-panel";

export function CreditSymbol({ className, ...props }: ComponentProps<"span">) {
    return (
        <span {...props} className={`inline-flex items-center justify-center ${className || ""}`}>
            <Zap className="size-[1em] fill-current" strokeWidth={2.4} />
        </span>
    );
}

export type ModelCreditCost = {
    model: string;
    resolution?: string;
    billingMode?: "image" | "second" | "request";
    price?: number;
    credits: number;
};

function findModelCost(modelCosts: ModelCreditCost[] | undefined, model: string, resolution = "") {
    const items = modelCosts?.filter((item) => item.model === model) || [];
    const value = normalizeVideoResolutionValue(resolution).toLowerCase();
    const matched = items.find((item) => item.resolution && normalizeVideoResolutionValue(item.resolution).toLowerCase() === value);
    if (matched) return matched;
    return items.find((item) => !item.resolution);
}

export function modelCreditCost(modelCosts: ModelCreditCost[] | undefined, model: string, resolution = "") {
    return findModelCost(modelCosts, model, resolution)?.credits || 0;
}

// modelUnitPrice 返回模型单张／每秒／每次的人民币参考价。
export function modelUnitPrice(modelCosts: ModelCreditCost[] | undefined, model: string, resolution = "") {
    return findModelCost(modelCosts, model, resolution)?.price || 0;
}

export function modelBillingMode(modelCosts: ModelCreditCost[] | undefined, model: string, resolution = "") {
    return findModelCost(modelCosts, model, resolution)?.billingMode || (resolution ? "second" : "image");
}

// groupRatio 返回当前用户分组的价格倍率，未命中时按 1 处理。
export function groupRatio(groups: { id: string; ratio: number }[] | undefined, group: string | undefined) {
    const id = (group || "").trim() || "default";
    return groups?.find((item) => item.id === id && item.ratio > 0)?.ratio || 1;
}

// requestUnitPrice 单次请求的人民币参考价。本地直连渠道由用户自己承担费用，不展示价格。
export function requestUnitPrice(options: { channelMode?: string; modelCosts?: ModelCreditCost[]; model: string; resolution?: string; count?: string | number; seconds?: string | number; ratio?: number }) {
    if (options.channelMode && options.channelMode !== "remote") return 0;
    const amount = Number(options.seconds ?? options.count);
    const quantity = Math.max(1, Math.floor(Math.abs(Number.isFinite(amount) ? amount : 1) || 1));
    return Math.round(modelUnitPrice(options.modelCosts, options.model, options.resolution) * quantity * (options.ratio || 1) * 10000) / 10000;
}

export function requestCreditCost(options: { channelMode: string; modelCosts?: ModelCreditCost[]; model: string; resolution?: string; count?: string | number; seconds?: string | number; ratio?: number }) {
    if (options.channelMode !== "remote") return 0;
    const seconds = Number(options.seconds);
    const count = options.seconds !== undefined && seconds === -1 ? 15 : Math.max(1, Math.floor(Math.abs(Number(options.seconds ?? options.count)) || 1));
    return Math.round(modelCreditCost(options.modelCosts, options.model, options.resolution) * count * (options.ratio || 1) * 10000) / 10000;
}
