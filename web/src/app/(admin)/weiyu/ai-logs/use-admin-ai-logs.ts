"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { App } from "antd";

import { deleteAdminAICallLogs, exportAdminAICallLogs, fetchAdminAICallLogs, fetchAdminAICallLogStats, fetchAdminSettings, saveAdminSettings, type AdminAICallLogQuery } from "@/services/api/admin";
import { useUserStore } from "@/stores/use-user-store";

const defaultPageSize = 20;

export type AILogFilters = { keyword: string; model: string; channel: string; result: string };

const emptyFilters: AILogFilters = { keyword: "", model: "", channel: "", result: "" };

export function useAdminAILogs() {
    const { message } = App.useApp();
    const queryClient = useQueryClient();
    const token = useUserStore((state) => state.token);
    const clearSession = useUserStore((state) => state.clearSession);
    const [filters, setFilters] = useState<AILogFilters>(emptyFilters);
    const [range, setRange] = useState<{ startDate: string; endDate: string }>({ startDate: "", endDate: "" });
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(defaultPageSize);

    // 明细与统计共用同一份筛选条件，保证两个页签看到的数据口径一致。
    const query: AdminAICallLogQuery = { ...filters, ...range };

    const statsQuery = useQuery({
        queryKey: ["admin", "ai-logs", "stats", token, query],
        queryFn: () => fetchAdminAICallLogStats(token, query),
        enabled: Boolean(token),
        retry: false,
    });

    const listQuery = useQuery({
        queryKey: ["admin", "ai-logs", "list", token, query, page, pageSize],
        queryFn: () => fetchAdminAICallLogs(token, { ...query, page, pageSize }),
        enabled: Boolean(token),
        retry: false,
    });

    const settingsQuery = useQuery({
        queryKey: ["admin", "ai-logs", "settings", token],
        queryFn: () => fetchAdminSettings(token),
        enabled: Boolean(token),
        retry: false,
    });

    const invalidate = () => queryClient.invalidateQueries({ queryKey: ["admin", "ai-logs"] });

    const exportMutation = useMutation({
        mutationFn: () => exportAdminAICallLogs(token, query),
        onSuccess: (result) => {
            const blob = new Blob([result.content], { type: "text/csv;charset=utf-8" });
            const url = URL.createObjectURL(blob);
            const link = document.createElement("a");
            link.href = url;
            link.download = result.fileName;
            link.click();
            URL.revokeObjectURL(url);
            message.success(result.truncated ? `已导出 ${result.total} 条中的前 20000 条` : `已导出 ${result.total} 条日志`);
        },
        onError: (error) => message.error(error instanceof Error ? error.message : "导出失败"),
    });

    const clearMutation = useMutation({
        mutationFn: (days: number) => deleteAdminAICallLogs(token, days),
        onSuccess: async (result) => {
            await invalidate();
            message.success(`已清理 ${result.removedFiles} 个日志文件`);
        },
        onError: (error) => message.error(error instanceof Error ? error.message : "清理日志失败"),
    });

    const localDirectMutation = useMutation({
        mutationFn: async (enabled: boolean) => {
            const settings = await fetchAdminSettings(token);
            await saveAdminSettings(token, { ...settings, private: { ...settings.private, aiLog: { ...settings.private.aiLog, localDirectReportEnabled: enabled } } });
            return enabled;
        },
        onSuccess: async (enabled) => {
            await queryClient.invalidateQueries({ queryKey: ["admin", "ai-logs", "settings"] });
            message.success(enabled ? "已开启本地直连日志上报" : "已关闭本地直连日志上报");
        },
        onError: (error) => message.error(error instanceof Error ? error.message : "保存本地直连日志设置失败"),
    });

    const error = statsQuery.error || listQuery.error;
    useEffect(() => {
        if (!error) return;
        const errorMessage = error instanceof Error ? error.message : "读取调用日志失败";
        message.error(errorMessage);
        if (errorMessage.includes("未登录") || errorMessage.includes("权限不足") || errorMessage.includes("登录状态无效")) clearSession();
    }, [clearSession, error, message]);

    const setFilter = (next: Partial<AILogFilters>) => {
        setFilters((prev) => ({ ...prev, ...next }));
        setPage(1);
    };

    const setDateRange = (next: { startDate: string; endDate: string }) => {
        setRange(next);
        setPage(1);
    };

    return {
        filters,
        range,
        stats: statsQuery.data,
        items: listQuery.data?.items || [],
        total: listQuery.data?.total || 0,
        page,
        pageSize,
        statsLoading: statsQuery.isFetching,
        listLoading: listQuery.isFetching,
        localDirectReportEnabled: settingsQuery.data?.private.aiLog?.localDirectReportEnabled === true,
        savingLocalDirectReport: localDirectMutation.isPending,
        setFilter,
        setDateRange,
        search: (keyword = filters.keyword) => setFilter({ keyword }),
        changePage: (value: number) => setPage(value),
        changePageSize: (value: number) => {
            setPageSize(value);
            setPage(1);
        },
        resetFilters: () => {
            setFilters(emptyFilters);
            setRange({ startDate: "", endDate: "" });
            setPage(1);
        },
        refresh: () => invalidate(),
        exportCsv: () => exportMutation.mutateAsync(),
        exporting: exportMutation.isPending,
        clearOldLogs: (days: number) => clearMutation.mutateAsync(days),
        clearing: clearMutation.isPending,
        setLocalDirectReport: (enabled: boolean) => localDirectMutation.mutateAsync(enabled),
    };
}