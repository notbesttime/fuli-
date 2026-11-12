"use client";

import { useEffect, useState } from "react";
import { App, Button, Radio, Select } from "antd";

import { consoleText } from "@/lib/console-locale";
import { fetchUserPreferences, type BillingStrategy, type UserPreferences } from "@/services/api/credits";
import { useConfigStore } from "@/stores/use-config-store";
import { useConsolePreferences } from "@/stores/use-console-preferences";
import { useUserStore } from "@/stores/use-user-store";

export function BillingPreferences() {
    const { message } = App.useApp();
    const locale = useConsolePreferences((state) => state.locale);
    const t = (key: Parameters<typeof consoleText>[1]) => consoleText(locale, key);
    const user = useUserStore((state) => state.user);
    const token = useUserStore((state) => state.token);
    const savePreferences = useUserStore((state) => state.savePreferences);
    const isSavingPreferences = useUserStore((state) => state.isSavingPreferences);
    const pricingGroups = useConfigStore((state) => state.publicSettings?.modelChannel.pricing?.groups);
    const isSettingsLoading = useConfigStore((state) => state.isPublicSettingsLoading);
    const [preferences, setPreferences] = useState<UserPreferences>({ billingStrategy: "subscription_first", preferredGroup: user?.preferredGroup || "default" });
    const [loading, setLoading] = useState(true);
    const [loadFailed, setLoadFailed] = useState(false);

    useEffect(() => {
        if (!token) {
            setLoading(false);
            return;
        }
        let active = true;
        setLoading(true);
        setLoadFailed(false);
        fetchUserPreferences(token)
            .then((saved) => {
                if (active) setPreferences(saved);
            })
            .catch(() => {
                if (active) {
                    setLoadFailed(true);
                    message.error(t("profile.loadFailed"));
                }
            })
            .finally(() => {
                if (active) setLoading(false);
            });
        return () => {
            active = false;
        };
    }, [token, user?.id]);

    async function saveStrategy() {
        try {
            setPreferences(await savePreferences({ billingStrategy: preferences.billingStrategy }));
            message.success(t("profile.saved"));
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("profile.saveFailed"));
        }
    }

    async function switchGroup(id: string) {
        if (id === group || isSavingPreferences) return;
        try {
            const saved = await savePreferences({ preferredGroup: id });
            setPreferences((current) => ({ ...current, preferredGroup: saved.preferredGroup }));
            message.success(t("profile.groupSaved"));
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("profile.saveFailed"));
        }
    }

    const groups = pricingGroups?.length ? pricingGroups : [{ id: "default", name: t("profile.defaultGroup"), ratio: 1, desc: "" }];
    const group = user?.preferredGroup || preferences.preferredGroup || "default";
    const selectedGroup = groups.find((item) => item.id === group);
    return (
        <section className="max-w-2xl border-t border-stone-200 pt-6 dark:border-stone-800">
            <h2 className="mb-4 text-base font-semibold text-stone-900 dark:text-stone-100">{t("profile.group")}</h2>
            <div className="mb-7">
                <Select
                    aria-label={t("profile.group")}
                    className="w-full sm:max-w-sm"
                    value={group}
                    onChange={(id) => void switchGroup(id)}
                    loading={loading || isSettingsLoading || isSavingPreferences}
                    disabled={!user || loading || isSettingsLoading || isSavingPreferences}
                    options={groups.map((item) => ({ label: item.name + "（×" + item.ratio + "）", value: item.id }))}
                />
                <p className="mb-0 mt-2 text-xs text-stone-500">{t("profile.groupHelp")}</p>
                {selectedGroup?.desc ? <p className="mb-0 mt-2 whitespace-pre-wrap text-sm text-stone-500">{selectedGroup.desc}</p> : null}
            </div>
            <h2 className="mb-2 text-base font-semibold text-stone-900 dark:text-stone-100">{t("profile.strategy")}</h2>
            <p className="mb-4 text-sm text-stone-500">{t("profile.strategyHelp")}</p>
            <Radio.Group
                value={preferences.billingStrategy}
                onChange={(event) => setPreferences((current) => ({ ...current, billingStrategy: event.target.value as BillingStrategy }))}
                disabled={loading || loadFailed || isSavingPreferences}
                className="flex flex-col gap-3"
            >
                <Radio value="subscription_first">{t("profile.subscriptionFirst")}</Radio>
                <Radio value="subscription_only">{t("profile.subscriptionOnly")}</Radio>
                <Radio value="wallet_only">{t("profile.walletOnly")}</Radio>
            </Radio.Group>
            <div className="mt-6">
                <Button type="primary" onClick={() => void saveStrategy()} loading={isSavingPreferences} disabled={!user || loading || loadFailed || isSavingPreferences}>
                    {t("profile.save")}
                </Button>
            </div>
        </section>
    );
}
