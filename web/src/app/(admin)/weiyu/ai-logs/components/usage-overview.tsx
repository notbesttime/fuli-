"use client";

import { Empty, Progress, Skeleton, Table, Tabs } from "antd";

import type { AdminAICallLogDailyStat, AdminAICallLogGroupStat, AdminAICallLogStats } from "@/services/api/admin";

export function AILogUsageOverview({ stats, loading }: { stats?: AdminAICallLogStats; loading: boolean }) {
    const daily = stats?.daily || [];
    const peak = daily.reduce((max, item) => Math.max(max, item.calls), 0);
    const cards = [
        { label: "调用总数", value: formatNumber(stats?.total), unit: "次" },
        { label: "失败次数", value: formatNumber(stats?.failed), unit: "次" },
        { label: "失败率", value: formatPercent(stats?.failureRate), unit: "" },
        { label: "平均耗时", value: formatDuration(stats?.avgDurationMs), unit: "" },
        { label: "P95 耗时", value: formatDuration(stats?.p95DurationMs), unit: "" },
        { label: "消耗算力点", value: formatNumber(stats?.credits), unit: "" },
    ];
    const columns = (label: string) => [
        { title: label, dataIndex: "key", ellipsis: true },
        { title: "调用", dataIndex: "calls", align: "right" as const, width: 90 },
        { title: "失败", dataIndex: "failed", align: "right" as const, width: 90 },
        {
            title: "失败率",
            dataIndex: "failureRate",
            align: "right" as const,
            width: 160,
            render: (value: number) => <Progress percent={Math.round((value || 0) * 1000) / 10} size="small" status={value >= 0.2 ? "exception" : "normal"} />,
        },
        { title: "平均耗时", dataIndex: "avgDurationMs", align: "right" as const, width: 110, render: (value: number) => formatDuration(value) },
        { title: "算力点", dataIndex: "credits", align: "right" as const, width: 100, render: (value: number) => formatNumber(value) },
    ];
    const groupTable = (rows: AdminAICallLogGroupStat[] | undefined, label: string) => (
        <Table
            rowKey="key"
            size="small"
            loading={loading && !stats}
            dataSource={rows || []}
            columns={columns(label)}
            pagination={{ pageSize: 10, hideOnSinglePage: true, showSizeChanger: false }}
            scroll={{ x: 720 }}
            locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="当前筛选条件下没有数据" /> }}
        />
    );

    return (
        <div className="flex flex-col gap-4">
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
                {cards.map((item) => (
                    <div key={item.label} className="rounded-xl border border-stone-200 p-4 dark:border-stone-800">
                        <div className="text-xs text-stone-500 dark:text-stone-400">{item.label}</div>
                        <div className="mt-2 flex items-baseline gap-1">
                            {loading && !stats ? <Skeleton active paragraph={false} title={{ width: 60 }} /> : <span className="text-2xl font-semibold tabular-nums">{item.value}</span>}
                            {item.unit ? <span className="text-xs text-stone-400">{item.unit}</span> : null}
                        </div>
                    </div>
                ))}
            </div>
            <div className="rounded-xl border border-stone-200 dark:border-stone-800">
                <div className="border-b border-stone-200 p-4 text-sm font-semibold dark:border-stone-800">每日调用趋势</div>
                <div className="p-4">
                    {loading && !stats ? (
                        <Skeleton active paragraph={{ rows: 6 }} />
                    ) : daily.length > 0 ? (
                        <div className="flex flex-col gap-2">
                            {daily.map((item) => (
                                <DailyRow key={item.date} item={item} peak={peak} />
                            ))}
                        </div>
                    ) : (
                        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="当前筛选条件下没有数据" />
                    )}
                </div>
            </div>
            <Tabs
                size="small"
                items={[
                    { key: "model", label: "按模型", children: groupTable(stats?.byModel, "模型") },
                    { key: "user", label: "按用户", children: groupTable(stats?.byUser, "用户") },
                    { key: "channel", label: "按渠道", children: groupTable(stats?.byChannel, "渠道") },
                ]}
            />
        </div>
    );
}

function DailyRow({ item, peak }: { item: AdminAICallLogDailyStat; peak: number }) {
    const base = Math.max(peak, 1);
    return (
        <div className="flex items-center gap-3">
            <span className="w-24 shrink-0 text-xs tabular-nums text-stone-500 dark:text-stone-400">{item.date}</span>
            <div className="flex flex-1 flex-col gap-1">
                <Progress percent={Math.round(((item.calls - item.failed) / base) * 100)} size="small" strokeColor="#34d399" showInfo={false} />
                {item.failed > 0 ? <Progress percent={Math.round((item.failed / base) * 100)} size="small" strokeColor="#fb7185" showInfo={false} /> : null}
            </div>
            <span className="w-32 shrink-0 text-right text-xs tabular-nums text-stone-600 dark:text-stone-300">
                共 {item.calls} 次{item.failed > 0 ? ` · 失败 ${item.failed}` : ""}
            </span>
            <span className="w-20 shrink-0 text-right text-xs tabular-nums text-stone-500 dark:text-stone-400">{formatNumber(item.credits)}</span>
        </div>
    );
}

function formatNumber(value: number | undefined) {
    if (value === undefined || Number.isNaN(value)) return "-";
    return value.toLocaleString(undefined, { maximumFractionDigits: 4 });
}

function formatPercent(value: number | undefined) {
    if (value === undefined || Number.isNaN(value)) return "-";
    return `${(value * 100).toFixed(2)}%`;
}

function formatDuration(value: number | undefined) {
    if (value === undefined || Number.isNaN(value) || value <= 0) return "-";
    return value >= 1000 ? `${(value / 1000).toFixed(2)}s` : `${Math.round(value)}ms`;
}