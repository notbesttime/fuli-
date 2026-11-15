"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { App } from "antd";

import { adjustAdminUserCredits, deleteAdminUser, fetchAdminUserDetail, fetchAdminUsers, saveAdminUser, updateAdminUserStatus, type AdminUser } from "@/services/api/admin";
import { useUserStore } from "@/stores/use-user-store";

const defaultPageSize = 10;

export type AdminUserFilters = { keyword: string; role: string; status: string; group: string };

const emptyFilters: AdminUserFilters = { keyword: "", role: "", status: "", group: "" };

export function useAdminUsers() {
    const { message } = App.useApp();
    const queryClient = useQueryClient();
    const token = useUserStore((state) => state.token);
    const clearSession = useUserStore((state) => state.clearSession);
    const [filters, setFilters] = useState<AdminUserFilters>(emptyFilters);
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(defaultPageSize);
    const [detailUserId, setDetailUserId] = useState<string | null>(null);

    const query = useQuery({
        queryKey: ["admin", "users", token, filters, page, pageSize],
        queryFn: () => fetchAdminUsers(token, { ...filters, page, pageSize }),
        enabled: Boolean(token),
        retry: false,
    });

    const detailQuery = useQuery({
        queryKey: ["admin", "user", token, detailUserId],
        queryFn: () => fetchAdminUserDetail(token, detailUserId as string),
        enabled: Boolean(token) && Boolean(detailUserId),
        retry: false,
    });

    const saveMutation = useMutation({
        mutationFn: (user: Partial<AdminUser> & { password?: string }) => saveAdminUser(token, user),
        onSuccess: async (_, user) => {
            await queryClient.invalidateQueries({ queryKey: ["admin", "users"] });
            message.success(user.id ? "用户已保存" : "用户已新增");
        },
        onError: (error) => message.error(error instanceof Error ? error.message : "保存失败"),
    });

    const deleteMutation = useMutation({
        mutationFn: (id: string) => deleteAdminUser(token, id),
        onSuccess: async () => {
            await queryClient.invalidateQueries({ queryKey: ["admin", "users"] });
            message.success("用户已删除");
        },
        onError: (error) => message.error(error instanceof Error ? error.message : "删除失败"),
    });

    const creditMutation = useMutation({
        mutationFn: ({ id, credits }: { id: string; credits: number }) => adjustAdminUserCredits(token, id, credits),
        onSuccess: async () => {
            await queryClient.invalidateQueries({ queryKey: ["admin", "users"] });
            message.success("算力点已调整");
        },
        onError: (error) => message.error(error instanceof Error ? error.message : "调整失败"),
    });

    const statusMutation = useMutation({
        mutationFn: ({ id, status }: { id: string; status: "active" | "ban" }) => updateAdminUserStatus(token, id, status),
        onSuccess: async (_, variables) => {
            await queryClient.invalidateQueries({ queryKey: ["admin", "users"] });
            await queryClient.invalidateQueries({ queryKey: ["admin", "user", token, variables.id] });
            message.success(variables.status === "ban" ? "用户已禁用" : "用户已启用");
        },
        onError: (error) => message.error(error instanceof Error ? error.message : "操作失败"),
    });

    useEffect(() => {
        if (query.isError) {
            const errorMessage = query.error instanceof Error ? query.error.message : "读取用户失败";
            message.error(errorMessage);
            if (errorMessage.includes("未登录") || errorMessage.includes("权限不足") || errorMessage.includes("登录状态无效")) clearSession();
        }
    }, [clearSession, message, query.error, query.isError]);

    const setFilter = (next: Partial<AdminUserFilters>) => {
        setFilters((prev) => ({ ...prev, ...next }));
        setPage(1);
    };

    const data = query.data;

    return {
        users: data?.items || [],
        keyword: filters.keyword,
        filters,
        page,
        pageSize,
        total: data?.total || 0,
        isLoading: query.isFetching || saveMutation.isPending || deleteMutation.isPending || creditMutation.isPending || statusMutation.isPending,
        detail: detailQuery.data,
        detailLoading: detailQuery.isFetching,
        detailUserId,
        searchUsers: (value = filters.keyword) => setFilter({ keyword: value }),
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
        refreshUsers: () => query.refetch(),
        openDetail: (id: string) => setDetailUserId(id),
        closeDetail: () => setDetailUserId(null),
        setUserStatus: (id: string, status: "active" | "ban") => statusMutation.mutateAsync({ id, status }),
        saveUser: (user: Partial<AdminUser> & { password?: string }) => saveMutation.mutateAsync(user),
        adjustCredits: (id: string, credits: number) => creditMutation.mutateAsync({ id, credits }),
        deleteUser: (id: string) => deleteMutation.mutateAsync(id),
    };
}
