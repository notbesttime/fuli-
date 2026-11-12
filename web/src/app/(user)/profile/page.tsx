"use client";

import { useEffect, useState } from "react";
import { App, Avatar, Skeleton } from "antd";
import { CircleUserRound, CreditCard, Mail, UserRound } from "lucide-react";

import { BillingPreferences } from "@/components/profile/billing-preferences";
import { consoleText } from "@/lib/console-locale";
import { fetchCreditOverview, type CreditOverview } from "@/services/api/credits";
import { useConsolePreferences } from "@/stores/use-console-preferences";
import { useUserStore } from "@/stores/use-user-store";

const formatCredits = (value: number) => value.toLocaleString("zh-CN", { maximumFractionDigits: 4 });

export default function ProfilePage() {
    const { message } = App.useApp();
    const locale = useConsolePreferences((state) => state.locale);
    const t = (key: Parameters<typeof consoleText>[1]) => consoleText(locale, key);
    const user = useUserStore((state) => state.user);
    const accessToken = useUserStore((state) => state.token);
    const [overview, setOverview] = useState<CreditOverview | null>(null);

    const [loading, setLoading] = useState(true);


    useEffect(() => {
        if (!accessToken) return;
        let active = true;
        fetchCreditOverview(accessToken)
            .then((summary) => { if (active) setOverview(summary); })
            .catch(() => { if (active) message.error(t("profile.loadFailed")); })
            .finally(() => { if (active) setLoading(false); });
        return () => { active = false; };
    }, [accessToken, user?.id]);


    const avatarText = (user?.displayName || user?.username || "U").slice(0, 1).toUpperCase();


    return (
        <main className="h-full overflow-y-auto">
            <div className="mx-auto max-w-5xl px-5 py-7 sm:px-7">
                <header className="mb-7"><div className="mb-2 flex items-center gap-2 text-sm text-stone-500"><CircleUserRound className="size-4" />{t("nav.profile")}</div><h1 className="text-2xl font-semibold text-stone-900 dark:text-stone-100">{t("profile.title")}</h1><p className="mt-1 text-sm text-stone-500">{t("profile.subtitle")}</p></header>
                <section className="mb-8 flex flex-wrap items-center gap-4 border-b border-stone-200 pb-6 dark:border-stone-800">
                    <Avatar size={56} src={user?.avatarUrl || undefined}>{avatarText}</Avatar>
                    <div className="min-w-48 flex-1"><div className="text-lg font-semibold text-stone-900 dark:text-stone-100">{user?.displayName || user?.username}</div><div className="mt-1 text-sm text-stone-500">@{user?.username}</div><div className="mt-2 flex items-center gap-2 text-sm text-stone-500"><Mail className="size-4" />{user?.email || "—"}</div></div>
                    <div className="grid w-full grid-cols-3 gap-3 sm:w-auto">
                        {[
                            { label: t("profile.balance"), value: overview?.balance ?? user?.credits ?? 0, icon: CreditCard },
                            { label: t("profile.totalSpent"), value: overview?.totalSpent ?? 0, icon: CreditCard },
                            { label: t("profile.calls"), value: overview?.totalCalls ?? 0, icon: UserRound },
                        ].map(({ label, value, icon: Icon }) => <div key={label} className="min-w-0 border-l border-stone-200 pl-3 dark:border-stone-800 sm:min-w-24"><div className="flex items-center gap-1.5 text-xs text-stone-500"><Icon className="size-3.5" />{label}</div>{loading ? <Skeleton active paragraph={false} className="mt-2" /> : <div className="mt-2 truncate text-lg font-semibold tabular-nums text-stone-900 dark:text-stone-100">{overview ? formatCredits(value) : label === t("profile.balance") ? formatCredits(user?.credits ?? 0) : "—"}</div>}</div>)}
                    </div>
                </section>
                <BillingPreferences />
            </div>
        </main>
    );
}
