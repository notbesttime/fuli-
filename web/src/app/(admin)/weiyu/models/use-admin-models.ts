"use client";

import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { App } from "antd";

import { fetchAdminSettings, saveAdminSettings, type AdminModelCost, type AdminModelGroup, type AdminPublicModelChannelSettings, type AdminSettings } from "@/services/api/admin";
import { useUserStore } from "@/stores/use-user-store";

export type ModelDefaults = Pick<AdminPublicModelChannelSettings, "defaultModel" | "defaultImageModel" | "defaultVideoModel" | "defaultTextModel">;

export function useAdminModels() {
    const { message } = App.useApp();
    const queryClient = useQueryClient();
    const token = useUserStore((state) => state.token);

    const settingsQuery = useQuery({ queryKey: ["admin", "settings", token], queryFn: () => fetchAdminSettings(token), enabled: Boolean(token), retry: false });
    const settings = settingsQuery.data;
    const modelChannel = settings?.public.modelChannel;
    const costs = modelChannel?.modelCosts || [];
    const pricing = modelChannel?.pricing;
    const groups = pricing?.groups || [];
    const creditRate = pricing?.creditRate || 1;

    const channelModels = useMemo(() => {
        const channels = settings?.private.channels || [];
        return Array.from(new Set(channels.filter((channel) => channel.enabled).flatMap((channel) => channel.models || []).filter(Boolean)));
    }, [settings]);

    const availableModels = modelChannel?.availableModels || [];
    const modelOptions = useMemo(() => Array.from(new Set([...availableModels, ...channelModels, ...costs.map((cost) => cost.model).filter(Boolean)])).sort(), [availableModels, channelModels, costs]);

    const saveMutation = useMutation({
        mutationFn: (next: AdminSettings) => saveAdminSettings(token, next),
        onSuccess: (saved) => queryClient.setQueryData(["admin", "settings", token], saved),
        onError: (error) => message.error(error instanceof Error ? error.message : "保存失败"),
    });

    const saveModelChannel = async (patch: Partial<AdminPublicModelChannelSettings>, successText = "已保存") => {
        if (!settings) throw new Error("设置尚未加载，请稍后重试");
        await saveMutation.mutateAsync({ ...settings, public: { ...settings.public, modelChannel: { ...settings.public.modelChannel, ...patch } } });
        message.success(successText);
    };

    const unitsFor = (price: number) => {
        const rate = creditRate > 0 ? creditRate : 1;
        return Math.round((price / rate) * 10000) / 10000;
    };

    return {
        settings,
        isLoading: settingsQuery.isFetching,
        isSaving: saveMutation.isPending,
        costs,
        groups,
        creditRate,
        currency: pricing?.currency || "CNY",
        availableModels,
        channelModels,
        modelOptions,
        defaults: {
            defaultModel: modelChannel?.defaultModel || "",
            defaultImageModel: modelChannel?.defaultImageModel || "",
            defaultVideoModel: modelChannel?.defaultVideoModel || "",
            defaultTextModel: modelChannel?.defaultTextModel || "",
        },
        unitsFor,
        saveCosts: (next: AdminModelCost[]) => saveModelChannel({ modelCosts: next }, "模型价格已保存"),
        savePricing: (next: { creditRate: number; groups: AdminModelGroup[] }) => saveModelChannel({ pricing: { currency: pricing?.currency || "CNY", creditRate: next.creditRate, groups: next.groups } }, "计费设置已保存"),
        saveDefaults: (next: Partial<ModelDefaults>) => saveModelChannel(next, "默认模型已保存"),
        saveAvailableModels: (next: string[]) => saveModelChannel({ availableModels: next }, "可用模型已保存"),
    };
}
