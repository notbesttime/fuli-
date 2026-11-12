"use client";

import { useEffect, useId, useMemo, useRef, useState, type CSSProperties } from "react";
import { Alert, App, Button, Empty, Form, Input, Space, Table, Tabs, Typography, theme } from "antd";
import { Check, Copy, ExternalLink, Flame, RefreshCw } from "lucide-react";
import dayjs from "dayjs";

import { CreditSymbol } from "@/constant/credits";
import { useCopyText } from "@/hooks/use-copy-text";
import { fetchCreditLogs, type CreditLog, type CreditLogList } from "@/services/api/credits";
import { fetchRedeemRecords, redeemCode, type RechargeTier, type RedeemRecord, type RedeemRecordList } from "@/services/api/redeem";
import { normalizeRechargeSetting, safeHttpUrl } from "@/services/api/settings";
import { useConfigStore } from "@/stores/use-config-store";
import { useConsolePreferences } from "@/stores/use-console-preferences";
import { consoleText } from "@/lib/console-locale";
import { useUserStore } from "@/stores/use-user-store";
import styles from "./recharge.module.css";

const formatNumber = (value: number) => value.toLocaleString("zh-CN", { maximumFractionDigits: 4 });
const maskedCode = (code: string) => (/[*•]/.test(code) ? code : code.length > 8 ? code.slice(0, 4) + "****" + code.slice(-4) : "****");
const creditLogTitle = (log: CreditLog, locale: string) => log.remark || ((locale === "zh-CN" ? { redeem: "兑换充值", admin_adjust: "后台调整", ai_consume: "模型调用", ai_refund: "调用返还" } : { redeem: "Code redemption", admin_adjust: "Admin adjustment", ai_consume: "Model usage", ai_refund: "Usage refund" }) as Record<string, string>)[log.type] || log.type;

export function RechargePanel() {
    const { token } = theme.useToken();
    const { message } = App.useApp();
    const copyText = useCopyText();
    const [form] = Form.useForm<{ code: string }>();
    const user = useUserStore((state) => state.user);
    const locale = useConsolePreferences((state) => state.locale);
    const t = (key: Parameters<typeof consoleText>[1]) => consoleText(locale, key);
    const accessToken = useUserStore((state) => state.token);
    const setSession = useUserStore((state) => state.setSession);
    const publicSettings = useConfigStore((state) => state.publicSettings);
    const recharge = useMemo(() => normalizeRechargeSetting(publicSettings?.recharge), [publicSettings?.recharge]);
    const rate = Number(publicSettings?.modelChannel.pricing?.creditRate);
    const [tab, setTab] = useState("shop");
    const [selectedTier, setSelectedTier] = useState<RechargeTier | null>(null);
    const tierGroupName = useId();
    const [redeeming, setRedeeming] = useState(false);
    const redeemInFlight = useRef(false);
    const [redeemed, setRedeemed] = useState<{ amount: number; credits: number } | null>(null);
    const [page, setPage] = useState(1);
    const [records, setRecords] = useState<RedeemRecordList>({ items: [], total: 0 });
    const [loadingRecords, setLoadingRecords] = useState(false);
    const [recordError, setRecordError] = useState("");
    const [recordsVersion, setRecordsVersion] = useState(0);
    const [creditPage, setCreditPage] = useState(1);
    const [creditLogs, setCreditLogs] = useState<CreditLogList>({ items: [], total: 0, summary: { totalSpent: 0, billedRequests: 0 } });
    const [loadingCreditLogs, setLoadingCreditLogs] = useState(false);
    const [creditLogError, setCreditLogError] = useState("");
    const [creditVersion, setCreditVersion] = useState(0);
    const selected = selectedTier ? recharge.tiers.find((tier) => tier.amount === selectedTier.amount && tier.url === selectedTier.url) : null;
    const storeUrl = safeHttpUrl(selectedTier ? selected?.url || "" : recharge.storeUrl);

    useEffect(() => {
        if (!user || !accessToken || tab !== "records") return;
        let canceled = false;
        setLoadingRecords(true);
        setRecordError("");
        void fetchRedeemRecords(accessToken, { page, pageSize: 5 })
            .then((result) => {
                if (!canceled) setRecords(result);
            })
            .catch((error) => {
                if (!canceled) {
                    setRecords({ items: [], total: 0 });
                    setRecordError(error instanceof Error ? error.message : "读取兑换记录失败");
                }
            })
            .finally(() => {
                if (!canceled) setLoadingRecords(false);
            });
        return () => {
            canceled = true;
        };
    }, [recharge.enabled, user?.id, accessToken, tab, page, recordsVersion]);

    useEffect(() => {
        if (!recharge.enabled && (tab === "shop" || tab === "redeem")) setTab("credits");
    }, [recharge.enabled, tab]);

    useEffect(() => {
        if (!user || !accessToken || tab !== "credits") return;
        let canceled = false;
        setLoadingCreditLogs(true);
        setCreditLogError("");
        void fetchCreditLogs(accessToken, { page: creditPage, pageSize: 8 })
            .then((result) => { if (!canceled) setCreditLogs(result); })
            .catch((error) => { if (!canceled) { setCreditLogs({ items: [], total: 0, summary: { totalSpent: 0, billedRequests: 0 } }); setCreditLogError(error instanceof Error ? error.message : t("wallet.error")); } })
            .finally(() => { if (!canceled) setLoadingCreditLogs(false); });
        return () => { canceled = true; };
    }, [user?.id, accessToken, tab, creditPage, creditVersion]);

    async function handleRedeem(values: { code: string }) {
        if (!accessToken || redeemInFlight.current || !recharge.enabled) return;
        redeemInFlight.current = true;
        setRedeeming(true);
        setRedeemed(null);
        try {
            const result = await redeemCode(accessToken, values.code);
            if (useUserStore.getState().token !== accessToken) return;
            setSession(accessToken, result.user);
            setRedeemed({ amount: result.amount, credits: result.credits });
            form.resetFields();
            setPage(1);
            setRecordsVersion((value) => value + 1);
            message.success(locale === "zh-CN" ? "兑换成功，余额已更新" : "Redeemed successfully. Balance updated.");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "兑换失败，请稍后重试");
        } finally {
            redeemInFlight.current = false;
            setRedeeming(false);
        }
    }

    if (!user) return null;

    return (
        <div className="space-y-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <Typography.Text type="secondary">{t("wallet.balance")}</Typography.Text>
                <Space size={4}>
                    <CreditSymbol className="size-4" />
                    <Typography.Text strong>{formatNumber(user.credits)} {t("common.currency")}</Typography.Text>
                </Space>
            </div>
            {!recharge.enabled ? <Alert type="warning" showIcon title={locale === "zh-CN" ? "充值入口暂已关闭，账户历史仍可查看。" : "Top-ups are temporarily disabled. Account history remains available."} /> : null}
            <Tabs
                activeKey={tab}
                onChange={setTab}
                items={[
                    {
                        key: "shop",
                        disabled: !recharge.enabled,
                        label: t("wallet.store"),
                        children: (
                            <div className={styles.shop + " space-y-4"} style={{
                                "--recharge-bg": token.colorBgContainer,
                                "--recharge-bg-soft": token.colorFillQuaternary,
                                "--recharge-text": token.colorText,
                                "--recharge-muted": token.colorTextSecondary,
                                "--recharge-border": token.colorBorderSecondary,
                                "--recharge-primary": token.colorPrimary,
                                "--recharge-primary-text": token.colorPrimaryText,
                                "--recharge-selected": token.colorPrimaryBg,
                                "--recharge-on-primary": token.colorTextLightSolid,
                                "--recharge-hot": token.colorWarning,
                                "--recharge-fire": token.colorError,
                                "--recharge-hot-text": token.colorWarningText,
                                "--recharge-hot-bg": token.colorWarningBg,
                            } as CSSProperties}>
                                {recharge.notice ? <Alert type="info" showIcon title={recharge.notice} /> : null}
                                <fieldset className={styles.tierFieldset} disabled={!recharge.enabled}>
                                    <legend className={styles.tierLegend}>{locale === "zh-CN" ? "选择充值档位" : "Choose a top-up"}</legend>
                                    {recharge.tiers.length ? <div className={styles.tierGrid}>
                                        {recharge.tiers.map((tier, index) => {
                                            const isSelected = selected === tier;
                                            const hot = tier.amount === 1 || tier.amount === 5;
                                            return (
                                                <label key={index} className={styles.tier + (hot ? " " + styles.tierHot : "")}>
                                                    {hot ? <svg className={styles.flameBackdrop} viewBox="0 0 240 240" preserveAspectRatio="none" aria-hidden="true" focusable="false">
                                                        <path fill="currentColor" d="M20 228C0 213 0 183 13 159C18 170 23 170 22 158C15 133 8 115 22 88C23 110 36 116 31 90C25 62 37 37 51 22C45 49 53 62 66 74C62 47 79 23 94 10C86 37 101 49 112 67C106 36 121 15 137 0C129 36 153 45 157 72C164 61 168 43 166 27C188 45 194 64 189 85C203 76 211 61 209 46C230 73 229 98 217 121C228 115 232 106 232 96C245 130 230 149 225 167C222 179 228 181 234 167C246 193 238 217 220 228Z" />
                                                        <path className={styles.flameCore} d="M29 229C9 211 17 189 24 174C24 191 37 192 36 173C29 151 28 128 42 107C38 132 52 143 57 123C49 97 54 80 67 65C64 87 78 101 88 112C84 84 95 64 109 50C103 78 121 88 124 109C130 89 140 72 137 55C158 76 165 91 161 114C176 104 186 89 186 77C199 96 202 114 192 134C208 129 215 116 216 108C224 136 209 152 209 173C214 189 222 183 224 177C234 199 225 218 210 229Z" />
                                                    </svg> : null}
                                                    <input className={styles.tierInput} type="radio" name={tierGroupName} value={index} checked={isSelected} onChange={() => setSelectedTier(tier)} />
                                                    <span className={styles.tierCard}>
                                                        {hot ? <span className={styles.hotBadge}><Flame size={12} aria-hidden="true" />HOT</span> : null}
                                                        <span className={styles.amount}><span>¥</span>{formatNumber(tier.amount)}</span>
                                                        <span className={styles.credits}>
                                                            {Number.isFinite(rate) && rate > 0 ? <>
                                                                <span>{locale === "zh-CN" ? "约" : "~"}</span>
                                                                <strong>{formatNumber(tier.amount / rate)}</strong>
                                                                <span>{t("common.currency")}</span>
                                                            </> : <span>{locale === "zh-CN" ? "算力以兑换结果为准" : "Credits confirmed on redemption"}</span>}
                                                        </span>
                                                        <span className={styles.selection}>
                                                            <span className={styles.selectionMark} aria-hidden="true">{isSelected ? <Check size={12} strokeWidth={3} /> : null}</span>
                                                            {isSelected ? (locale === "zh-CN" ? "已选择" : "Selected") : (locale === "zh-CN" ? "选择此档位" : "Select this tier")}
                                                        </span>
                                                    </span>
                                                </label>
                                            );
                                        })}
                                    </div> : <Empty description={locale === "zh-CN" ? "暂无可选充值档位，请联系管理员" : "No top-up tiers are available. Contact an administrator."} />}
                                </fieldset>
                                <Typography.Paragraph type="secondary" className="mb-0! text-xs">
                                    {locale === "zh-CN" ? "金额与预计算力按当前配置显示，实际结算价格以商品页面为准；购买后请在「兑换码」中兑换。" : "Amounts and estimated credits reflect the current configuration. The product page shows the final price; redeem your code here after purchase."}
                                </Typography.Paragraph>
                                <div className="rounded-lg border p-3" style={{ borderColor: token.colorBorderSecondary, background: token.colorFillQuaternary }}>
                                    <Typography.Text>{locale === "zh-CN" ? "直接联系人工充值更便宜；单笔 ¥" : "Contact support for larger top-ups; orders over ¥"}{formatNumber(recharge.largeAmount)}{locale === "zh-CN" ? " 及以上建议先联系。" : " should be discussed first."}</Typography.Text>
                                    {recharge.contact ? (
                                        <div className="mt-2 flex flex-wrap items-center gap-2">
                                            <Typography.Text className="break-all">{locale === "zh-CN" ? "联系方式：" : "Contact: "}{recharge.contact}</Typography.Text>
                                            <Button size="small" icon={<Copy size={13} />} onClick={() => copyText(recharge.contact, locale === "zh-CN" ? "联系方式已复制" : "Contact copied")}>
                                                {locale === "zh-CN" ? "复制联系方式" : "Copy contact"}
                                            </Button>
                                        </div>
                                    ) : (
                                        <div className="mt-1">
                                            <Typography.Text type="secondary">{locale === "zh-CN" ? "如需人工充值，请联系站点管理员。" : "Contact the site administrator for manual top-ups."}</Typography.Text>
                                        </div>
                                    )}
                                </div>
                                <div className={styles.purchase}>
                                    <div className={styles.purchaseSummary} aria-live="polite" aria-atomic="true">
                                        <Typography.Text strong>{selected ? (locale === "zh-CN" ? "已选 ¥" : "Selected ¥") + formatNumber(selected.amount) + (locale === "zh-CN" ? " 档位" : " tier") : selectedTier ? (locale === "zh-CN" ? "档位配置已更新，请重新选择" : "Top-up options changed. Please choose again.") : (locale === "zh-CN" ? "选择档位，前往购买" : "Choose a tier to purchase")}</Typography.Text>
                                        <Typography.Text type={storeUrl ? "secondary" : "warning"}>
                                            {selected ? (storeUrl ? (locale === "zh-CN" ? "将在新窗口打开此档位对应商品。" : "Opens the product for this tier in a new window.") : (locale === "zh-CN" ? "此档位暂未配置有效商品链接，请联系管理员。" : "No valid product link is configured for this tier. Contact an administrator.")) : selectedTier ? (locale === "zh-CN" ? "请重新选择当前档位后购买。" : "Select a current tier before purchasing.") : storeUrl ? (locale === "zh-CN" ? "也可直接在新窗口浏览小铺。" : "You can also browse the shop in a new window.") : (locale === "zh-CN" ? "暂未配置有效的小铺地址，请选择档位或使用已有兑换码。" : "No valid shop URL is configured. Choose a tier or redeem an existing code.")}
                                        </Typography.Text>
                                    </div>
                                    <Button type="primary" size="large" href={recharge.enabled && storeUrl ? storeUrl : undefined} target="_blank" rel="noopener noreferrer" disabled={!storeUrl || !recharge.enabled} icon={<ExternalLink size={16} />}>
                                        {selected ? (locale === "zh-CN" ? "新窗口购买 ¥" : "Buy ¥") + formatNumber(selected.amount) + (locale === "zh-CN" ? " 档位" : " tier in new window") : (locale === "zh-CN" ? "新窗口打开小铺" : "Open shop in new window")}
                                    </Button>
                                </div>
                                <Typography.Paragraph type="secondary" className="mb-0! text-xs">
                                    {locale === "zh-CN" ? "外部支付订单不会同步到本站，也不会自动增加余额；到账以本站兑换或人工充值结果为准。" : "External orders are not synced or credited automatically; redeem the code here or contact support."}
                                </Typography.Paragraph>
                            </div>
                        ),
                    },
                    {
                        key: "redeem",
                        disabled: !recharge.enabled,
                        label: t("wallet.redeem"),
                        children: (
                            <div className="space-y-4 py-1">
                                <Alert type="info" showIcon title={locale === "zh-CN" ? "已有兑换码？兑换后算力点立即加入当前账号。请勿向他人泄露未使用的兑换码。" : "Redeem a code to add credits to this account. Keep unused codes private."} />
                                <Form form={form} layout="vertical" onFinish={handleRedeem}>
                                    <Form.Item name="code" label={locale === "zh-CN" ? "兑换码" : "Redeem code"} rules={[{ required: true, whitespace: true, message: locale === "zh-CN" ? "请输入兑换码" : "Enter a code" }]}>
                                        <Input placeholder={locale === "zh-CN" ? "粘贴或输入兑换码" : "Paste or enter a redeem code"} autoComplete="off" maxLength={128} disabled={redeeming || !recharge.enabled} />
                                    </Form.Item>
                                    <Button type="primary" htmlType="submit" loading={redeeming} disabled={!recharge.enabled}>
                                        {locale === "zh-CN" ? "确认兑换" : "Redeem"}
                                    </Button>
                                </Form>
                                {redeemed ? (
                                    <Alert
                                        type="success"
                                        showIcon
                                        title={locale === "zh-CN" ? "兑换成功：¥" + formatNumber(redeemed.amount) + "，到账 " + formatNumber(redeemed.credits) + " 算力点" : "Redeemed: ¥" + formatNumber(redeemed.amount) + ", credited " + formatNumber(redeemed.credits)}
                                        action={
                                            <Button size="small" onClick={() => setTab("records")}>
                                                查看记录
                                            </Button>
                                        }
                                    />
                                ) : null}
                            </div>
                        ),
                    },
                    {
                        key: "records",
                        label: t("wallet.redeemHistory"),
                        children: (
                            <div className="space-y-3">
                                <div className="flex items-center justify-between gap-2">
                                    <Typography.Text type="secondary">{t("wallet.redeemNote")}</Typography.Text>
                                    <Button size="small" aria-label={t("wallet.retry")} icon={<RefreshCw size={14} />} loading={loadingRecords} onClick={() => setRecordsVersion((value) => value + 1)} />
                                </div>
                                {recordError ? <Alert type="error" showIcon title={recordError} /> : null}
                                <Table<RedeemRecord>
                                    size="small"
                                    rowKey="id"
                                    loading={loadingRecords}
                                    dataSource={records.items}
                                    scroll={{ x: 520 }}
                                    pagination={{ current: page, pageSize: 5, total: records.total, showSizeChanger: false, onChange: setPage, hideOnSinglePage: true }}
                                    columns={[
                                        { title: t("wallet.maskedCode"), dataIndex: "code", render: (code: string) => <span className="font-mono">{maskedCode(code)}</span> },
                                        { title: t("wallet.price"), dataIndex: "amount", render: (amount: number) => "¥" + formatNumber(amount) },
                                        { title: t("wallet.credits"), dataIndex: "credits", render: formatNumber },
                                        { title: t("wallet.redeemedAt"), dataIndex: "usedAt", render: (value: string | null | undefined) => (value && dayjs(value).isValid() ? dayjs(value).format("YYYY-MM-DD HH:mm") : "—") },
                                    ]}
                                    locale={{ emptyText: t("wallet.redeemEmpty") }}
                                />
                            </div>
                        ),
                    },
                    {
                        key: "credits",
                        label: t("wallet.creditHistory"),
                        children: (
                            <div className="space-y-3">
                                <div className="flex items-center justify-between gap-2">
                                    <Typography.Text type="secondary">{locale === "zh-CN" ? "包括充值、后台调整、模型消耗与返还。" : "Top-ups, admin adjustments, model usage and refunds."}</Typography.Text>
                                    <Button size="small" aria-label={t("wallet.retry")} icon={<RefreshCw size={14} />} loading={loadingCreditLogs} onClick={() => setCreditVersion((value) => value + 1)} />
                                </div>
                                {creditLogError ? <Alert type="error" showIcon title={creditLogError} /> : null}
                                <Table<CreditLog>
                                    size="small"
                                    rowKey="id"
                                    loading={loadingCreditLogs}
                                    dataSource={creditLogs.items}
                                    scroll={{ x: 620 }}
                                    pagination={{ current: creditPage, pageSize: 8, total: creditLogs.total, showSizeChanger: false, onChange: setCreditPage, hideOnSinglePage: true }}
                                    columns={[
                                        { title: t("common.type"), dataIndex: "remark", render: (_remark: string, record: CreditLog) => creditLogTitle(record, locale) },
                                        { title: t("wallet.amount"), dataIndex: "amount", render: (amount: number) => <span className={amount >= 0 ? "text-emerald-600" : "text-stone-700 dark:text-stone-300"}>{amount > 0 ? "+" : ""}{formatNumber(amount)}</span> },
                                        { title: t("wallet.afterBalance"), dataIndex: "balance", render: formatNumber },
                                        { title: t("wallet.time"), dataIndex: "createdAt", render: (value: string) => (value && dayjs(value).isValid() ? dayjs(value).format("YYYY-MM-DD HH:mm") : "—") },
                                    ]}
                                    locale={{ emptyText: t("wallet.empty") }}
                                />
                            </div>
                        ),
                    },
                ]}
            />
        </div>
    );
}
