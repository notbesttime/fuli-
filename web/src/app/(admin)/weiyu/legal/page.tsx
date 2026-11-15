"use client";

import { ReloadOutlined, SaveOutlined } from "@ant-design/icons";
import { App, Button, Card, Flex, Input, Space, Switch, Tabs, Typography } from "antd";
import { useEffect, useState } from "react";

import { fetchAdminSettings, saveAdminSettings, type AdminLegalDocument, type AdminSettings } from "@/services/api/admin";
import { useConfigStore } from "@/stores/use-config-store";
import { useUserStore } from "@/stores/use-user-store";

type LegalKey = "terms" | "privacy" | "about";

const legalTabs: { key: LegalKey; label: string; hint: string }[] = [
    { key: "terms", label: "用户协议", hint: "用户注册、使用服务时须同意的条款，启用后前台可查看。" },
    { key: "privacy", label: "隐私政策", hint: "说明收集哪些数据、如何使用与保存，启用后前台可查看。" },
    { key: "about", label: "关于我们", hint: "站点介绍、联系方式与免责声明。" },
];

export default function AdminLegalPage() {
    const token = useUserStore((state) => state.token);
    const { message } = App.useApp();
    const [settings, setSettings] = useState<AdminSettings | null>(null);
    const [activeTab, setActiveTab] = useState<LegalKey>("terms");
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);

    const load = async () => {
        if (!token) return;
        setLoading(true);
        try {
            setSettings(await fetchAdminSettings(token));
        } catch (error) {
            message.error(error instanceof Error ? error.message : "读取配置失败");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        void load();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [token]);

    const document = settings?.public.legal?.[activeTab];

    const updateDocument = (patch: Partial<AdminLegalDocument>) => {
        setSettings((prev) => {
            if (!prev) return prev;
            const legal = prev.public.legal || {};
            return {
                ...prev,
                public: {
                    ...prev.public,
                    legal: { ...legal, [activeTab]: { ...(legal[activeTab] || { title: "", content: "", enabled: false }), ...patch } },
                },
            };
        });
    };

    const save = async () => {
        if (!token || !settings) return;
        const current = settings.public.legal?.[activeTab];
        if (current?.enabled && !(current.content || "").trim()) {
            message.error("启用前请先填写正文内容");
            return;
        }
        setSaving(true);
        try {
            const saved = await saveAdminSettings(token, settings);
            setSettings(saved);
            await useConfigStore.getState().loadPublicSettings().catch(() => undefined);
            message.success("已保存");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "保存失败");
        } finally {
            setSaving(false);
        }
    };

    return (
        <main className="p-3 md:p-6">
            <Flex vertical gap={16}>
                <Card variant="borderless">
                    <Flex justify="space-between" align="center" gap={16} wrap>
                        <Tabs activeKey={activeTab} onChange={(key) => setActiveTab(key as LegalKey)} items={legalTabs.map((item) => ({ key: item.key, label: item.label }))} />
                        <Space>
                            <Button icon={<ReloadOutlined />} loading={loading} onClick={() => void load()}>
                                刷新
                            </Button>
                            <Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={() => void save()}>
                                保存
                            </Button>
                        </Space>
                    </Flex>
                </Card>
                <Card variant="borderless">
                    <Typography.Paragraph type="secondary">{legalTabs.find((item) => item.key === activeTab)?.hint}</Typography.Paragraph>
                    <div className="flex flex-col gap-4">
                        <label className="flex flex-col gap-2">
                            <span className="text-sm">标题</span>
                            <Input value={document?.title || ""} placeholder="留空则使用默认标题" onChange={(event) => updateDocument({ title: event.target.value })} />
                        </label>
                        <label className="flex items-center gap-3">
                            <span className="text-sm">对外可见</span>
                            <Switch
                                checked={document?.enabled === true}
                                onChange={(checked) => {
                                    if (checked && !(document?.content || "").trim()) {
                                        message.warning("请先填写正文再启用");
                                        return;
                                    }
                                    updateDocument({ enabled: checked });
                                }}
                            />
                        </label>
                        <label className="flex flex-col gap-2">
                            <span className="text-sm">正文（支持 Markdown）</span>
                            <Input.TextArea value={document?.content || ""} autoSize={{ minRows: 14, maxRows: 30 }} placeholder="在此填写正文内容" onChange={(event) => updateDocument({ content: event.target.value })} />
                        </label>
                    </div>
                </Card>
            </Flex>
        </main>
    );
}

