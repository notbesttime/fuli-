"use client";

import { ChevronDown, ChevronUp, LayoutGrid, Search, Table2 } from "lucide-react";
import { useDeferredValue, useEffect, useMemo, useState } from "react";
import type { CSSProperties, ComponentProps, ReactNode } from "react";
import { Empty, Input, Spin, Table, Tag, Typography } from "antd";
import type { MarketBillingMode, MarketFilters, MarketGroupPrice, MarketListing, MarketModel } from "@/constant/model-market";
import { buildMarketListings, buildMarketModels, filterMarketListings, formatMarketPrice, marketBillingModeLabels, marketBillingUnit, marketEndpointLabels, marketFacetEnabled, marketPlatform } from "@/constant/model-market";
import { useConfigStore } from "@/stores/use-config-store";
import { doneNavigationProgress, startNavigationProgress } from "@/components/layout/navigation-progress";

const chipColors = ["#a52a2a", "#0f766e", "#1d4ed8", "#7e22ce", "#a16207", "#be185d", "#166534"];

function chipColor(value: string) {
    let hash = 0;
    for (const char of value) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
    return chipColors[hash % chipColors.length];
}

const smallTagStyle: CSSProperties = { fontSize: 10, lineHeight: "16px", padding: "0 6px", margin: 0 };

function SmallTag(props: ComponentProps<typeof Tag>) {
    return <Tag {...props} style={{ ...smallTagStyle, ...(props.style || {}) }} />;
}

function renderPrice(price: number, mode: MarketBillingMode) {
    if (price <= 0) return <Typography.Text type="secondary">未定价</Typography.Text>;
    return (
        <span className="whitespace-nowrap tabular-nums">
            <span className="font-medium">{formatMarketPrice(price)}</span>
            <span className="ml-1 text-xs text-[var(--ant-color-text-secondary)]">{marketBillingUnit(mode)}</span>
        </span>
    );
}

function renderPriceBreakdown(model: MarketModel, group: MarketGroupPrice, actual: boolean) {
    if (actual && !group.available) return <SmallTag>暂无渠道</SmallTag>;
    return (
        <div className="space-y-1">
            <div><span className="mr-1 text-xs text-[var(--ant-color-text-tertiary)]">通用</span>{renderPrice(actual ? group.price || 0 : model.basePrice, model.billingMode)}</div>
            {group.resolutions.map((resolution) => (
                <div key={resolution.resolution} className="whitespace-nowrap">
                    <span className="mr-1 text-xs text-[var(--ant-color-text-tertiary)]">{resolution.resolution.toUpperCase()}</span>
                    {renderPrice(actual ? resolution.price || 0 : resolution.basePrice, resolution.billingMode)}
                </div>
            ))}
        </div>
    );
}

type ChipOption = { value: string; label: string; count?: number; suffix?: string; accent?: string; disabled?: boolean };

function Chips({ value, options, onChange }: { value: string; options: ChipOption[]; onChange: (value: string) => void }) {
    return (
        <div className="flex flex-wrap items-center gap-1.5">
            {options.map((option) => {
                const active = option.value === value;
                const cls = "inline-flex items-center rounded-md px-2 py-0.5 text-xs leading-5 font-medium transition " +
                    (active
                        ? "bg-[var(--ant-color-primary)] text-[var(--ant-color-text-light-solid)] shadow-sm"
                        : "bg-[var(--ant-color-fill-secondary)] text-[var(--ant-color-text)] hover:bg-[var(--ant-color-fill)]") +
                    (option.disabled ? " cursor-not-allowed opacity-50" : "");
                return (
                    <button
                        key={option.value}
                        type="button"
                        aria-pressed={active}
                        disabled={option.disabled}
                        title={option.disabled ? "当前筛选条件下没有匹配结果" : undefined}
                        onClick={() => onChange(option.value)}
                        className={cls}
                    >
                        {option.accent ? <span className="mr-1 inline-block size-2 rounded-full" style={{ backgroundColor: option.accent }} /> : null}
                        <span>{option.label}</span>
                        {option.suffix ? <span className="ml-1 text-[10px] font-normal opacity-70">{option.suffix}</span> : null}
                        {typeof option.count === "number" ? <span className="ml-1 text-[10px] font-normal opacity-70">{option.count}</span> : null}
                    </button>
                );
            })}
        </div>
    );
}

function FilterSection({ title, defaultOpen = true, children }: { title: string; defaultOpen?: boolean; children: ReactNode }) {
    const [open, setOpen] = useState(defaultOpen);
    return (
        <section>
            <button
                type="button"
                aria-expanded={open}
                onClick={() => setOpen((value) => !value)}
                className="flex w-full items-center justify-between gap-2 px-1 py-2.5 text-sm font-semibold text-[var(--ant-color-text)]"
            >
                <span>{title}</span>
                {open ? <ChevronUp className="size-4 text-[var(--ant-color-text-secondary)]" /> : <ChevronDown className="size-4 text-[var(--ant-color-text-secondary)]" />}
            </button>
            {open ? <div className="px-1 pb-3">{children}</div> : null}
        </section>
    );
}

function formatRatio(value: number) {
    return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 4, useGrouping: false }).format(value);
}

type ViewMode = "table" | "card";

export default function MarketPage() {
    const publicSettings = useConfigStore((state) => state.publicSettings);
    const isLoading = useConfigStore((state) => state.isPublicSettingsLoading);
    const [keyword, setKeyword] = useState("");
    const [vendorFilter, setVendorFilter] = useState<string>("all");
    const [groupFilter, setGroupFilter] = useState<string>("all");
    const [billingFilter, setBillingFilter] = useState<MarketBillingMode | "all">("all");
    const [endpointFilter, setEndpointFilter] = useState<MarketModel["kind"] | "all">("all");
    const [viewMode, setViewMode] = useState<ViewMode>("table");
    useEffect(() => {
        if (isLoading) startNavigationProgress();
        else doneNavigationProgress();
    }, [isLoading]);
    const modelChannel = publicSettings?.modelChannel;
    const groups = modelChannel?.pricing?.groups?.length ? modelChannel.pricing.groups : [{ id: "default", name: "默认分组", ratio: 1, desc: "" }];
    const models = useMemo(() => buildMarketModels(modelChannel?.modelCosts, modelChannel?.pricing, [...(modelChannel?.availableModels || []), ...(modelChannel?.availableWorkflows || [])], modelChannel?.channels), [modelChannel]);
    const listings = useMemo(() => buildMarketListings(models), [models]);
    const deferredKeyword = useDeferredValue(keyword);
    const filters = useMemo<MarketFilters>(() => ({
        platform: vendorFilter,
        groupId: groupFilter,
        ratio: "all",
        billingMode: billingFilter,
        endpoint: endpointFilter,
        keyword: deferredKeyword,
    }), [vendorFilter, groupFilter, billingFilter, endpointFilter, deferredKeyword]);
    const filteredListings = useMemo(() => filterMarketListings(listings, filters), [listings, filters]);
    const visibleGroupIds = useMemo(() => new Set(filteredListings.map((entry) => entry.group.id)), [filteredListings]);
    const visibleGroups = [...groups].filter((group) => visibleGroupIds.has(group.id)).sort((a, b) => a.ratio - b.ratio || a.name.localeCompare(b.name));
    const vendors = [...new Set(listings.map(({ model }) => marketPlatform(model)))].sort((a, b) => a.localeCompare(b));
    const endpoints = [...new Set(models.map((model) => model.kind))];
    const billingModes: MarketBillingMode[] = ["image", "second", "request"];
    const visibleModelCount = new Set(filteredListings.map(({ model }) => model.model)).size;
    const totalModelCount = models.length;
    const filtering = vendorFilter !== "all" || groupFilter !== "all" || billingFilter !== "all" || endpointFilter !== "all" || deferredKeyword.trim() !== "";

    const vendorCounts = useMemo(() => {
        const byVendor: Record<string, Set<string>> = {};
        for (const { model } of listings) {
            const key = marketPlatform(model);
            if (!byVendor[key]) byVendor[key] = new Set();
            byVendor[key].add(model.model);
        }
        const result: Record<string, number> = {};
        for (const key of Object.keys(byVendor)) result[key] = byVendor[key].size;
        return result;
    }, [listings]);
    const endpointCounts = useMemo(() => {
        const result: Record<string, number> = {};
        for (const model of models) result[model.kind] = (result[model.kind] || 0) + 1;
        return result;
    }, [models]);
    const billingCounts = useMemo(() => {
        const result: Record<string, number> = {};
        for (const model of models) result[model.billingMode] = (result[model.billingMode] || 0) + 1;
        return result;
    }, [models]);

    const filterSections = (
        <>
            <FilterSection title="分组">
                <Chips
                    value={groupFilter}
                    onChange={setGroupFilter}
                    options={[
                        { value: "all", label: "所有分组" },
                        ...groups.map((group) => ({ value: group.id, label: group.name, suffix: "×" + formatRatio(group.ratio), disabled: !marketFacetEnabled(listings, filters, "groupId", group.id) })),
                    ]}
                />
            </FilterSection>
            <FilterSection title="所有供应商">
                <Chips
                    value={vendorFilter}
                    onChange={setVendorFilter}
                    options={[
                        { value: "all", label: "所有供应商", count: totalModelCount },
                        ...vendors.map((vendor) => ({ value: vendor, label: vendor, accent: chipColor(vendor), count: vendorCounts[vendor] || 0, disabled: !marketFacetEnabled(listings, filters, "platform", vendor) })),
                    ]}
                />
            </FilterSection>
            <FilterSection title="计费">
                <Chips
                    value={billingFilter}
                    onChange={(value) => setBillingFilter(value as MarketBillingMode | "all")}
                    options={[
                        { value: "all", label: "全部", count: totalModelCount },
                        ...billingModes.map((mode) => ({ value: mode, label: marketBillingModeLabels[mode], count: billingCounts[mode] || 0, disabled: !marketFacetEnabled(listings, filters, "billingMode", mode) })),
                    ]}
                />
            </FilterSection>
            <FilterSection title="端点">
                <Chips
                    value={endpointFilter}
                    onChange={(value) => setEndpointFilter(value as MarketModel["kind"] | "all")}
                    options={[
                        { value: "all", label: "全部", count: totalModelCount },
                        ...endpoints.map((kind) => ({ value: kind, label: marketEndpointLabels[kind], count: endpointCounts[kind] || 0, disabled: !marketFacetEnabled(listings, filters, "endpoint", kind) })),
                    ]}
                />
            </FilterSection>
        </>
    );

    const renderCard = (entry: MarketListing) => (
        <div key={entry.group.id + ":" + entry.model.model} className="flex h-full flex-col gap-3 rounded-lg border border-[var(--ant-color-border-secondary)] bg-[var(--ant-color-bg-container)] p-4">
            <div className="min-w-0">
                <div className="break-all font-mono text-sm font-semibold">{entry.model.model}</div>
                <div className="mt-1.5 flex flex-wrap items-center gap-1">
                    <SmallTag>{marketPlatform(entry.model)}</SmallTag>
                    <SmallTag>{marketBillingModeLabels[entry.model.billingMode]}</SmallTag>
                    <SmallTag>{marketEndpointLabels[entry.model.kind]}</SmallTag>
                </div>
            </div>
            <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                    <div className="mb-1 text-xs text-[var(--ant-color-text-tertiary)]">基础价</div>
                    {renderPriceBreakdown(entry.model, entry.group, false)}
                </div>
                <div>
                    <div className="mb-1 text-xs text-[var(--ant-color-text-tertiary)]">本组价格</div>
                    {renderPriceBreakdown(entry.model, entry.group, true)}
                </div>
            </div>
            <div className="text-sm">
                <div className="mb-1 text-xs text-[var(--ant-color-text-tertiary)]">可用渠道</div>
                {entry.group.available ? (
                    <div className="flex flex-wrap gap-1">
                        {entry.group.channels.map((channel) => <SmallTag key={channel.id} color="green">{channel.name}</SmallTag>)}
                    </div>
                ) : <SmallTag>暂无渠道</SmallTag>}
            </div>
            {entry.model.tags.length ? <div className="flex flex-wrap gap-1">{entry.model.tags.map((tag) => <SmallTag key={tag}>{tag}</SmallTag>)}</div> : null}
        </div>
    );

    const renderGroupSection = (group: (typeof visibleGroups)[number]) => {
        const groupListings = filteredListings.filter((entry) => entry.group.id === group.id);
        const availableCount = groupListings.filter((entry) => entry.group.available).length;
        return (
            <section key={group.id} className="overflow-hidden rounded-lg border border-[var(--ant-color-border-secondary)] bg-[var(--ant-color-bg-container)]">
                <header className="border-b border-[var(--ant-color-border-secondary)] px-4 py-4 sm:px-5">
                    <div className="flex flex-wrap items-center gap-2">
                        <h2 className="m-0 break-words text-base font-semibold">{group.name}</h2>
                        <SmallTag>×{formatRatio(group.ratio)}</SmallTag>
                        <Typography.Text type="secondary" className="text-xs">{availableCount}/{groupListings.length} 个模型可用</Typography.Text>
                    </div>
                    {group.desc ? <p className="mb-0 mt-2 whitespace-pre-wrap text-sm text-[var(--ant-color-text-secondary)]">{group.desc}</p> : null}
                </header>
                {viewMode === "table" ? (
                    <Table<MarketListing>
                        rowKey={(entry) => entry.group.id + ":" + entry.model.model}
                        size="middle"
                        scroll={{ x: 1160 }}
                        pagination={false}
                        dataSource={groupListings}
                        columns={[
                            {
                                title: "模型",
                                width: 245,
                                render: (_, entry) => (
                                    <div className="min-w-0">
                                        <div className="break-all font-mono text-sm font-medium">{entry.model.model}</div>
                                        <SmallTag className="mt-1">{marketPlatform(entry.model)}</SmallTag>
                                    </div>
                                ),
                            },
                            { title: "计费", width: 90, render: (_, entry) => <SmallTag>{marketBillingModeLabels[entry.model.billingMode]}</SmallTag> },
                            { title: "基础价", width: 185, render: (_, entry) => renderPriceBreakdown(entry.model, entry.group, false) },
                            { title: "本组价格", width: 195, render: (_, entry) => renderPriceBreakdown(entry.model, entry.group, true) },
                            {
                                title: "可用渠道",
                                width: 250,
                                render: (_, entry) => entry.group.available ? (
                                    <div className="space-y-1.5">
                                        {entry.group.channels.map((channel) => (
                                            <div key={channel.id}>
                                                <SmallTag color="green">{channel.name}</SmallTag>
                                                {channel.remark ? <div className="mt-0.5 whitespace-pre-wrap text-xs text-[var(--ant-color-text-secondary)]">{channel.remark}</div> : null}
                                            </div>
                                        ))}
                                    </div>
                                ) : <SmallTag>暂无渠道</SmallTag>,
                            },
                            {
                                title: "标签",
                                width: 180,
                                render: (_, entry) => entry.model.tags.length ? <div className="flex flex-wrap gap-1">{entry.model.tags.map((tag) => <SmallTag key={tag}>{tag}</SmallTag>)}</div> : <Typography.Text type="secondary">—</Typography.Text>,
                            },
                        ]}
                    />
                ) : (
                    <div className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-3">
                        {groupListings.map((entry) => renderCard(entry))}
                    </div>
                )}
            </section>
        );
    };

    return (
        <main className="h-full w-full overflow-y-auto">
            <div className="w-full px-4 py-6 sm:px-6">
                <header className="mb-4">
                    <Typography.Title level={3} className="!mb-1">模型广场</Typography.Title>
                    <Typography.Text type="secondary">查看各调用组可用模型与人民币价格；组内价格会按倍率计算。</Typography.Text>
                </header>

                <div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-[var(--ant-color-border-secondary)] bg-[var(--ant-color-bg-container)] px-4 py-2.5">
                    <span className="text-sm font-semibold">
                        {visibleModelCount} 个模型
                        {filtering && totalModelCount !== visibleModelCount ? <span className="ml-1 text-xs font-normal text-[var(--ant-color-text-tertiary)]">/ 共 {totalModelCount} 个</span> : null}
                    </span>
                    <Input
                        aria-label="搜索模型"
                        allowClear
                        prefix={<Search className="size-4 opacity-60" />}
                        placeholder="搜索模型、厂商或标签"
                        value={keyword}
                        onChange={(event) => setKeyword(event.target.value)}
                        className="w-full max-w-xs"
                    />
                    <div className="ml-auto flex items-center gap-1">
                        <button
                            type="button"
                            aria-label="表格视图"
                            aria-pressed={viewMode === "table"}
                            onClick={() => setViewMode("table")}
                            className={"flex size-8 items-center justify-center rounded-md border transition " + (viewMode === "table" ? "border-[var(--ant-color-primary)] bg-[var(--ant-color-primary)] text-[var(--ant-color-text-light-solid)]" : "border-[var(--ant-color-border)] text-[var(--ant-color-text-secondary)] hover:brightness-95")}
                        >
                            <Table2 className="size-4" />
                        </button>
                        <button
                            type="button"
                            aria-label="卡片视图"
                            aria-pressed={viewMode === "card"}
                            onClick={() => setViewMode("card")}
                            className={"flex size-8 items-center justify-center rounded-md border transition " + (viewMode === "card" ? "border-[var(--ant-color-primary)] bg-[var(--ant-color-primary)] text-[var(--ant-color-text-light-solid)]" : "border-[var(--ant-color-border)] text-[var(--ant-color-text-secondary)] hover:brightness-95")}
                        >
                            <LayoutGrid className="size-4" />
                        </button>
                    </div>
                </div>

                <div className="mb-4 lg:hidden">
                    <details className="overflow-hidden rounded-lg border border-[var(--ant-color-border-secondary)] bg-[var(--ant-color-bg-container)]">
                        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-medium [&::-webkit-details-marker]:hidden">
                            <span>筛选</span>
                            <span className="whitespace-nowrap text-xs font-normal text-[var(--ant-color-text-secondary)]">{visibleModelCount} 个模型 · {visibleGroups.length} 个分组</span>
                        </summary>
                        <div className="divide-y divide-[var(--ant-color-border-secondary)] border-t border-[var(--ant-color-border-secondary)] px-3 py-1">{filterSections}</div>
                    </details>
                </div>

                <div className="flex items-start gap-5">
                    <aside className="sticky top-4 hidden w-64 shrink-0 lg:block">
                        <div className="divide-y divide-[var(--ant-color-border-secondary)] rounded-lg border border-[var(--ant-color-border-secondary)] bg-[var(--ant-color-bg-container)] px-3 py-1">
                            {filterSections}
                        </div>
                    </aside>
                    <section className="min-w-0 flex-1">
                        <Spin spinning={isLoading}>
                            {filteredListings.length === 0 ? (
                                <Empty description={listings.length ? "没有符合条件的模型" : "暂无模型，请稍后查看"} />
                            ) : (
                                <div className="space-y-4">{visibleGroups.map((group) => renderGroupSection(group))}</div>
                            )}
                        </Spin>
                    </section>
                </div>
            </div>
        </main>
    );
}
