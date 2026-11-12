/*
 * Copyright (C) 2023-2026 QuantumNous
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * Adapted from new-api-hcnsec@52683df93460569c6aead266aa5d96c3f44d3912
 * web/src/features/dashboard/lib/charts.ts (area, pie, rank specifications).
 * Changes: use credit ledger aggregates directly; no gateway quota conversion.
 */
import type { IAreaChartSpec, IBarChartSpec, IPieChartSpec } from "@visactor/vchart";
import type { CreditOverview } from "@/services/api/credits";

export function creditChartSpecs(data: CreditOverview, metric: "spent" | "calls", trendType: "area" | "bar", modelType: "pie" | "bar", locale: string, dark: boolean) {
    const zh = locale === "zh-CN";
    const label = metric === "spent" ? (zh ? "消耗算力点" : "Credits used") : (zh ? "计费调用" : "Billed calls");
    const format = (value: number) => value.toLocaleString(locale, { maximumFractionDigits: metric === "spent" ? 4 : 0 });
    const common = { theme: dark ? "dark" : "light", background: "transparent", animation: false, color: ["#38bdf8", "#34d399", "#a78bfa", "#fbbf24", "#fb7185", "#22d3ee"], padding: { top: 16, right: 18, bottom: 12, left: 12 } };
    const ordered = [...data.modelSpending].sort((a, b) => b[metric] - a[metric]);
    const models = ordered.slice(0, 10).map((item) => ({ Model: item.model, value: item[metric] }));
    if (ordered.length > 10) models.push({ Model: zh ? "其他" : "Other", value: ordered.slice(10).reduce((sum, item) => sum + item[metric], 0) });
    const trend: IAreaChartSpec | IBarChartSpec = {
        ...common,
        type: trendType,
        data: [{ id: "credit-trend", values: data.dailySpending.map((item) => ({ Time: item.date.slice(5), Usage: item[metric], Model: label })) }],
        xField: "Time", yField: "Usage", seriesField: "Model", stack: false,
        legends: { visible: false },
        area: { style: { fillOpacity: 0.08, curveType: "monotone" } },
        line: { style: { lineWidth: 2, curveType: "monotone" } },
        point: { visible: false },
        axes: [{ orient: "bottom", type: "band", title: { visible: false } }, { orient: "left", type: "linear", min: 0, title: { visible: false }, tick: { noDecimals: metric === "calls" } }],
        tooltip: { mark: { content: [{ key: () => label, value: (datum) => format(Number(datum?.Usage) || 0) }] } },
    };
    const model: IPieChartSpec | IBarChartSpec = modelType === "pie" ? {
        ...common,
        type: "pie", data: [{ id: "models", values: models.filter((item) => item.value > 0) }],
        outerRadius: 0.8, innerRadius: 0.5, padAngle: 0.6, valueField: "value", categoryField: "Model",
        pie: { style: { cornerRadius: 4 }, state: { hover: { outerRadius: 0.85 } } },
        legends: { visible: true, orient: "bottom" }, label: { visible: false },
        tooltip: { mark: { content: [{ key: (datum) => String(datum?.Model || ""), value: (datum) => format(Number(datum?.value) || 0) }] } },
    } : {
        ...common,
        type: "bar", data: [{ id: "models", values: models }],
        xField: "value", yField: "Model", direction: "horizontal", seriesField: "Model",
        legends: { visible: false },
        bar: { style: { cornerRadius: 4 } },
        axes: [{ orient: "left", type: "band", inverse: true, label: { style: { maxLineWidth: 130 } }, title: { visible: false } }, { orient: "bottom", type: "linear", min: 0, title: { visible: false } }],
        tooltip: { mark: { content: [{ key: (datum) => String(datum?.Model || ""), value: (datum) => format(Number(datum?.value) || 0) }] } },
    };
    return { trend, model };
}
