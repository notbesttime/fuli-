"use client";

import Link from "next/link";
import { ArrowLeft, Wallet } from "lucide-react";

import { BillingPreferences } from "@/components/profile/billing-preferences";
import { RechargePanel } from "@/components/recharge/recharge-modal";
import { consoleText } from "@/lib/console-locale";
import { useConsolePreferences } from "@/stores/use-console-preferences";

export default function CreditsPage() {
    const locale = useConsolePreferences((state) => state.locale);
    const t = (key: Parameters<typeof consoleText>[1]) => consoleText(locale, key);

    return (
        <main className="h-full overflow-y-auto">
            <div className="mx-auto max-w-7xl px-5 py-7 sm:px-7">
                <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
                    <div><div className="mb-2 flex items-center gap-2 text-sm text-stone-500"><Wallet className="size-4" />{t("nav.credits")}</div><h1 className="text-2xl font-semibold text-stone-900 dark:text-stone-100">{t("wallet.title")}</h1><p className="mt-1 text-sm text-stone-500">{t("wallet.subtitle")}</p></div>
                    <Link href="/dashboard" className="inline-flex h-9 items-center gap-2 text-sm text-stone-500 transition hover:text-stone-900 dark:hover:text-stone-100"><ArrowLeft className="size-4" />{t("nav.console")}</Link>
                </header>
                <section className="border-t border-stone-200 pt-5 dark:border-stone-800">
                    <RechargePanel />
                </section>
                <div className="mt-8"><BillingPreferences /></div>
            </div>
        </main>
    );
}
