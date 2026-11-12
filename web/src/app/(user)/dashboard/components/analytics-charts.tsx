"use client";

/*
 * Copyright (C) 2023-2026 QuantumNous
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * Adapted from new-api-hcnsec@52683df93460569c6aead266aa5d96c3f44d3912
 * components/models/{model-charts,consumption-distribution-chart}.tsx.
 * Changes: Next client lazy loading, antd controls, real 7/30-day aggregates.
 */
import dynamic from "next/dynamic";
import { useMemo, useState } from "react";
import { BarChart3, ChartPie } from "lucide-react";
import { Empty, Segmented, Skeleton, Table, Tag } from "antd";

import type { CreditOverview } from "@/services/api/credits";
import { useConsolePreferences } from "@/stores/use-console-preferences";
import { useThemeStore } from "@/stores/use-theme-store";
import { creditChartSpecs } from "./chart-specs";

const VChart = dynamic(() => import("@visactor/react-vchart").then((module) => module.VChart), { ssr: false, loading: () => <Skeleton active paragraph={{ rows: 6 }} /> });
const option = { autoFit: true, mode: "desktop-browser" as const };

export function AnalyticsCharts({ data, loading }: { data: CreditOverview | null; loading: boolean }) {
    const locale = useConsolePreferences((state) => state.locale);
    const dark = useThemeStore((state) => state.theme === "dark");
    const zh = locale === "zh-CN";
    const [metric, setMetric] = useState<"spent" | "calls">("spent");
    const [trendType, setTrendType] = useState<"area" | "bar">("area");
    const [modelType, setModelType] = useState<"pie" | "bar">("pie");
    const specs = useMemo(() => data ? creditChartSpecs(data, metric, trendType, modelType, locale, dark) : null, [data, metric, trendType, modelType, locale, dark]);
    const format = (value: number) => value.toLocaleString(locale, { maximumFractionDigits: 4 });
    const daily = data?.dailySpending || [];
    const models = data?.modelSpending || [];
    const totalSpent = daily.reduce((sum, item) => sum + item.spent, 0);
    const totalCalls = daily.reduce((sum, item) => sum + item.calls, 0);

    return (
        <section className="space-y-5" aria-label={zh ? "数据看板" : "Analytics"}>
            <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-sm text-muted-foreground">{zh ? "消耗与调用趋势、模型占比和排行" : "Usage trends, model distribution and rankings"}</p><Segmented value={metric} onChange={(value) => setMetric(value as typeof metric)} options={[{ label: zh ? "算力消耗" : "Credits used", value: "spent" }, { label: zh ? "调用次数" : "Billed calls", value: "calls" }]} /></div>
            <div className="grid gap-3 sm:grid-cols-3">
                {[{ label: zh ? "近 7 日消耗" : "7-day usage", value: format(totalSpent), unit: zh ? "算力点" : "credits" }, { label: zh ? "近 7 日调用" : "7-day calls", value: format(totalCalls), unit: zh ? "次" : "calls" }, { label: zh ? "近 30 日使用模型" : "Models used in 30 days", value: format(models.length), unit: zh ? "个" : "models" }].map((item) => <div key={item.label} className="rounded-xl border bg-card p-4"><p className="text-xs text-muted-foreground">{item.label}</p>{loading && !data ? <Skeleton active paragraph={false} /> : <p className="mt-3 flex items-baseline gap-2"><span className="text-2xl font-semibold tabular-nums">{data ? item.value : "—"}</span><span className="text-xs text-muted-foreground">{item.unit}</span></p>}</div>)}
            </div>
            <div className="grid gap-5 2xl:grid-cols-2">
                <div className="min-w-0 overflow-hidden rounded-xl border bg-card">
                    <div className="flex flex-wrap items-center justify-between gap-3 border-b p-4"><h2 className="flex items-center gap-2 text-sm font-semibold"><BarChart3 size={16} />{zh ? "消耗与调用趋势" : "Usage and call trends"}<Tag>{zh ? "近 7 日" : "7 days"}</Tag></h2><Segmented size="small" value={trendType} onChange={(value) => setTrendType(value as typeof trendType)} options={[{ label: zh ? "面积" : "Area", value: "area" }, { label: zh ? "柱状" : "Bars", value: "bar" }]} /></div>
                    <div className="h-80 p-3" role="img" aria-label={zh ? "近 7 日每日消耗或调用趋势，下方表格提供完整数据" : "7-day trend; exact values are in the table below"}>{loading && !data ? <Skeleton active paragraph={{ rows: 6 }} /> : data && specs ? <VChart key={trendType + metric + dark + locale} spec={specs.trend} options={option} /> : <Empty description={zh ? "暂无数据" : "No data"} />}</div>
                </div>
                <div className="min-w-0 overflow-hidden rounded-xl border bg-card">
                    <div className="flex flex-wrap items-center justify-between gap-3 border-b p-4"><h2 className="flex items-center gap-2 text-sm font-semibold"><ChartPie size={16} />{zh ? "模型用量分析" : "Model usage"}<Tag>{zh ? "近 30 日" : "30 days"}</Tag></h2><Segmented size="small" value={modelType} onChange={(value) => setModelType(value as typeof modelType)} options={[{ label: zh ? "占比" : "Share", value: "pie" }, { label: zh ? "排行" : "Ranking", value: "bar" }]} /></div>
                    <div className="flex h-80 items-center justify-center p-3" role="img" aria-label={zh ? "近 30 日模型分布，下方表格提供完整数据" : "30-day model distribution; exact values are below"}>{loading && !data ? <Skeleton active paragraph={{ rows: 6 }} /> : models.some((item) => item[metric] > 0) && specs ? <div className="size-full"><VChart key={modelType + metric + dark + locale} spec={specs.model} options={option} /></div> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={zh ? "暂无模型用量记录" : "No model usage yet"} />}</div>
                </div>
            </div>
            <div className="overflow-hidden rounded-xl border bg-card"><h2 className="border-b p-4 text-sm font-semibold">{zh ? "每日明细 · 近 7 日" : "Daily details · 7 days"}</h2><Table size="small" rowKey="date" dataSource={data ? daily : []} loading={loading && !data} pagination={false} scroll={{ x: 420 }} columns={[{ title: zh ? "日期" : "Date", dataIndex: "date" }, { title: zh ? "消耗算力点" : "Credits used", dataIndex: "spent", render: format, align: "right" }, { title: zh ? "计费调用" : "Billed calls", dataIndex: "calls", align: "right" }]} /></div>
            <div className="overflow-hidden rounded-xl border bg-card"><h2 className="border-b p-4 text-sm font-semibold">{zh ? "模型明细 · 近 30 日" : "Model details · 30 days"}</h2><Table size="small" rowKey="model" dataSource={models} loading={loading && !data} pagination={{ pageSize: 10, hideOnSinglePage: true, showSizeChanger: false }} scroll={{ x: 420 }} columns={[{ title: zh ? "模型" : "Model", dataIndex: "model", ellipsis: true }, { title: zh ? "消耗算力点" : "Credits used", dataIndex: "spent", render: format, align: "right", sorter: (a, b) => a.spent - b.spent, defaultSortOrder: "descend" }, { title: zh ? "计费调用" : "Billed calls", dataIndex: "calls", align: "right", sorter: (a, b) => a.calls - b.calls }]} /></div>
        </section>
    );
}
