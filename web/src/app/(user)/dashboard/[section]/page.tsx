"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { notFound, useParams } from "next/navigation";
import { Activity, ArrowUpRight, BarChart3, Copy, KeyRound, Plus, RefreshCw, ScrollText, Settings2, ShieldCheck, Trash2 } from "lucide-react";
import { Alert, App, Button, Collapse, Empty, Input, Modal, Popconfirm, Select, Skeleton, Tag } from "antd";
import { SummaryCards } from "../components/summary-cards";
import { doneNavigationProgress, startNavigationProgress } from "@/components/layout/navigation-progress";
import { AnalyticsCharts } from "../components/analytics-charts";
import { AnnouncementsPanel } from "../components/announcements-panel";

import { CreditSymbol } from "@/constant/credits";
import { useCopyText } from "@/hooks/use-copy-text";
import { consoleText } from "@/lib/console-locale";
import { fetchCreditOverview, type CreditLog, type CreditOverview } from "@/services/api/credits";
import { createApiKey, fetchApiKeys, revokeApiKey, type ApiKeySummary } from "@/services/api/api-keys";
import { useConsolePreferences } from "@/stores/use-console-preferences";
import { useUserStore } from "@/stores/use-user-store";
import { useConfigStore } from "@/stores/use-config-store";
import { cn } from "@/lib/utils";

const formatCredits = (value: number) => value.toLocaleString("zh-CN", { maximumFractionDigits: 4 });
const logTitle = (log: CreditLog) => log.remark || ({ redeem: "充值兑换", admin_adjust: "后台调整", ai_consume: "模型调用", ai_refund: "调用返还" } as Record<string, string>)[log.type] || log.type;
const modelFromExtra = (extra: string) => {
    try { return (JSON.parse(extra) as { model?: string }).model || ""; }
    catch { return ""; }
};

type SectionId = "overview" | "analytics" | "api-keys" | "usage-logs" | "audit-logs";


export default function DashboardPage() {
    const locale = useConsolePreferences((state) => state.locale);
    const accessToken = useUserStore((state) => state.token);
    const user = useUserStore((state) => state.user);
    const pricingGroups = useConfigStore((state) => state.publicSettings?.modelChannel.pricing.groups);
    const selectedGroup = user?.preferredGroup || "default";
    const copyText = useCopyText();
    const [data, setData] = useState<CreditOverview | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const { section } = useParams<{ section: string }>();
    const active = section as SectionId;
    const { message } = App.useApp();
    const [keys, setKeys] = useState<ApiKeySummary[]>([]);
    const [keysLoading, setKeysLoading] = useState(false);
    const [keysError, setKeysError] = useState("");
    const [keyCreating, setKeyCreating] = useState(false);
    const [revokingId, setRevokingId] = useState("");
    const [keyModalOpen, setKeyModalOpen] = useState(false);
    const [keyName, setKeyName] = useState("");
    const [keyGroup, setKeyGroup] = useState<string>("");
    const [revealedSecret, setRevealedSecret] = useState("");

    const load = useCallback(async () => {
        if (!accessToken) return;
        setLoading(true);
        setError("");
        try {
            const result = await fetchCreditOverview(accessToken);
            if (useUserStore.getState().token === accessToken) setData(result);
        }
        catch (reason) { if (useUserStore.getState().token === accessToken) setError(reason instanceof Error ? reason.message : "读取控制台数据失败"); }
        finally { if (useUserStore.getState().token === accessToken) setLoading(false); }
    }, [accessToken]);

    const loadKeys = useCallback(async () => {
        if (!accessToken) { setKeys([]); setKeysLoading(false); return; }
        setKeysLoading(true);
        setKeysError("");
        try {
            const result = await fetchApiKeys(accessToken);
            if (useUserStore.getState().token === accessToken) setKeys(result.items);
        } catch (reason) {
            if (useUserStore.getState().token === accessToken) setKeysError(reason instanceof Error ? reason.message : "读取 API 密钥失败");
        } finally {
            if (useUserStore.getState().token === accessToken) setKeysLoading(false);
        }
    }, [accessToken]);

    useEffect(() => { setData(null); setKeys([]); setRevealedSecret(""); void load(); }, [load]);
    useEffect(() => {
        if (!accessToken) { doneNavigationProgress(); return; }
        if (loading || keysLoading) startNavigationProgress();
        else doneNavigationProgress();
    }, [accessToken, loading, keysLoading]);
    useEffect(() => { if (active === "api-keys") void loadKeys(); else setRevealedSecret(""); }, [active, loadKeys]);

    const t = (key: Parameters<typeof consoleText>[1]) => consoleText(locale, key);
    const groups = useMemo(() => (pricingGroups || []).map((group) => ({ value: group.id, label: `${group.name}（×${group.ratio}）` })), [pricingGroups]);
    const sections = [
        { id: "overview" as const, label: t("dashboard.overviewSection"), icon: BarChart3, available: true },
        { id: "analytics" as const, label: t("dashboard.analyticsSection"), icon: Activity, available: true },
        { id: "api-keys" as const, label: t("dashboard.apiKeys"), icon: KeyRound, available: true },
        { id: "usage-logs" as const, label: t("dashboard.usageLogs"), icon: ScrollText, available: true },
        { id: "audit-logs" as const, label: t("dashboard.auditLogs"), icon: ShieldCheck, available: true },
    ];

    const current = sections.find((item) => item.id === active);
    if (!current) notFound();

    async function createKey() {
        if (!accessToken || !keyName.trim() || !keyGroup || keyCreating) return;
        setKeyCreating(true);
        setKeysError("");
        try {
            const created = await createApiKey(accessToken, { name: keyName.trim(), group: keyGroup });
            if (useUserStore.getState().token !== accessToken) return;
            setKeyName("");
            setKeyModalOpen(false);
            setRevealedSecret(created.secret);
            await loadKeys();
        } catch (reason) {
            setKeysError(reason instanceof Error ? reason.message : "创建 API 密钥失败");
        } finally {
            setKeyCreating(false);
        }
    }

    async function deleteKey(id: string) {
        if (!accessToken || revokingId) return;
        setRevokingId(id);
        setKeysError("");
        try {
            await revokeApiKey(accessToken, id);
            setKeys((list) => list.filter((item) => item.id !== id));
            message.success(locale === "zh-CN" ? "密钥已撤销" : "API key revoked");
        } catch (reason) {
            setKeysError(reason instanceof Error ? reason.message : "撤销 API 密钥失败");
        } finally {
            setRevokingId("");
        }
    }

    return (
        <main className="h-full overflow-y-auto">
            <div className="mx-auto max-w-[1440px] px-5 py-7 sm:px-7">
                <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
                    <div><div className="mb-2 flex items-center gap-2 text-sm text-stone-500"><BarChart3 className="size-4" />{t("nav.console")}</div><h1 className="text-2xl font-semibold text-stone-900 dark:text-stone-100">{current.label}</h1><p className="mt-1 text-sm text-stone-500">{t("dashboard.subtitle")}</p></div>
                    <Button icon={<RefreshCw size={15} />} onClick={() => { void load(); if (active === "api-keys") void loadKeys(); void useConfigStore.getState().loadPublicSettings(); }} loading={loading || (active === "api-keys" && keysLoading)}>{locale === "zh-CN" ? "刷新" : "Refresh"}</Button>
                </header>
                {error ? <Alert className="mb-5" type="error" showIcon title={error} action={<Button size="small" onClick={() => void load()}>{t("wallet.retry")}</Button>} /> : null}
                <div className="flex flex-col gap-6 lg:flex-row">
                    <nav aria-label={t("nav.console")} className="flex shrink-0 gap-1 overflow-x-auto border-b pb-2 lg:sticky lg:top-0 lg:w-44 lg:flex-col lg:self-start lg:border-b-0 lg:pb-0 lg:pr-3">
                        <span className="hidden px-3 py-2 text-xs text-muted-foreground lg:block">{locale === "zh-CN" ? "常规" : "General"}</span>
                        {sections.map(({ id, label, icon: Icon, available }) => (
                            <Link
                                key={id}
                                href={"/dashboard/" + id}
                                aria-current={active === id ? "page" : undefined}
                                className={cn(
                                    "flex h-10 shrink-0 items-center gap-2.5 rounded-md px-3 text-sm transition",
                                    active === id ? "bg-stone-100 font-medium text-stone-950 dark:bg-stone-800 dark:text-white" : "text-stone-600 hover:bg-stone-50 dark:text-stone-300 dark:hover:bg-stone-900",
                                    !available && "cursor-not-allowed text-stone-400 hover:bg-transparent dark:text-stone-600",
                                )}
                            >
                                <Icon className="size-4 shrink-0" />
                                <span className="whitespace-nowrap">{label}</span>
                            </Link>
                        ))}
                    </nav>
                    <div className="min-w-0 flex-1">
                        {active === "overview" ? (
                            <section aria-label={t("dashboard.overviewSection")} className="space-y-5">
                                <SummaryCards data={data} loading={loading} />
                                <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_20rem]">
                                    <div className="space-y-5">
                                        <div className="rounded-2xl border bg-card p-5">
                                            <h2 className="text-base font-semibold">{locale === "zh-CN" ? "开始创作" : "Start creating"}</h2>
                                            <p className="mt-1 text-sm text-muted-foreground">{locale === "zh-CN" ? "选模型、准备算力，在画布里开始你的下一幅作品。" : "Choose a model, add credits and start your next work on the canvas."}</p>
                                            <div className="mt-5 grid gap-3 sm:grid-cols-3">
                                                {[{ href: "/market", icon: BarChart3, title: locale === "zh-CN" ? "浏览模型" : "Explore models", description: locale === "zh-CN" ? "查看模型与分组价格" : "Models and group pricing" }, { href: "/credits", icon: CreditSymbol, title: t("dashboard.goCredits"), description: locale === "zh-CN" ? "选购卡密或使用兑换码" : "Buy or redeem a code" }, { href: "/canvas", icon: ArrowUpRight, title: locale === "zh-CN" ? "打开画布" : "Open canvas", description: locale === "zh-CN" ? "创建并管理你的作品" : "Create and manage your work" }].map(({ href, icon: Icon, title, description }, index) => <Link key={href} href={href} className="group rounded-xl border bg-background/60 p-4 transition hover:bg-muted/60"><span className="flex items-center justify-between"><Icon className="size-5 text-muted-foreground" /><span className="text-xs text-muted-foreground">0{index + 1}</span></span><span className="mt-4 block text-sm font-medium">{title}</span><span className="mt-1 block text-xs leading-5 text-muted-foreground">{description}</span></Link>)}
                                            </div>
                                        </div>
                                        <div className="rounded-2xl border bg-card p-5">
                                            <div className="mb-4 flex items-center justify-between gap-3"><h2 className="text-base font-semibold">{locale === "zh-CN" ? "账户信息" : "Account information"}</h2><Link href="/profile" className="text-sm text-muted-foreground hover:text-foreground"><Settings2 size={16} /></Link></div>
                                            <dl className="grid gap-4 text-sm sm:grid-cols-2"><div><dt className="text-xs text-muted-foreground">{t("dashboard.group")}</dt><dd className="mt-1.5 font-medium">{pricingGroups?.find((group) => group.id === selectedGroup)?.name || selectedGroup}</dd></div><div><dt className="text-xs text-muted-foreground">{t("profile.email")}</dt><dd className="mt-1.5 break-all">{user?.email || "—"}</dd></div></dl>
                                            <p className="mt-4 text-xs text-muted-foreground">{t("profile.groupHelp")}</p>
                                        </div>
                                        <div className="overflow-hidden rounded-2xl border bg-card"><div className="p-5 pb-2"><h2 className="text-base font-semibold">{locale === "zh-CN" ? "常见问答" : "Frequently asked questions"}</h2><p className="mt-1 text-xs text-muted-foreground">{locale === "zh-CN" ? "充值、分组与接口使用说明" : "Top-ups, billing groups and API access"}</p></div><Collapse ghost items={[{ key: "redeem", label: locale === "zh-CN" ? "购买后如何到账？" : "How are purchases credited?", children: locale === "zh-CN" ? "在小铺新窗口购买后，复制订单内的兑换码，到算力页面的「兑换码」中手动兑换。支付订单不会自动增加本站余额。" : "Buy in the external shop, then redeem the code on the Credits page. External payments do not add credits automatically." }, { key: "group", label: locale === "zh-CN" ? "如何切换计费分组？" : "How do billing groups work?", children: t("profile.groupHelp") }, { key: "keys", label: locale === "zh-CN" ? "如何使用 API 密钥？" : "How do API keys work?", children: locale === "zh-CN" ? "密钥创建后完整内容只显示一次；列表保留前缀。每把密钥按创建时选择的计费分组调用模型。" : "The full key is shown once after creation; the list only keeps its prefix. Each key uses the billing group selected at creation."}]} /></div>
                                    </div>
                                    <div className="space-y-5 self-start">
                                        <AnnouncementsPanel />
                                        <aside className="overflow-hidden rounded-2xl border bg-card"><div className="flex items-center justify-between border-b p-5"><h2 className="text-sm font-semibold">{t("dashboard.activity")}</h2><Link href="/dashboard/usage-logs" className="text-xs text-muted-foreground hover:text-foreground">{locale === "zh-CN" ? "查看全部" : "View all"}</Link></div><div className="p-5">{loading && !data ? <Skeleton active paragraph={{ rows: 4 }} /> : data?.recentCreditLogs.length ? <div className="space-y-5">{data.recentCreditLogs.slice(0, 5).map((item) => <div key={item.id} className="flex justify-between gap-3"><div className="min-w-0"><p className="truncate text-sm">{logTitle(item)}</p><p className="mt-1 text-xs text-muted-foreground">{new Date(item.createdAt).toLocaleDateString(locale)}</p></div><span className={cn("shrink-0 text-sm font-semibold tabular-nums", item.amount >= 0 ? "text-emerald-600" : "text-foreground")}>{item.amount > 0 ? "+" : ""}{formatCredits(item.amount)}</span></div>)}</div> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t("dashboard.activityEmpty")} />}</div></aside>
                                    </div>
                                </div>
                            </section>
                        ) : null}
                        {active === "analytics" ? <AnalyticsCharts data={data} loading={loading} /> : null}
                        {active === "api-keys" ? (
                            <section aria-label={t("dashboard.apiKeys")}>
                                {keysError ? <Alert className="mb-4" type="error" showIcon title={keysError} action={<Button size="small" onClick={() => void loadKeys()}>{t("wallet.retry")}</Button>} /> : null}
                                <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                                    <div><h2 className="text-base font-semibold text-stone-900 dark:text-stone-100">{t("dashboard.apiKeys")}</h2><p className="mt-1 text-xs text-stone-500">{t("dashboard.apiKeysEmpty")}</p></div>
                                    <Button type="primary" icon={<Plus size={15} />} onClick={() => { setKeyGroup(selectedGroup); setKeyModalOpen(true); }}>{t("dashboard.apiKeyCreate")}</Button>
                                </div>
                                {keysLoading ? <Skeleton active paragraph={{ rows: 3 }} /> : keys.length ? (
                                    <div className="divide-y divide-stone-200 rounded-md border border-stone-200 dark:divide-stone-800 dark:border-stone-800">
                                        {keys.map((item) => (
                                            <div key={item.id} className="flex flex-wrap items-center justify-between gap-3 p-3">
                                                <div className="min-w-0">
                                                    <div className="flex flex-wrap items-center gap-2"><KeyRound className="size-4 text-stone-400" /><span className="truncate text-sm font-medium text-stone-800 dark:text-stone-200">{item.name}</span><code className="text-xs text-stone-500">{item.prefix}</code><Tag color={item.active ? "green" : "default"}>{item.active ? (locale === "zh-CN" ? "有效" : "Active") : (locale === "zh-CN" ? "已撤销" : "Revoked")}</Tag></div>
                                                    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-stone-500"><Tag>{item.group}</Tag><span>{new Date(item.createdAt).toLocaleString(locale)}</span>{item.lastUsedAt ? <span>{locale === "zh-CN" ? "最近使用" : "Last used"}: {new Date(item.lastUsedAt).toLocaleString(locale)}</span> : null}</div>
                                                </div>
                                                {item.active ? <Popconfirm title={locale === "zh-CN" ? "确定撤销此密钥？撤销后无法恢复。" : "Revoke this key? This cannot be undone."} okText={locale === "zh-CN" ? "撤销" : "Revoke"} cancelText={locale === "zh-CN" ? "取消" : "Cancel"} okButtonProps={{ danger: true, loading: revokingId === item.id }} onConfirm={() => deleteKey(item.id)}><Button size="small" danger icon={<Trash2 size={13} />} disabled={!!revokingId}>{t("dashboard.apiKeyDelete")}</Button></Popconfirm> : null}
                                            </div>
                                        ))}
                                    </div>
                                ) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t("dashboard.apiKeyEmpty")} />}
                                <Modal
                                    title={locale === "zh-CN" ? "创建 API 密钥" : "Create API key"}
                                    open={keyModalOpen}
                                    onCancel={() => { if (!keyCreating) { setKeyModalOpen(false); setKeyName(""); } }}
                                    onOk={createKey}
                                    confirmLoading={keyCreating}
                                    cancelButtonProps={{ disabled: keyCreating }}
                                    okText={locale === "zh-CN" ? "创建" : "Create"}
                                    cancelText={locale === "zh-CN" ? "取消" : "Cancel"}
                                    okButtonProps={{ disabled: !keyName.trim() || !keyGroup }}
                                >
                                    <div className="space-y-3 py-2">
                                        <div>
                                            <div className="mb-1 text-sm text-stone-600 dark:text-stone-300">{t("dashboard.apiKeyName")}</div>
                                            <Input value={keyName} onChange={(event) => setKeyName(event.target.value)} placeholder={locale === "zh-CN" ? "例如：脚本批处理" : "e.g. batch script"} maxLength={40} />
                                        </div>
                                        <div>
                                            <div className="mb-1 text-sm text-stone-600 dark:text-stone-300">{t("dashboard.apiKeyGroup")}</div>
                                            <Select className="w-full" value={keyGroup || undefined} onChange={setKeyGroup} options={groups} placeholder={locale === "zh-CN" ? "选择分组" : "Pick a group"} />
                                            <div className="mt-1 text-xs text-stone-500">{t("profile.groupHelp")}</div>
                                        </div>
                                    </div>
                                </Modal>
                                <Modal
                                    title={locale === "zh-CN" ? "请立即复制密钥" : "Copy your API key now"}
                                    open={!!revealedSecret}
                                    onCancel={() => setRevealedSecret("")}
                                    maskClosable={false}
                                    footer={<Button type="primary" onClick={() => setRevealedSecret("")}>{locale === "zh-CN" ? "完成" : "Done"}</Button>}
                                >
                                    <Alert className="mb-3" type="warning" showIcon title={locale === "zh-CN" ? "完整密钥只显示这一次，请妥善保存。关闭后无法再次查看。" : "The full key is shown only once. Save it now; it cannot be viewed again after closing."} />
                                    <div className="flex gap-2"><Input readOnly value={revealedSecret} /><Button icon={<Copy size={14} />} onClick={() => copyText(revealedSecret, locale === "zh-CN" ? "密钥已复制" : "API key copied")}>{t("dashboard.apiKeyCopy")}</Button></div>
                                </Modal>
                            </section>
                        ) : null}
                        {active === "usage-logs" ? (
                            <section aria-label={t("dashboard.usageLogs")}>
                                <div className="mb-4 flex flex-wrap items-center justify-between gap-4"><div><h2 className="text-base font-semibold text-stone-900 dark:text-stone-100">{t("dashboard.activity")}</h2><p className="mt-1 text-xs text-stone-500">{t("dashboard.usageLogNote")}</p></div><Link href="/credits" className="text-sm text-sky-600 hover:text-sky-700">{t("dashboard.goCredits")}</Link></div>
                                {loading && !data ? <Skeleton active paragraph={{ rows: 4 }} /> : data?.recentCreditLogs.length ? <div className="divide-y divide-stone-200 dark:divide-stone-800">{data.recentCreditLogs.map((item) => <div key={item.id} className="flex flex-wrap items-center justify-between gap-x-5 gap-y-2 py-3"><div className="min-w-0"><div className="truncate text-sm font-medium text-stone-800 dark:text-stone-200">{logTitle(item)}</div><div className="mt-1 text-xs text-stone-500">{new Date(item.createdAt).toLocaleString(locale)}{modelFromExtra(item.extra) ? ` · ${modelFromExtra(item.extra)}` : ""}</div></div><span className={`shrink-0 text-sm font-semibold tabular-nums ${item.amount >= 0 ? "text-emerald-600" : "text-stone-700 dark:text-stone-300"}`}>{item.amount > 0 ? "+" : ""}{formatCredits(item.amount)}</span></div>)}</div> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t("dashboard.activityEmpty")} />}
                            </section>
                        ) : null}
                        {active === "audit-logs" ? (
                            <section aria-label={t("dashboard.auditLogs")}>
                                <h2 className="mb-2 text-base font-semibold text-stone-900 dark:text-stone-100">{t("dashboard.auditLogs")}</h2>
                                <p className="text-sm text-stone-500">{t("dashboard.auditEmpty")}</p>
                            </section>
                        ) : null}
                    </div>
                </div>
                <footer className="mt-8 border-t pt-4 text-center text-xs leading-6 text-muted-foreground">Frontend design and development by <a href="https://github.com/QuantumNous/new-api" target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">New API contributors.</a><span className="mx-2">·</span><a href="https://github.com/yangqi1309134997-coder/new-api-hcnsec" target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">{locale === "zh-CN" ? "参考源码" : "Reference source"}</a><span className="mx-2">·</span><a href="/licenses/new-api.txt" target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">AGPL-3.0</a></footer>
            </div>
        </main>
    );
}