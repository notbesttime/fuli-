"use client";

import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { App } from "antd";

import { fetchAdminSettings, fetchChannelHealth, fetchChannelModels, restoreChannelHealth, saveAdminSettings, testChannelModel, type AdminChannelHealthInfo, type AdminModelChannel } from "@/services/api/admin";
import { useUserStore } from "@/stores/use-user-store";

export function useAdminChannels() {
    const { message } = App.useApp();
    const queryClient = useQueryClient();
    const token = useUserStore((state) => state.token);
    const clearSession = useUserStore((state) => state.clearSession);

    const settingsQuery = useQuery({ queryKey: ["admin", "settings", token], queryFn: () => fetchAdminSettings(token), enabled: Boolean(token), retry: false });
    const healthQuery = useQuery({ queryKey: ["admin", "channel-health", token], queryFn: () => fetchChannelHealth(token), enabled: Boolean(token), retry: false });

    const settings = settingsQuery.data;
    const channels = settings?.private.channels || [];
    const healthMap = useMemo(() => {
        const map = new Map<string, AdminChannelHealthInfo>();
        (healthQuery.data || []).forEach((item) => map.set(item.id, item));
        return map;
    }, [healthQuery.data]);

    const saveMutation = useMutation({
        mutationFn: (nextChannels: AdminModelChannel[]) => {
            if (!settings) throw new Error("设置尚未加载，请稍后重试");
            return saveAdminSettings(token, { public: settings.public, private: { ...settings.private, channels: nextChannels } });
        },
        onSuccess: (saved) => {
            queryClient.setQueryData(["admin", "settings", token], saved);
        },
        onError: (error) => message.error(error instanceof Error ? error.message : "保存渠道失败"),
    });

    const restoreMutation = useMutation({
        mutationFn: (channelId: string) => restoreChannelHealth(token, channelId),
        onSuccess: async () => {
            await queryClient.invalidateQueries({ queryKey: ["admin", "channel-health"] });
            message.success("已恢复该渠道熔断状态");
        },
        onError: (error) => message.error(error instanceof Error ? error.message : "恢复失败"),
    });

    const saveChannels = async (nextChannels: AdminModelChannel[], successText = "渠道已保存") => {
        await saveMutation.mutateAsync(nextChannels);
        message.success(successText);
    };

    const createChannel = (channel: AdminModelChannel) => saveChannels([...channels, channel], "渠道已创建");
    const updateChannel = (index: number, channel: AdminModelChannel) => saveChannels(channels.map((item, current) => (current === index ? channel : item)), "渠道已更新");
    const setChannelsEnabled = (indices: number[], enabled: boolean) => {
        const target = new Set(indices);
        return saveChannels(channels.map((item, current) => (target.has(current) ? { ...item, enabled } : item)), `已${enabled ? "启用" : "停用"} ${indices.length} 个渠道`);
    };
    const toggleChannel = (index: number, enabled: boolean) => setChannelsEnabled([index], enabled);
    const removeChannels = (indices: number[]) => {
        const removeSet = new Set(indices);
        return saveChannels(channels.filter((_, index) => !removeSet.has(index)), `已删除 ${indices.length} 个渠道`);
    };

    const testChannel = async (index: number, channel: AdminModelChannel, model: string) => {
        const result = await testChannelModel(token, { index, channel, model: model || channel.models[0] || "" });
        message.success(result || "测试成功");
        return result;
    };

    const fetchModels = async (index: number, channel: AdminModelChannel) => fetchChannelModels(token, { index, channel });

    return {
        settings,
        channels,
        groups: settings?.public.modelChannel.pricing.groups || [],
        healthMap,
        isLoading: settingsQuery.isFetching,
        isSaving: saveMutation.isPending,
        error: settingsQuery.error,
        refresh: async () => {
            await Promise.all([settingsQuery.refetch(), healthQuery.refetch()]);
        },
        createChannel,
        updateChannel,
        toggleChannel,
        setChannelsEnabled,
        removeChannels,
        testChannel,
        fetchModels,
        restoreHealth: (channelId: string) => restoreMutation.mutateAsync(channelId),
        clearSession,
    };
}
