"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { App } from "antd";

import { deleteAdminAPIKey, fetchAdminAPIKeys, saveAdminAPIKey, updateAdminAPIKeyStatus } from "@/services/api/admin";
import { useUserStore } from "@/stores/use-user-store";

const defaultPageSize = 10;

export type APIKeyFilters = { keyword: string; group: string; status: string };

const emptyFilters: APIKeyFilters = { keyword: "", group: "", status: "" };

export type APIKeySaveInput = { name?: string; group?: string; expiresAt?: string; active?: boolean };

export function useAdminAPIKeys() {
    const { message } = App.useApp();
    const queryClient = useQueryClient();
    const token = useUserStore((state) => state.token);
    const clearSession = useUserStore((state) => state.clearSession);
    const [filters, setFilters] = useState<APIKeyFilters>(emptyFilters);
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(defaultPageSize);

    const query = useQuery({
        queryKey: ["admin", "api-keys", token, filters, page, pageSize],
        queryFn: () => fetchAdminAPIKeys(token, { ...filters, page, pageSize }),
        enabled: Boolean(token),
        retry: false,
    });

    const invalidate = () => queryClient.invalidateQueries({ queryKey: ["admin", "api-keys"] });

    const saveMutation = useMutation({
        mutationFn: ({ id, input }: { id: string; input: APIKeySaveInput }) => saveAdminAPIKey(token, id, input),
        onSuccess: async () => {
            await invalidate();
            message.success("密钥已保存");
        },
        onError: (error) => message.error(error instanceof Error ? error.message : "保存失败"),
    });

    const statusMutation = useMutation({
        mutationFn: ({ id, active }: { id: string; active: boolean }) => updateAdminAPIKeyStatus(token, id, active),
        onSuccess: async (_, variables) => {
            await invalidate();
            message.success(variables.active ? "密钥已启用" : "密钥已禁用");
        },
        onError: (error) => message.error(error instanceof Error ? error.message : "操作失败"),
    });

    const deleteMutation = useMutation({
        mutationFn: (id: string) => deleteAdminAPIKey(token, id),
        onSuccess: async () => {
            await invalidate();
            message.success("密钥已删除");
        },
        onError: (error) => message.error(error instanceof Error ? error.message : "删除失败"),
    });

    useEffect(() => {
        if (query.isError) {
            const errorMessage = query.error instanceof Error ? query.error.message : "读取密钥失败";
            message.error(errorMessage);
            if (errorMessage.includes("未登录") || errorMessage.includes("权限不足") || errorMessage.includes("登录状态无效")) clearSession();
        }
    }, [clearSession, message, query.error, query.isError]);

    const setFilter = (next: Partial<APIKeyFilters>) => {
        setFilters((prev) => ({ ...prev, ...next }));
        setPage(1);
    };

    const data = query.data;

    return {
        items: data?.items || [],
        keyword: filters.keyword,
        filters,
        page,
        pageSize,
        total: data?.total || 0,
        isLoading: query.isFetching || saveMutation.isPending || statusMutation.isPending || deleteMutation.isPending,
        search: (value = filters.keyword) => setFilter({ keyword: value }),
        setFilter,
        changePage: (value: number) => setPage(value),
        changePageSize: (value: number) => {
            setPageSize(value);
            setPage(1);
        },
        resetFilters: () => {
            setFilters(emptyFilters);
            setPage(1);
            setPageSize(defaultPageSize);
        },
        refresh: () => query.refetch(),
        saveKey: (id: string, input: APIKeySaveInput) => saveMutation.mutateAsync({ id, input }),
        setActive: (id: string, active: boolean) => statusMutation.mutateAsync({ id, active }),
        deleteKey: (id: string) => deleteMutation.mutateAsync(id),
    };
}
