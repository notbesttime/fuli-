"use client";

import { useEffect, useState, type CSSProperties, type RefObject } from "react";
import { Avatar, Dropdown, Empty, Popover, Spin, Tooltip } from "antd";
import { Bell, Keyboard, Languages, LogOut, Settings2, Shield, UserRound, Wallet } from "lucide-react";
import type { ItemType } from "antd/es/menu/interface";
import Link from "next/link";

import { AnimatedThemeToggler } from "@/components/ui/animated-theme-toggler";
import { GitHubLink } from "@/components/layout/github-link";
import { VersionReleaseModal } from "@/components/layout/version-release-modal";
import { CreditSymbol } from "@/constant/credits";
import { consoleText } from "@/lib/console-locale";
import { cn } from "@/lib/utils";
import { canvasThemes } from "@/lib/canvas-theme";
import { fetchCreditLogs, fetchCreditOverview, type CreditLog, type CreditOverview } from "@/services/api/credits";
import { useConsolePreferences } from "@/stores/use-console-preferences";
import { useConfigStore } from "@/stores/use-config-store";
import { useThemeStore } from "@/stores/use-theme-store";
import { useUserStore } from "@/stores/use-user-store";

type UserStatusActionsProps = {
    showConfig?: boolean;
    variant?: "default" | "canvas";
    onOpenShortcuts?: () => void;
    accountOpen?: boolean;
    onAccountOpenChange?: (open: boolean) => void;
    accountRef?: RefObject<HTMLDivElement | null>;
    getPopupContainer?: (node: HTMLElement) => HTMLElement;
};

const formatCredits = (value: number) => value.toLocaleString("zh-CN", { maximumFractionDigits: 4 });
const logLabel = (log: CreditLog) => {
    const labels: Record<string, string> = { redeem: "充值兑换", admin_adjust: "后台调整", ai_consume: "模型调用", ai_refund: "调用返还" };
    return log.remark || labels[log.type] || log.type;
};

export function UserStatusActions({ showConfig = true, variant = "default", onOpenShortcuts, accountOpen, onAccountOpenChange, accountRef, getPopupContainer }: UserStatusActionsProps) {
    const theme = useThemeStore((state) => state.theme);
    const setTheme = useThemeStore((state) => state.setTheme);
    const user = useUserStore((state) => state.user);
    const accessToken = useUserStore((state) => state.token);
    const logout = useUserStore((state) => state.clearSession);
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);
    const locale = useConsolePreferences((state) => state.locale);
    const setLocale = useConsolePreferences((state) => state.setLocale);
    const [overview, setOverview] = useState<CreditOverview | null>(null);
    const [earned, setEarned] = useState<CreditLog[]>([]);
    const [earnedLoading, setEarnedLoading] = useState(false);
    const [noticeOpen, setNoticeOpen] = useState(false);
    const [earnedOpen, setEarnedOpen] = useState(false);
    const userName = user?.displayName || user?.username || "";
    const credits = user?.credits ?? 0;
    const avatarUrl = user?.avatarUrl?.trim();
    const avatarText = (userName.trim()[0] || "U").toUpperCase();
    const naturalIconClass = "inline-flex size-7 shrink-0 items-center justify-center text-stone-600 transition hover:text-stone-950 dark:text-stone-300 dark:hover:text-white [&_svg]:size-4";
    const canvasTheme = canvasThemes[theme];
    const iconStyle: CSSProperties | undefined = variant === "canvas" ? { color: canvasTheme.node.text } : undefined;
    const avatarStyle: CSSProperties | undefined = variant === "canvas" ? { borderColor: canvasTheme.toolbar.border, color: canvasTheme.node.text, background: "transparent" } : undefined;

    useEffect(() => {
        if (!user || !accessToken) { setOverview(null); return; }
        let active = true;
        void fetchCreditOverview(accessToken).then((value) => { if (active) setOverview(value); }).catch(() => { if (active) setOverview(null); });
        return () => { active = false; };
    }, [user?.id, accessToken]);

    async function openEarned(open: boolean) {
        setEarnedOpen(open);
        if (!open || !accessToken) return;
        setEarnedLoading(true);
        try { setEarned((await fetchCreditLogs(accessToken, { page: 1, pageSize: 6, earnedOnly: true })).items); }
        catch { setEarned([]); }
        finally { setEarnedLoading(false); }
    }

    const menuItems: ItemType[] = [
        {
            key: "user", disabled: true,
            label: <div className="max-w-64 py-1">
                <div className="flex items-center gap-2.5">
                    <Avatar size={34} src={avatarUrl ? <img src={avatarUrl} alt={userName} referrerPolicy="no-referrer" /> : undefined}>{avatarText}</Avatar>
                    <div className="min-w-0"><div className="truncate font-medium text-stone-900 dark:text-stone-100">{userName}</div><div className="truncate text-xs text-stone-500">{user?.email || user?.username}</div></div>
                </div>
                <div className="mt-3 grid grid-cols-3 gap-2 border-t border-stone-200 pt-2 text-xs dark:border-stone-700">
                    <div><div className="text-stone-500">{consoleText(locale, "nav.balance")}</div><div className="mt-1 font-semibold tabular-nums text-stone-900 dark:text-stone-100">{formatCredits(credits)}</div></div>
                    <div><div className="text-stone-500">{consoleText(locale, "nav.totalSpent")}</div><div className="mt-1 font-semibold tabular-nums text-stone-900 dark:text-stone-100">{overview ? formatCredits(overview.totalSpent) : "—"}</div></div>
                    <div><div className="text-stone-500">{consoleText(locale, "nav.calls")}</div><div className="mt-1 font-semibold tabular-nums text-stone-900 dark:text-stone-100">{overview ? overview.totalCalls : "—"}</div></div>
                </div>
            </div>
        },
        { key: "profile", icon: <UserRound className="size-4" />, label: <Link href="/profile">{consoleText(locale, "nav.profile")}</Link> },
        ...(user?.role === "admin" ? [{ key: "admin", icon: <Shield className="size-4" />, label: <Link href="/weiyu">{consoleText(locale, "nav.admin")}</Link> }] : []),
        { key: "credits", icon: <Wallet className="size-4" />, label: <Link href="/credits">{consoleText(locale, "nav.recharge")}</Link> },
        ...(onOpenShortcuts ? [{ key: "shortcuts", icon: <Keyboard className="size-4" />, label: consoleText(locale, "nav.shortcuts"), onClick: onOpenShortcuts }] : []),
        { type: "divider" },
        { key: "logout", icon: <LogOut className="size-4" />, label: consoleText(locale, "nav.logout"), onClick: logout },
    ];

    return (
        <div className="inline-flex shrink-0 items-center gap-1">
            {showConfig ? <Tooltip title={consoleText(locale, "nav.config")}><button type="button" className={naturalIconClass} style={iconStyle} onClick={() => openConfigDialog(false)} aria-label={consoleText(locale, "nav.config")}><Settings2 className="size-4" /></button></Tooltip> : null}
            <AnimatedThemeToggler theme={theme} onThemeChange={setTheme} className={naturalIconClass} style={iconStyle} aria-label={theme === "dark" ? "切换到浅色主题" : "切换到深色主题"} title={theme === "dark" ? "切换到浅色主题" : "切换到深色主题"} />
            <span className="hidden sm:inline-flex"><VersionReleaseModal style={iconStyle} /></span>
            <GitHubLink className={cn("bg-transparent hover:bg-transparent dark:hover:bg-transparent", "hidden size-7 text-base sm:inline-flex")} style={iconStyle} />
            <Popover trigger="click" placement="bottomRight" open={noticeOpen} onOpenChange={setNoticeOpen} content={<div className="w-64"><div className="mb-2 text-sm font-medium">{consoleText(locale, "nav.notifications")}</div><Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={consoleText(locale, "nav.noNotifications")} /></div>}>
                <button type="button" className={naturalIconClass} style={iconStyle} title={consoleText(locale, "nav.notifications")} aria-label={consoleText(locale, "nav.notifications")}><Bell className="size-4" /></button>
            </Popover>
            <Dropdown menu={{ items: [{ key: "zh-CN", label: "简体中文", onClick: () => setLocale("zh-CN") }, { key: "en-US", label: "English", onClick: () => setLocale("en-US") }] }} trigger={["click"]} placement="bottomRight">
                <button type="button" className={naturalIconClass} style={iconStyle} title={consoleText(locale, "nav.language")} aria-label={consoleText(locale, "nav.language")}><Languages className="size-4" /></button>
            </Dropdown>
            {user ? (
                <Popover trigger="hover" placement="bottomRight" open={earnedOpen} onOpenChange={openEarned} content={<div className="w-72">
                    <div className="mb-3 flex items-center justify-between gap-2"><span className="text-sm font-semibold">{locale === "zh-CN" ? "最近获得的算力" : "Recently earned credits"}</span><Link href="/credits" className="text-xs text-sky-600">{locale === "zh-CN" ? "查看全部" : "View all"}</Link></div>
                    {earnedLoading ? <div className="py-5 text-center"><Spin size="small" /></div> : earned.length ? <div className="space-y-3">{earned.map((item) => <div key={item.id} className="flex items-start justify-between gap-3"><div className="min-w-0"><div className="truncate text-sm">{logLabel(item)}</div><div className="mt-0.5 text-xs text-stone-500">{new Date(item.createdAt).toLocaleString(locale)}</div></div><span className="shrink-0 text-sm font-semibold tabular-nums text-emerald-600">+{formatCredits(item.amount)}</span></div>)}</div> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={locale === "zh-CN" ? "暂无算力获得记录" : "No credits earned yet"} />}
                </div>}>
                    <Link href="/credits" className="hidden h-8 shrink-0 items-center gap-1.5 px-1.5 text-xs font-medium tabular-nums sm:flex text-stone-600 opacity-80 transition hover:opacity-100 dark:text-stone-300" aria-label={`${consoleText(locale, "nav.balance")} ${formatCredits(credits)}`}><CreditSymbol className="text-sm leading-none" /><span>{formatCredits(credits)}</span></Link>
                </Popover>
            ) : null}
            {!user && onOpenShortcuts ? <button type="button" className={naturalIconClass} style={iconStyle} onClick={onOpenShortcuts} aria-label={consoleText(locale, "nav.shortcuts")} title={consoleText(locale, "nav.shortcuts")}><Keyboard className="size-4" /></button> : null}
            {!user ? <Link href="/login" className="px-1.5 text-sm font-medium text-stone-600 underline-offset-4 transition hover:text-stone-950 hover:underline dark:text-stone-300 dark:hover:text-stone-100" style={iconStyle}>{consoleText(locale, "nav.login")}</Link> : null}
            {user ? <div ref={accountRef}><Dropdown open={accountOpen} onOpenChange={onAccountOpenChange} trigger={["click"]} placement="bottomRight" getPopupContainer={getPopupContainer} styles={{ root: { minWidth: 270 } }} menu={{ items: menuItems }}><button type="button" className="flex size-7 shrink-0 items-center justify-center rounded-full bg-transparent p-0 text-[0] leading-[0] transition" aria-label="账户菜单"><Avatar size={24} src={avatarUrl ? <img src={avatarUrl} alt={userName} referrerPolicy="no-referrer" /> : undefined} alt={userName} className="!flex !items-center !justify-center border border-stone-300 bg-transparent text-[11px] font-semibold text-stone-800 transition hover:border-stone-500 hover:text-stone-950 dark:border-stone-700 dark:text-stone-100 dark:hover:border-stone-400 dark:hover:text-white" style={avatarStyle}>{avatarText}</Avatar></button></Dropdown></div> : null}
        </div>
    );
}
