"use client";

/*
 * Copyright (C) 2023-2026 QuantumNous
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * Adapted from new-api-hcnsec@52683df93460569c6aead266aa5d96c3f44d3912
 * web/src/features/dashboard/components/overview/summary-cards.tsx
 * Changes: Next links, local credit units, natural-day / seven-day data;
 * replace the unavailable 24-hour runway with the selected billing group.
 */
import Link from "next/link";
import { Activity, ArrowRight, Flame, Layers3, Wallet } from "lucide-react";
import { Button, Skeleton, theme } from "antd";

import { consoleText } from "@/lib/console-locale";
import type { CreditOverview } from "@/services/api/credits";
import { useConfigStore } from "@/stores/use-config-store";
import { useConsolePreferences } from "@/stores/use-console-preferences";
import { useUserStore } from "@/stores/use-user-store";
import { StatCard } from "./stat-card";

export function SummaryCards({ data, loading }: { data: CreditOverview | null; loading: boolean }) {
    const { token } = theme.useToken();
    const locale = useConsolePreferences((state) => state.locale);
    const user = useUserStore((state) => state.user);
    const groups = useConfigStore((state) => state.publicSettings?.modelChannel.pricing?.groups);
    const groupId = user?.preferredGroup || "default";
    const groupName = groups?.find((group) => group.id === groupId)?.name || groupId;
    const t = (key: Parameters<typeof consoleText>[1]) => consoleText(locale, key);
    const zh = locale === "zh-CN";
    const format = (value: number) => value.toLocaleString(locale, { maximumFractionDigits: 4 });
    const spending = data?.dailySpending.map((item) => item.spent) || [];
    const calls = data?.dailySpending.map((item) => item.calls) || [];
    const items = [
        { title: t("dashboard.todaySpent"), value: data?.todaySpent, description: zh ? "今日消耗 · 算力点" : "Today's usage · credits", icon: Flame, tone: "accent-1" as const, trend: spending },
        { title: t("dashboard.totalSpent"), value: data?.totalSpent, description: zh ? "历史总消耗 · 算力点" : "All-time usage · credits", icon: Layers3, tone: "accent-2" as const, trend: spending },
        { title: zh ? "请求计数" : "Request count", value: data?.totalCalls, description: zh ? "累计计费调用次数" : "All-time billed calls", icon: Activity, tone: "accent-3" as const, trend: calls },
    ];

    return (
        <div className="overflow-hidden rounded-2xl border bg-card shadow-xs">
            <div className="grid xl:grid-cols-[minmax(0,1fr)_17rem]">
                <div className="flex flex-col gap-5 p-4 sm:p-5">
                    <div><h2 className="text-base font-semibold">{zh ? "用量概览" : "Usage at a glance"}</h2><p className="mt-1 text-sm text-muted-foreground">{zh ? "监控余额、用量和请求量" : "Monitor balance, usage and request volume"}</p></div>
                    <div className="grid gap-3 sm:grid-cols-3">
                        {items.map((item) => (
                            <div key={item.title} className="rounded-xl border bg-background/60 p-4">
                                <StatCard title={item.title} value={data ? format(item.value || 0) : "—"} description={item.description} icon={item.icon} tone={item.tone} sparkline={item.trend} sparklineVariant="line" loading={loading && !data} />
                            </div>
                        ))}
                    </div>
                    <p className="text-xs text-muted-foreground">{zh ? "迷你趋势图展示近 7 日每日消耗和计费调用。" : "Sparklines show daily usage and billed calls over the last 7 days."}</p>
                </div>
                <div className="flex flex-col justify-between gap-5 border-t p-4 sm:p-5 xl:border-t-0 xl:border-l" style={{ background: `linear-gradient(135deg, ${token.colorInfoBg}, ${token.colorBgContainer})` }}>
                    <div>
                        <div className="flex items-center justify-between text-xs text-muted-foreground"><span className="flex items-center gap-2"><Wallet size={14} />{t("dashboard.balance")}</span>{data ? <span className="flex items-center gap-1.5"><span className="size-1.5 rounded-full" style={{ background: data.balance > 0 ? token.colorSuccess : token.colorWarning }} />{data.balance > 0 ? (zh ? "可用" : "Available") : (zh ? "待充值" : "Top up")}</span> : null}</div>
                        {loading && !data ? <Skeleton active className="my-4" paragraph={false} /> : <div className="mt-4 flex flex-wrap items-baseline gap-2"><span className="text-3xl font-semibold tabular-nums">{data ? format(data.balance) : "—"}</span><span className="text-xs text-muted-foreground">{t("common.currency")}</span></div>}
                        <div className="mt-5 grid grid-cols-2 gap-2 text-xs">
                            <div className="rounded-lg bg-background/70 p-2.5"><div className="text-muted-foreground">{t("dashboard.todayCalls")}</div><div className="mt-2 font-semibold tabular-nums">{data ? format(data.todayCalls) : "—"}</div></div>
                            <div className="rounded-lg bg-background/70 p-2.5"><div className="text-muted-foreground">{zh ? "计费分组" : "Billing group"}</div><div className="mt-2 truncate font-semibold" title={groupName + " · " + groupId}>{user ? groupName : "—"}</div></div>
                        </div>
                    </div>
                    <Button type="primary" href="/credits" className="w-full"><span className="flex w-full items-center justify-between">{t("dashboard.goCredits")}<ArrowRight size={15} /></span></Button>
                    <Link href="/profile" className="text-center text-xs text-muted-foreground hover:text-foreground">{t("dashboard.goProfile")}</Link>
                </div>
            </div>
        </div>
    );
}
