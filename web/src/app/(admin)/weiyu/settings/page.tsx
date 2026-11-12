"use client";

import { CheckCircleOutlined, DeleteOutlined, FormatPainterOutlined, ImportOutlined, LoadingOutlined, PlusOutlined, ReloadOutlined, SaveOutlined } from "@ant-design/icons";
import { json } from "@codemirror/lang-json";
import { App, Button, Card, Col, Drawer, Flex, Form, Input, InputNumber, Modal, Popover, Row, Segmented, Select, Space, Switch, Table, Tabs, Tag, Typography } from "antd";
import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import { DEFAULT_RECHARGE_SETTING, normalizeRechargeSetting } from "@/services/api/settings";
import { EditorView } from "@uiw/react-codemirror";

import { ChannelModelSelectorModal } from "@/components/channel-model-selector-modal";
import { AnnouncementsEditor } from "./components/announcements-editor";
import { videoResolutionOptions } from "@/components/video-settings-panel";
import type { WorkflowChannelSettings } from "@/components/workflow/workflow-channel-pane";
import { useAutoDLWorkflowNames } from "@/hooks/use-autodl-workflow";
import { isWorkflowProtocol, modelChannelApiKeyUrls, modelChannelDefaultBaseUrls, modelChannelProtocolOptions } from "@/lib/model-channel";
import { startTokenDanceOAuth } from "@/lib/tokendance-oauth";
import { fetchAdminSettings, fetchChannelHealth, fetchChannelModels, measureAdminStorageProvider, restoreChannelHealth, saveAdminSettings, testChannelModel, type AdminChannelHealthInfo, type AdminModelChannel, type AdminModelCost, type AdminModelGroup, type AdminSettings, type AdminStorageProvider } from "@/services/api/admin";
import { clearStorageConfigCache as clearMediaStorageConfigCache } from "@/services/file-storage";
import { clearStorageConfigCache as clearImageStorageConfigCache } from "@/services/image-storage";
import { useUserStore } from "@/stores/use-user-store";
import { filterChannelModelsByCapability, useConfigStore, type ModelCapabilities } from "@/stores/use-config-store";

const CodeMirror = dynamic(() => import("@uiw/react-codemirror"), { ssr: false });
const WorkflowChannelPane = dynamic(() => import("@/components/workflow/workflow-channel-pane").then((module) => module.WorkflowChannelPane), { ssr: false });
const jsonEditorTheme = EditorView.theme({
    "&": { backgroundColor: "var(--ant-color-bg-container)", color: "var(--ant-color-text)" },
    ".cm-content": { caretColor: "var(--ant-color-text)", padding: "12px 0" },
    ".cm-line": { padding: "0 18px" },
    ".cm-gutters": { backgroundColor: "var(--ant-color-fill-quaternary)", borderRight: "1px solid var(--ant-color-border)", color: "var(--ant-color-text-tertiary)" },
    ".cm-activeLine": { backgroundColor: "var(--ant-color-fill-quaternary)" },
    ".cm-activeLineGutter": { backgroundColor: "var(--ant-color-fill-quaternary)", color: "var(--ant-color-text)" },
    ".cm-cursor": { borderLeftColor: "var(--ant-color-text)" },
    ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": { backgroundColor: "var(--ant-control-item-bg-active)" },
    ".cm-foldPlaceholder": { backgroundColor: "var(--ant-color-fill-quaternary)", border: "1px solid var(--ant-color-border)", color: "var(--ant-color-text-tertiary)" },
    "&.cm-focused": { outline: "none" },
});

const emptySettings: AdminSettings = {
    public: {
        announcements: [],
        recharge: normalizeRechargeSetting(DEFAULT_RECHARGE_SETTING),
        modelChannel: {
            availableModels: [],
            availableWorkflows: [],
            modelCosts: [],
            pricing: { currency: "CNY", creditRate: 1, groups: [{ id: "default", name: "默认分组", ratio: 1, desc: "" }] },
            channels: [],
            defaultModel: "",
            defaultImageModel: "",
            defaultVideoModel: "",
            defaultTextModel: "",
            systemPrompt: "",
            systemPrompts: { image: "", video: "", text: "", workflow: "", workflowAgent: "" },
            allowCustomChannel: true,
            allowUserRemoteChannel: false,
        },
        auth: { allowRegister: true, emailVerification: false, linuxDo: { enabled: false } },
        storage: { mode: "local_indexeddb", allowUserProvider: false },
    },
    private: { channels: [], channelHealth: { retryTimes: 3, deadCooldownMinutes: 300, rateLimitCooldownSec: 60, upstreamFailureLimit: 5, upstreamCooldownMinutes: 5, timeoutRetry: false }, promptSync: { enabled: true, cron: "0 0 * * *" }, aiLog: { localDirectReportEnabled: false, cleanup: { enabled: false, retentionDays: 14, cron: "0 3 * * *" } }, auth: { linuxDo: { clientId: "", clientSecret: "" } }, storage: { mode: "local_indexeddb", allowUserProvider: false, allowUserGlobalProvider: true, autoSyncAllAssets: false, providers: [], roundRobinCursor: 0, capacityCheck: { enabled: false, cron: "0 */6 * * *" }, capacityLimitBytes: 9 * 1024 * 1024 * 1024 } },
};
const emptyChannel: AdminModelChannel = { id: "", protocol: "openai", name: "", baseUrl: modelChannelDefaultBaseUrls.openai, apiKey: "", models: [], groups: ["default"], weight: 1, timeout: 600, enabled: true, remark: "" };
const emptyS3StorageProvider: AdminStorageProvider = { id: "", name: "", type: "s3", endpoint: "", region: "auto", bucket: "", bucketInHost: false, accessKeyId: "", secretAccessKey: "", publicBaseUrl: "", pathPrefix: "canvas", username: "", password: "", weight: 1, enabled: true, ownerUserId: "", capacityBytes: 0, capacityCheckedAt: "", capacityExceeded: false };
const emptyWebDAVStorageProvider: AdminStorageProvider = { ...emptyS3StorageProvider, name: "", type: "webdav", region: "", allowPrivateNetwork: false };

type SettingsTabKey = "public" | "private";
type EditorMode = "visual" | "json";

export default function AdminSettingsPage() {
    const token = useUserStore((state) => state.token);
    const { message } = App.useApp();
    const [form] = Form.useForm<AdminSettings>();
    const [activeTab, setActiveTab] = useState<SettingsTabKey>("public");
    const [editorMode, setEditorMode] = useState<Record<SettingsTabKey, EditorMode>>({ public: "visual", private: "visual" });
    const [jsonText, setJsonText] = useState<Record<SettingsTabKey, string>>({ public: "", private: "" });
    const [channels, setChannels] = useState<AdminModelChannel[]>([]);
    const [channelForm] = Form.useForm<AdminModelChannel>();
    const [editingChannelIndex, setEditingChannelIndex] = useState<number | null>(null);
    const [isChannelDrawerOpen, setIsChannelDrawerOpen] = useState(false);
    const [workflowChannelDraft, setWorkflowChannelDraft] = useState<AdminModelChannel>(emptyChannel);
    const [testChannelIndex, setTestChannelIndex] = useState<number | null>(null);
    const [testKeyword, setTestKeyword] = useState("");
    const [selectedTestModels, setSelectedTestModels] = useState<string[]>([]);
    const [testingModels, setTestingModels] = useState<string[]>([]);
    const [testResults, setTestResults] = useState<Record<string, { status: "success" | "error"; duration?: string; message: string }>>({});
    const [isModelSelectorOpen, setIsModelSelectorOpen] = useState(false);
    const [isBulkImportOpen, setIsBulkImportOpen] = useState(false);
    const [bulkForm] = Form.useForm<{ namePrefix: string; protocol: AdminModelChannel["protocol"]; baseUrl: string; models: string[]; groups: string[]; keys: string; weight: number; timeout: number }>();
    const bulkPreview = Form.useWatch("keys", bulkForm) || "";
    const [isLoading, setIsLoading] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [measuringProviderIndex, setMeasuringProviderIndex] = useState<number | null>(null);
    const [modelCosts, setModelCosts] = useState<AdminModelCost[]>([]);
    const [pricingGroups, setPricingGroups] = useState<AdminModelGroup[]>(() => defaultPricingGroups.map((group) => ({ ...group })));
    const [knownModels, setKnownModels] = useState<string[]>([]);
    const [channelHealth, setChannelHealth] = useState<Record<string, AdminChannelHealthInfo>>({});
    const announcements = Form.useWatch(["public", "announcements"], form) || [];
    const publicModels = Form.useWatch(["public", "modelChannel", "availableModels"], form) || [];
    const publicVideoModels = useMemo(() => new Set(filterChannelModelsByCapability(channels, "video", publicModels)), [channels, publicModels]);
    const orderedPublicModels = useMemo(() => uniqueModels([
        ...publicVideoModels,
        ...(["audio", "image", "text"] as const).flatMap((capability) => filterChannelModelsByCapability(channels, capability, publicModels)),
        ...publicModels,
    ]), [channels, publicModels, publicVideoModels]);
    const publicWorkflows = Form.useWatch(["public", "modelChannel", "availableWorkflows"], form) || [];
    const storageProviders = Form.useWatch(["private", "storage", "providers"], form) || [];
    const channelProtocol = Form.useWatch("protocol", channelForm);
    const channelBaseUrl = Form.useWatch("baseUrl", channelForm);
    const modelLabel = useAutoDLWorkflowNames([...channels, { protocol: channelProtocol, baseUrl: channelBaseUrl }]);
    const publicModelLabel = (model: string) => modelLabel(model, channels.find((channel) => channel.protocol === "autodl" && channel.models.includes(model)));
    const channelApiKeyUrl = channelProtocol ? modelChannelApiKeyUrls[channelProtocol] : undefined;
    const channelModels = useMemo(() => collectChannelModels(channels), [channels]);
    const channelWorkflows = useMemo(() => collectChannelWorkflows(channels), [channels]);
    const channelTableData = useMemo(() => channels.map((channel, index) => ({ ...channel, _index: index, _rowKey: `${index}-${channel.name}-${channel.baseUrl}` })), [channels]);
    const activeMode = editorMode[activeTab];
    const activeJsonText = jsonText[activeTab];
    const jsonError = activeMode === "json" ? getJsonError(activeJsonText) : "";

    const loadChannelHealth = async () => {
        if (!token) return;
        try {
            const items = await fetchChannelHealth(token);
            setChannelHealth(Object.fromEntries(items.map((item) => [item.id, item])));
        } catch {
            setChannelHealth({});
        }
    };

    const restoreChannelToPool = async (channelId: string) => {
        if (!token) return;
        try {
            await restoreChannelHealth(token, channelId);
            message.success("已放回号池");
            await loadChannelHealth();
        } catch (error) {
            message.error(error instanceof Error ? error.message : "放回失败");
        }
    };

    const loadSettings = async () => {
        if (!token) return;
        setIsLoading(true);
        try {
            const data = normalizeSettings(await fetchAdminSettings(token));
            form.setFieldsValue(data);
            setChannels(data.private.channels);
            void loadChannelHealth();
            setModelCosts(data.public.modelChannel.modelCosts);
            setPricingGroups(data.public.modelChannel.pricing.groups);
            setKnownModels(collectKnownModels(data));
            setJsonText({
                public: JSON.stringify(data.public, null, 2),
                private: JSON.stringify(data.private, null, 2),
            });
        } catch (error) {
            message.error(error instanceof Error ? error.message : "读取设置失败");
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        void loadSettings();
    }, [token]);

    useEffect(() => {
        if (!token) return;
        const url = new URL(window.location.href);
        const flow = url.searchParams.get("tokendance_oauth");
        const storageKey = flow ? `tokendance:oauth-result:${flow}` : "";
        const raw = storageKey ? sessionStorage.getItem(storageKey) : null;
        if (!raw) return;

        try {
            const result = JSON.parse(raw) as {
                key?: string;
                draft?: Partial<AdminModelChannel>;
                editingChannelIndex?: number | null;
            };
            if (!result.key || !result.draft) throw new Error("TokenDance 授权结果不完整");

            const channel = normalizeChannel({ ...result.draft, apiKey: result.key });
            setActiveTab("private");
            setEditingChannelIndex(typeof result.editingChannelIndex === "number" ? result.editingChannelIndex : null);
            channelForm.setFieldsValue(channel);
            setWorkflowChannelDraft(channel);
            setIsChannelDrawerOpen(true);
            rememberModels(channel.models);
            message.success("TokenDance 登录成功，API Key 已填入");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "TokenDance 授权结果读取失败");
        } finally {
            sessionStorage.removeItem(storageKey);
            url.searchParams.delete("tokendance_oauth");
            window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
        }
    }, [channelForm, message, token]);

    const changeTab = (nextTab: SettingsTabKey) => {
        setActiveTab(nextTab);
    };

    const applyPricingGroups = (next: AdminModelGroup[]) => {
        const groups = next.length ? next : defaultPricingGroups.map((group) => ({ ...group }));
        setPricingGroups(groups);
        form.setFieldValue(["public", "modelChannel", "pricing", "groups"], groups);
    };

    const updatePricingGroup = (id: string, patch: Partial<AdminModelGroup>) => {
        applyPricingGroups(updatePricingGroupIn(pricingGroups, id, patch));
    };

    const addPricingGroup = () => {
        const id = `group${pricingGroups.length + 1}`;
        applyPricingGroups([...pricingGroups, { id, name: `分组${pricingGroups.length + 1}`, ratio: 1, desc: "" }]);
    };

    const removePricingGroup = (id: string) => {
        applyPricingGroups(pricingGroups.filter((group) => group.id !== id));
    };

    const saveSettings = async () => {
        if (!token) return;
        const values = await collectSettings(form, editorMode, jsonText, message);
        if (!values) {
            return;
        }
        setIsSaving(true);
        try {
            const saved = normalizeSettings(await saveAdminSettings(token, values));
            clearImageStorageConfigCache();
            clearMediaStorageConfigCache();
            const merged = mergeChannelApiKeys(values.private.channels, saved);
            form.setFieldsValue(merged);
            setChannels(merged.private.channels);
            setModelCosts(merged.public.modelChannel.modelCosts);
            setPricingGroups(merged.public.modelChannel.pricing.groups);
            rememberKnownModels(merged);
            setJsonText({
                public: JSON.stringify(merged.public, null, 2),
                private: JSON.stringify(merged.private, null, 2),
            });
            await useConfigStore.getState().loadPublicSettings().catch(() => undefined);
            message.success("已保存");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "保存失败");
        } finally {
            setIsSaving(false);
        }
    };

    const toggleMode = (tab: SettingsTabKey, nextMode: EditorMode) => {
        if (nextMode === "json") {
            setJsonText((current) => ({
                ...current,
                [tab]: JSON.stringify(tab === "public" ? normalizePublicSetting(form.getFieldValue(["public"]) as Partial<AdminSettings["public"]>) : normalizePrivateSetting(form.getFieldValue(["private"]) as Partial<AdminSettings["private"]>), null, 2),
            }));
            setEditorMode((current) => ({ ...current, [tab]: nextMode }));
            return;
        }
        const parsed = parseTabJson(tab, jsonText[tab]);
        if (!parsed) {
            message.error("JSON 格式不正确");
            return;
        }
        form.setFieldsValue({ [tab]: parsed } as Partial<AdminSettings>);
        if (tab === "private") setChannels((parsed as AdminSettings["private"]).channels);
        if (tab === "public") {
            setModelCosts(normalizeModelCosts((parsed as AdminSettings["public"]).modelChannel.modelCosts || []));
            setPricingGroups(normalizePricingGroups((parsed as Partial<AdminSettings["public"]>).modelChannel?.pricing).groups);
        }
        rememberKnownModels({ ...normalizeSettings(form.getFieldsValue(true) as AdminSettings), [tab]: parsed });
        setEditorMode((current) => ({ ...current, [tab]: nextMode }));
    };

    const formatJson = (tab: SettingsTabKey) => {
        const parsed = parseTabJson(tab, jsonText[tab]);
        if (!parsed) {
            message.error("JSON 格式不正确");
            return;
        }
        if (tab === "public") setModelCosts(normalizeModelCosts((parsed as AdminSettings["public"]).modelChannel.modelCosts || []));
        setJsonText((current) => ({
            ...current,
            [tab]: JSON.stringify(parsed, null, 2),
        }));
    };

    const openChannelDrawer = (index: number | null) => {
        setEditingChannelIndex(index);
        setIsChannelDrawerOpen(true);
        const channel = index === null ? emptyChannel : normalizeChannel(channels[index]);
        channelForm.setFieldsValue(channel);
        setWorkflowChannelDraft(channel);
        rememberModels(channel.models);
    };

    const closeChannelDrawer = () => {
        setIsChannelDrawerOpen(false);
        setEditingChannelIndex(null);
        channelForm.resetFields();
    };

    const loginTokenDance = () => {
        void startTokenDanceOAuth({
            target: "admin",
            draft: channelForm.getFieldsValue(true) as unknown as Record<string, unknown>,
            editingChannelIndex,
        }).catch((error) => message.error(error instanceof Error ? error.message : "TokenDance 登录失败"));
    };

    const saveChannel = async () => {
        const values = await channelForm.validateFields();
        const channel = normalizeChannel(isWorkflowProtocol(values.protocol) ? { ...workflowChannelDraft, ...channelForm.getFieldsValue(true), ...values } : { ...values, modelCapabilities: channelForm.getFieldValue("modelCapabilities"), parameterTranslation: channelForm.getFieldValue("parameterTranslation") });
        if (channel.protocol === "runninghub" && (!channel.baseUrl.trim() || (!channel.apiKey.trim() && editingChannelIndex === null))) {
            message.error("请填写 RunningHub Base URL 和积分 API Key");
            return;
        }
        rememberModels(channel.models);
        const nextChannels = [...channels];
        if (editingChannelIndex === null) nextChannels.push(channel);
        else nextChannels[editingChannelIndex] = channel;
        await persistChannels(nextChannels);
        closeChannelDrawer();
    };

    const fetchChannelModelList = async () => {
        if (!token) return;
        const channel = channelForm.getFieldsValue();
        if (!channel?.baseUrl) {
            message.warning("请先填写接口地址");
            return;
        }
        if (editingChannelIndex === null && !channel?.apiKey) {
            message.warning("请先填写 API Key");
            return;
        }
        return fetchChannelModels(token, { index: editingChannelIndex ?? undefined, channel: normalizeChannel(channel) });
    };

    const openChannelModelSelector = () => setIsModelSelectorOpen(true);

    const closeChannelModelSelector = () => setIsModelSelectorOpen(false);

    const confirmChannelModelSelector = (models: string[], modelCapabilities: ModelCapabilities, parameterTranslation: string) => {
        channelForm.setFieldsValue({ models, modelCapabilities, parameterTranslation });
        rememberModels(models);
        closeChannelModelSelector();
    };

    const openBulkImport = () => {
        bulkForm.setFieldsValue({ namePrefix: "", protocol: "openai", baseUrl: channelBaseUrl || modelChannelDefaultBaseUrls.openai, models: [], groups: ["default"], keys: "", weight: 1, timeout: 600 });
        setIsBulkImportOpen(true);
    };

    const importBulkChannels = async () => {
        const values = await bulkForm.validateFields();
        const parsed = buildBulkChannels(values, channels);
        if (parsed.channels.length === 0) {
            message.warning("没有可导入的 API Key");
            return;
        }
        await persistChannels([...channels, ...parsed.channels]);
        setIsBulkImportOpen(false);
        message.success(`已导入 ${parsed.channels.length} 个渠道${parsed.skipped ? `，跳过 ${parsed.skipped} 个重复 Key` : ""}`);
    };

    function rememberModels(models: string[]) {
        setKnownModels((current) => uniqueModels([...current, ...models]));
    }

    function rememberKnownModels(settings: AdminSettings) {
        rememberModels(collectKnownModels(settings));
    }

    const openTestDialog = (index: number) => {
        const channel = normalizeChannel(channels[index]);
        if (!channel.baseUrl || channel.models.length === 0) {
            message.warning("请先填写接口地址和至少一个模型");
            return;
        }
        setTestChannelIndex(index);
        setTestKeyword("");
        setSelectedTestModels([]);
        setTestingModels([]);
        setTestResults({});
    };

    const closeTestDialog = () => {
        setTestChannelIndex(null);
        setTestKeyword("");
        setSelectedTestModels([]);
        setTestingModels([]);
        setTestResults({});
    };

    const testModelOnline = async (model: string) => {
        if (testChannelIndex === null) return;
        if (!token) return;
        const channel = normalizeChannel(channels[testChannelIndex]);
        setTestingModels((current) => [...current, model]);
        try {
            const startedAt = performance.now();
            const result = await testChannelModel(token, { index: testChannelIndex, channel, model });
            setTestResults((current) => ({ ...current, [model]: { status: "success", duration: `${((performance.now() - startedAt) / 1000).toFixed(2)}s`, message: result } }));
        } catch (error) {
            setTestResults((current) => ({ ...current, [model]: { status: "error", message: error instanceof Error ? error.message : "测试失败" } }));
        } finally {
            setTestingModels((current) => current.filter((item) => item !== model));
        }
    };

    const batchTestModels = async () => {
        for (const model of selectedTestModels) {
            await testModelOnline(model);
        }
    };

    const testChannel = testChannelIndex === null ? null : normalizeChannel(channels[testChannelIndex]);
    const testModels = (testChannel?.models || []).filter((model) => `${model} ${modelLabel(model, testChannel)}`.toLowerCase().includes(testKeyword.trim().toLowerCase()));

    async function persistChannels(nextChannels: AdminModelChannel[]) {
        if (!token) throw new Error("请先登录");
        const values = normalizeSettings(form.getFieldsValue(true) as AdminSettings);
        const nextChannelModels = collectChannelModels(nextChannels);
        const nextChannelWorkflows = collectChannelWorkflows(nextChannels);
        const nextSettings = normalizeSettings({
            ...values,
            public: { ...values.public, modelChannel: { ...values.public.modelChannel, availableModels: filterModels(values.public.modelChannel.availableModels, nextChannelModels), availableWorkflows: filterModels(values.public.modelChannel.availableWorkflows, nextChannelWorkflows.map((item) => item.value)) } },
            private: { ...values.private, channels: nextChannels },
        });
        const saved = normalizeSettings(await saveAdminSettings(token, nextSettings));
        clearImageStorageConfigCache();
        clearMediaStorageConfigCache();
        const merged = mergeChannelApiKeys(nextChannels, saved);
        setChannels(merged.private.channels);
        setModelCosts(merged.public.modelChannel.modelCosts);
        setPricingGroups(merged.public.modelChannel.pricing.groups);
        rememberKnownModels(merged);
        form.setFieldsValue(merged);
        setJsonText({
            public: JSON.stringify(merged.public, null, 2),
            private: JSON.stringify(merged.private, null, 2),
        });
        await useConfigStore.getState().loadPublicSettings().catch(() => undefined);
        message.success("已保存");
    }

    async function measureStorageProviderAt(index: number) {
        if (!token) return;
        const provider = normalizeStorageProvider(form.getFieldValue(["private", "storage", "providers", index]));
        setMeasuringProviderIndex(index);
        try {
            const result = await measureAdminStorageProvider(token, { index, provider });
            const next = normalizeSettings(await fetchAdminSettings(token));
            form.setFieldsValue(next);
            setJsonText({ public: JSON.stringify(next.public, null, 2), private: JSON.stringify(next.private, null, 2) });
            message.success(`容量统计完成：${formatStorageBytes(result.bytes)}${result.overLimit ? "，已达到上限并禁用" : ""}`);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "容量统计失败");
        } finally {
            setMeasuringProviderIndex(null);
        }
    }

    return (
        <main className="p-3 md:p-6">
            <Flex vertical gap={16}>
                <Card variant="borderless">
                    <Flex justify="space-between" align="center" gap={16} wrap>
                        <Tabs
                            activeKey={activeTab}
                            onChange={(key) => changeTab(key as SettingsTabKey)}
                            items={[
                                { key: "public", label: "公开配置（对外暴露）" },
                                { key: "private", label: "私有配置（不会对外暴露）" },
                            ]}
                        />
                        <Space>
                            <Button icon={<ReloadOutlined />} loading={isLoading} onClick={() => void loadSettings()}>
                                刷新
                            </Button>
                            <Button type="primary" icon={<SaveOutlined />} loading={isSaving} onClick={() => void saveSettings()}>
                                保存设置
                            </Button>
                        </Space>
                    </Flex>
                </Card>

                <Card variant="borderless">
                    <Flex justify="space-between" align="center" gap={16} wrap style={{ marginBottom: 16 }}>
                        <Segmented
                            value={activeMode}
                            onChange={(value) => toggleMode(activeTab, value as EditorMode)}
                            options={[
                                { label: "可视化编辑", value: "visual" },
                                { label: "手动编辑 JSON", value: "json" },
                            ]}
                        />
                        {activeMode === "json" ? (
                            <Space>
                                {jsonError ? (
                                    <Tag color="error">{jsonError}</Tag>
                                ) : (
                                    <Tag color="success" icon={<CheckCircleOutlined />}>
                                        JSON 格式正确
                                    </Tag>
                                )}
                                <Button icon={<FormatPainterOutlined />} onClick={() => formatJson(activeTab)}>
                                    格式化
                                </Button>
                            </Space>
                        ) : (
                            <Typography.Text type="secondary">{activeTab === "public" ? "这些配置会暴露给前端读取" : "这些配置只会在后台保存"}</Typography.Text>
                        )}
                    </Flex>

                    {activeTab === "public" ? (
                        activeMode === "visual" ? (
                            <Form form={form} layout="vertical" initialValues={emptySettings} requiredMark={false}>
                                <Row gutter={16}>
                                    <Col span={24}>
                                        <Typography.Title level={5}>系统公告</Typography.Title>
                                        <Form.Item label="站点公告"><AnnouncementsEditor value={announcements} onChange={(items) => form.setFieldValue(["public", "announcements"], items)} /></Form.Item>
                                    </Col>
                                    <Col span={24}>
                                        <Form.Item name={["public", "modelChannel", "availableModels"]} label="系统可用模型(请先在私有配置里配置渠道)" extra="可选项来自已启用渠道中选择的模型，最终开放哪些模型由这里勾选决定">
                                            <Select mode="multiple" showSearch={{ optionFilterProp: ["label", "value"] }} placeholder="请选择系统可用模型" options={channelModels.map((item) => ({ label: publicModelLabel(item), value: item }))} />
                                        </Form.Item>
                                        <Form.Item name={["public", "modelChannel", "availableWorkflows"]} label="系统可用工作流" extra="先在私有渠道启用工作流，再在这里勾选对用户开放的工作流">
                                            <Select mode="multiple" showSearch={{ optionFilterProp: ["label", "value"] }} placeholder="请选择系统可用工作流" options={channelWorkflows} />
                                        </Form.Item>
                                    </Col>
                                    <Col xs={24} md={6}>
                                        <Form.Item name={["public", "modelChannel", "defaultModel"]} label="默认模型">
                                            <Select showSearch={{ optionFilterProp: ["label", "value"] }} allowClear options={publicModels.map((item) => ({ label: publicModelLabel(item), value: item }))} />
                                        </Form.Item>
                                    </Col>
                                    <Col xs={24} md={6}>
                                        <Form.Item name={["public", "modelChannel", "defaultImageModel"]} label="默认图片模型">
                                            <Select showSearch={{ optionFilterProp: ["label", "value"] }} allowClear options={publicModels.map((item) => ({ label: publicModelLabel(item), value: item }))} />
                                        </Form.Item>
                                    </Col>
                                    <Col xs={24} md={6}>
                                        <Form.Item name={["public", "modelChannel", "defaultVideoModel"]} label="默认视频模型">
                                            <Select showSearch={{ optionFilterProp: ["label", "value"] }} allowClear options={publicModels.map((item) => ({ label: publicModelLabel(item), value: item }))} />
                                        </Form.Item>
                                    </Col>
                                    <Col xs={24} md={6}>
                                        <Form.Item name={["public", "modelChannel", "defaultTextModel"]} label="默认文本模型">
                                            <Select showSearch={{ optionFilterProp: ["label", "value"] }} allowClear options={publicModels.map((item) => ({ label: publicModelLabel(item), value: item }))} />
                                        </Form.Item>
                                    </Col>
                                    <Col span={24}>
                                        <Typography.Title level={5}>内置/系统提示词</Typography.Title>
                                        <Row gutter={16}>
                                            <Col xs={24} md={12}>
                                                <Form.Item name={["public", "modelChannel", "systemPrompts", "image"]} label="生图系统提示词">
                                                    <Input.TextArea rows={4} placeholder="会自动追加在生图提示词前，不在输入框中展示" />
                                                </Form.Item>
                                            </Col>
                                            <Col xs={24} md={12}>
                                                <Form.Item name={["public", "modelChannel", "systemPrompts", "video"]} label="视频系统提示词">
                                                    <Input.TextArea rows={4} placeholder="会自动追加在视频提示词前" />
                                                </Form.Item>
                                            </Col>
                                            <Col xs={24} md={12}>
                                                <Form.Item name={["public", "modelChannel", "systemPrompts", "text"]} label="文本/问答系统提示词">
                                                    <Input.TextArea rows={4} placeholder="用于画布问答、AI 文本等文本模型调用" />
                                                </Form.Item>
                                            </Col>
                                            <Col xs={24} md={12}>
                                                <Form.Item name={["public", "modelChannel", "systemPrompts", "workflow"]} label="工作流运行系统提示词">
                                                    <Input.TextArea rows={4} placeholder="用于工作流运行时补充统一创作要求" />
                                                </Form.Item>
                                            </Col>
                                            <Col xs={24}>
                                                <Form.Item name={["public", "modelChannel", "systemPrompts", "workflowAgent"]} label="工作流创建 Agent 系统提示词">
                                                    <Input.TextArea rows={6} placeholder="控制 AI 创建工作流的输出规范和默认参数" />
                                                </Form.Item>
                                            </Col>
                                        </Row>
                                        <Form.Item name={["public", "modelChannel", "systemPrompt"]} hidden>
                                            <Input />
                                        </Form.Item>
                                    </Col>
                                    <Col span={24}>
                                        <Form.Item name={["public", "modelChannel", "allowCustomChannel"]} label="是否允许用户自定义渠道" extra="开启后，前端可提供用户自定义 baseUrl 直连模式" valuePropName="checked">
                                            <Switch />
                                        </Form.Item>
                                    </Col>
                                    <Col span={24}>
                                        <Form.Item name={["public", "modelChannel", "allowUserRemoteChannel"]} label="是否允许普通用户使用云端渠道" extra="关闭后，普通用户只能使用本地直连；管理员仍可使用云端渠道" valuePropName="checked">
                                            <Switch />
                                        </Form.Item>
                                    </Col>
                                    <Col span={24}>
                                        <Form.Item name={["public", "auth", "allowRegister"]} label="是否允许用户注册" extra="关闭后隐藏注册入口，注册接口也会拒绝新用户创建" valuePropName="checked">
                                            <Switch />
                                        </Form.Item>
                                    </Col>
                                    <Col span={24}>
                                        <Typography.Title level={5}>模型／工作流计费</Typography.Title>
                                        <Typography.Paragraph type="secondary" className="!mb-3 !text-xs">
                                            单价为人民币参考价；生图按张、视频按秒、工作流按次。前台模型广场按此价格展示。
                                        </Typography.Paragraph>
                                        <Table
                                            rowKey="key"
                                            pagination={false}
                                            size="small"
                                            dataSource={[
                                                ...orderedPublicModels.map((model) => {
                                                    const video = publicVideoModels.has(model);
                                                    return {
                                                        key: model,
                                                        model,
                                                        label: publicModelLabel(model),
                                                        resolution: "",
                                                        kind: "model",
                                                        children: video ? [
                                                            ...modelCosts.filter((cost) => cost.model === model && cost.resolution).map((cost, index) => ({ key: `${model}:${cost.resolution}:${index}`, model, label: "", resolution: cost.resolution || "", kind: "resolution" })),
                                                            { key: `${model}:add`, model, label: "", resolution: "", kind: "add" },
                                                        ] : undefined,
                                                    };
                                                }),
                                                ...channels.flatMap((channel) => isWorkflowProtocol(channel.protocol) ? (channel.workflows || []).filter((entry) => entry.enabled && publicWorkflows.includes(`workflow:system:${channel.id}:${entry.kind}:${entry.workflowId}`)).map((entry) => {
                                                    const model = `workflow:system:${channel.id}:${entry.kind}:${entry.workflowId}`;
                                                    return { key: model, model, label: `${channel.name} · ${entry.title || entry.workflowId}（工作流）`, resolution: "", kind: "workflow" };
                                                }) : []),
                                            ]}
                                            columns={[
                                                {
                                                    title: "模型 / 工作流",
                                                    dataIndex: "model",
                                                    render: (_, item) => item.kind === "resolution" ? (
                                                        <div className="flex items-center gap-2">
                                                            <span>└─</span>
                                                            <Select
                                                                className="!w-32"
                                                                placeholder="选择分辨率"
                                                                value={item.resolution || undefined}
                                                                options={videoResolutionOptions.map((option) => ({ ...option, disabled: option.value !== item.resolution && modelCosts.some((cost) => cost.model === item.model && cost.resolution === option.value) }))}
                                                                onChange={(resolution) => setModelCost(form, setModelCosts, { model: item.model, resolution, previousResolution: item.resolution })}
                                                            />
                                                            <Button danger type="text" icon={<DeleteOutlined />} onClick={() => removeModelCost(form, setModelCosts, item.model, item.resolution)} />
                                                        </div>
                                                    ) : item.kind === "add" ? (
                                                        <div className="flex items-center gap-2">
                                                            <span>└─</span>
                                                            <Button type="link" className="!px-0" icon={<PlusOutlined />} disabled={videoResolutionOptions.every((option) => modelCosts.some((cost) => cost.model === item.model && cost.resolution === option.value))} onClick={() => addModelResolutionCost(form, setModelCosts, item.model)}>
                                                                添加分辨率
                                                            </Button>
                                                        </div>
                                                    ) : (
                                                        <span title={item.label}>{item.label}</span>
                                                    ),
                                                },
                                                {
                                                    title: "计费方式",
                                                    width: 132,
                                                    render: (_, item) => (
                                                        item.kind === "add" ? null : (
                                                            <Select
                                                                className="!w-full"
                                                                value={modelCostMode(modelCosts, item.model, item.kind === "resolution" ? item.resolution : "", item.kind === "workflow" ? "request" : publicVideoModels.has(item.model) ? "second" : "image")}
                                                                options={item.kind === "workflow" ? billingModeOptions.filter((option) => option.value === "request") : item.kind === "resolution" || publicVideoModels.has(item.model) ? [billingModeOptions[1], billingModeOptions[2]] : billingModeOptions}
                                                                onChange={(mode) => setModelCost(form, setModelCosts, { model: item.model, resolution: item.kind === "resolution" ? item.resolution : "", billingMode: mode })}
                                                            />
                                                        )
                                                    ),
                                                },
                                                {
                                                    title: (
                                                        <span className="grid leading-tight">
                                                            <span>单价</span>
                                                            <span className="text-xs font-normal text-[var(--ant-color-text-secondary)]">人民币参考价</span>
                                                        </span>
                                                    ),
                                                    width: 220,
                                                    render: (_, item) => (
                                                        item.kind === "add" ? null : (
                                                            <Space.Compact className="!w-full">
                                                                <InputNumber
                                                                    min={0}
                                                                    step={0.01}
                                                                    precision={2}
                                                                    className="!w-full"
                                                                    value={modelCostPrice(modelCosts, item.model, item.kind === "resolution" ? item.resolution : "")}
                                                                    onChange={(value) => setModelCost(form, setModelCosts, { model: item.model, resolution: item.kind === "resolution" ? item.resolution : "", price: Number(value) || 0 })}
                                                                />
                                                                <span className="flex h-8 items-center rounded-r-md border border-l-0 border-stone-200 bg-stone-50 px-3 text-sm text-stone-500 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-300">
                                                                    {billingUnitLabel(modelCostMode(modelCosts, item.model, item.kind === "resolution" ? item.resolution : "", item.kind === "workflow" ? "request" : publicVideoModels.has(item.model) ? "second" : "image"))}
                                                                </span>
                                                            </Space.Compact>
                                                        )
                                                    ),
                                                },
                                            ]}
                                            expandable={{
                                                showExpandColumn: false,
                                                expandedRowKeys: publicModels.filter((model) => publicVideoModels.has(model)),
                                                indentSize: 16,
                                            }}
                                        />
                                    </Col>
                                    <Col span={24}>
                                        <Typography.Title level={5}>价格分组</Typography.Title>
                                        <Typography.Paragraph type="secondary" className="!mb-3 !text-xs">
                                            所有配置组人人可选、切换立即对新调用生效。倍率应用于基础单价；在私有配置中给渠道绑定所属组，并用说明描述速度或能力差异。
                                        </Typography.Paragraph>
                                        <Table
                                            rowKey="id"
                                            pagination={false}
                                            size="small"
                                            dataSource={pricingGroups}
                                            columns={[
                                                {
                                                    title: "分组名称",
                                                    width: 220,
                                                    render: (_, group) => <Input value={group.name} placeholder="例如 Plus 福利组" onChange={(event) => updatePricingGroup(group.id, { name: event.target.value })} />,
                                                },
                                                {
                                                    title: "分组标识",
                                                    width: 200,
                                                    render: (_, group) => <Input value={group.id} placeholder="例如 vip" onChange={(event) => updatePricingGroup(group.id, { id: event.target.value })} />,
                                                },
                                                {
                                                    title: "价格倍率",
                                                    width: 180,
                                                    render: (_, group) => <InputNumber min={0.01} step={0.05} precision={2} className="!w-full" value={group.ratio} onChange={(value) => updatePricingGroup(group.id, { ratio: Number(value) || 1 })} />,
                                                },
                                                {
                                                    title: "说明",
                                                    render: (_, group) => <Input value={group.desc || ""} placeholder="例如：低价共享渠道，适合日常创作" onChange={(event) => updatePricingGroup(group.id, { desc: event.target.value })} />,
                                                },
                                                {
                                                    title: "",
                                                    width: 60,
                                                    render: (_, group) => <Button danger type="text" icon={<DeleteOutlined />} disabled={pricingGroups.length <= 1} onClick={() => removePricingGroup(group.id)} />,
                                                },
                                            ]}
                                        />
                                        <Button className="!mt-3" icon={<PlusOutlined />} onClick={addPricingGroup}>
                                            添加分组
                                        </Button>
                                    </Col>
                                    <Col span={24} className="!mt-6">
                                        <Typography.Title level={5}>充值设置</Typography.Title>
                                        <Typography.Paragraph type="secondary">
                                            用户在新窗口购买对应档位，付款后复制卡密回站兑换。小铺订单、支付状态由小铺保存，本网站仅保存兑换记录；未填写有效商品链接的档位不能购买。
                                        </Typography.Paragraph>
                                        <Row gutter={16}>
                                            <Col xs={24} md={6}>
                                                <Form.Item name={["public", "recharge", "enabled"]} label="开放充值入口" valuePropName="checked"><Switch /></Form.Item>
                                            </Col>
                                            <Col xs={24} md={18}>
                                                <Form.Item name={["public", "recharge", "storeUrl"]} label="小铺首页链接" rules={[{ pattern: /^https?:\/\/[^\s]+$/i, message: "请填写完整的 http(s) 链接" }]}>
                                                    <Input placeholder="https://wzyp.cn/shop/QKH7GGGF" />
                                                </Form.Item>
                                            </Col>
                                            <Col xs={24} md={12}>
                                                <Form.Item name={["public", "recharge", "contact"]} label="直充联系方式" extra="微信、QQ 等；留空不显示复制按钮。此内容对用户公开。"><Input maxLength={200} placeholder="例如：微信 xxx（请自行填写）" /></Form.Item>
                                            </Col>
                                            <Col xs={24} md={12}>
                                                <Form.Item name={["public", "recharge", "largeAmount"]} label="大额联系门槛（元）" rules={[{ required: true }]}><InputNumber min={0.01} max={1000000} precision={2} className="!w-full" /></Form.Item>
                                            </Col>
                                            <Col span={24}>
                                                <Form.Item name={["public", "recharge", "notice"]} label="直充优惠提示" extra="留空使用默认直充优惠提示。"><Input.TextArea rows={2} maxLength={500} /></Form.Item>
                                            </Col>
                                        </Row>
                                        <Form.List name={["public", "recharge", "tiers"]}>
                                            {(fields, { add, remove }) => <>
                                                <Typography.Text>购买档位（元）与商品链接</Typography.Text>
                                                {fields.map(({ key, name, ...rest }) => <Row key={key} gutter={12} className="!mt-2">
                                                    <Col xs={7} md={4}>
                                                        <Form.Item {...rest} name={[name, "amount"]} rules={[{ required: true, message: "填写金额" }]} className="!mb-2"><InputNumber aria-label="档位金额" min={0.01} max={1000000} precision={2} className="!w-full" /></Form.Item>
                                                    </Col>
                                                    <Col xs={14} md={18}>
                                                        <Form.Item {...rest} name={[name, "url"]} rules={[{ pattern: /^https?:\/\/[^\s]+$/i, message: "仅支持 http(s) 链接" }]} className="!mb-2"><Input aria-label="档位商品链接" placeholder="填写对应商品链接；留空时用户不能购买此档位" /></Form.Item>
                                                    </Col>
                                                    <Col xs={3} md={2}><Button aria-label="删除档位" danger type="text" icon={<DeleteOutlined />} onClick={() => remove(name)} /></Col>
                                                </Row>)}
                                                <Button className="!mt-2" icon={<PlusOutlined />} onClick={() => add({ amount: 1, url: "" })}>添加充值档位</Button>
                                            </>}
                                        </Form.List>
                                    </Col>
                                </Row>
                            </Form>
                        ) : (
                            <div style={{ overflow: "hidden", border: "1px solid var(--ant-color-border)", borderRadius: 6 }}>
                                <CodeMirror
                                    value={activeJsonText}
                                    height="520px"
                                    extensions={[json(), jsonEditorTheme]}
                                    basicSetup={{ foldGutter: true, lineNumbers: true, highlightActiveLine: true, highlightActiveLineGutter: true }}
                                    theme="none"
                                    onChange={(value) => setJsonText((current) => ({ ...current, public: value }))}
                                    style={{ fontSize: 13 }}
                                />
                            </div>
                        )
                    ) : activeMode === "visual" ? (
                        <Form form={form} layout="vertical" initialValues={emptySettings} requiredMark={false}>
                            <Flex vertical gap={12}>
                                <Card
                                    size="small"
                                    title={
                                        <Space>
                                            <img src="/icons/linuxdo.svg" alt="" width={18} height={18} />
                                            Linux.do 登录
                                        </Space>
                                    }
                                >
                                    <Flex vertical gap={14}>
                                        <Typography.Text type="secondary">
                                            本项目接口回调地址是 /api/auth/linux-do/callback，请在 Linux.do 应用后台自行拼接站点前缀。
                                            <Typography.Link href="https://connect.linux.do" target="_blank" rel="noreferrer">
                                                点击此处管理你的 LinuxDO OAuth App
                                            </Typography.Link>
                                        </Typography.Text>
                                        <Row gutter={16}>
                                            <Col xs={24} md={6}>
                                                <Form.Item name={["public", "auth", "linuxDo", "enabled"]} label="开启 Linux.do 登录" valuePropName="checked">
                                                    <Switch />
                                                </Form.Item>
                                            </Col>
                                            <Col xs={24} md={9}>
                                                <Form.Item name={["private", "auth", "linuxDo", "clientId"]} label="Linux.do Client ID">
                                                    <Input placeholder="输入 Linux.do OAuth App 的 ID" />
                                                </Form.Item>
                                            </Col>
                                            <Col xs={24} md={9}>
                                                <Form.Item name={["private", "auth", "linuxDo", "clientSecret"]} label="Linux.do Client Secret">
                                                    <Input.Password placeholder="留空则沿用已保存的密钥" />
                                                </Form.Item>
                                            </Col>
                                        </Row>
                                    </Flex>
                                </Card>
                                <Card size="small" title="提示词定时同步">
                                    <Row gutter={16} align="middle">
                                        <Col xs={24} md={8}>
                                            <Form.Item name={["private", "promptSync", "enabled"]} label="开启定时同步" valuePropName="checked">
                                                <Switch />
                                            </Form.Item>
                                        </Col>
                                        <Col xs={24} md={16}>
                                            <Form.Item name={["private", "promptSync", "cron"]} label="Cron 表达式" extra="默认每天 0 点同步内置 GitHub 远程提示词源">
                                                <Input placeholder="0 0 * * *" />
                                            </Form.Item>
                                        </Col>
                                    </Row>
                                </Card>
                                <Card size="small" title="AI 调用日志">
                                    <Row gutter={16}>
                                        <Col xs={24} md={6}>
                                            <Form.Item name={["private", "aiLog", "localDirectReportEnabled"]} label="本地直连日志上报" valuePropName="checked" extra="关闭后本地直连不上报；云端渠道仍默认记录。">
                                                <Switch />
                                            </Form.Item>
                                        </Col>
                                        <Col xs={24} md={6}>
                                            <Form.Item name={["private", "aiLog", "cleanup", "enabled"]} label="开启自动清理" valuePropName="checked" extra="日志按天写入本地文件，不保存到 SQLite。">
                                                <Switch />
                                            </Form.Item>
                                        </Col>
                                        <Col xs={24} md={6}>
                                            <Form.Item name={["private", "aiLog", "cleanup", "retentionDays"]} label="保留天数" extra="默认保留 14 天，超过后定时删除对应日期日志文件。">
                                                <InputNumber min={1} precision={0} className="!w-full" />
                                            </Form.Item>
                                        </Col>
                                        <Col xs={24} md={6}>
                                            <Form.Item name={["private", "aiLog", "cleanup", "cron"]} label="清理 Cron">
                                                <Input placeholder="0 3 * * *" />
                                            </Form.Item>
                                        </Col>
                                    </Row>
                                </Card>
                                <Card size="small" title="数据存储">
                                    <Row gutter={16}>
                                        <Col xs={24} md={6}>
                                            <Form.Item label="存储模式" extra="根据对象存储配置和启用状态自动识别。">
                                                <Input disabled value="自动识别 (动态切换)" />
                                            </Form.Item>
                                        </Col>
                                        <Col xs={24} md={6}>
                                            <Form.Item name={["private", "storage", "allowUserProvider"]} label="允许用户配置 S3/WebDAV" valuePropName="checked">
                                                <Switch />
                                            </Form.Item>
                                        </Col>
                                        <Col xs={24} md={6}>
                                            <Form.Item name={["private", "storage", "allowUserGlobalProvider"]} label="允许用户使用全局配置渠道" valuePropName="checked">
                                                <Switch />
                                            </Form.Item>
                                        </Col>
                                        <Col xs={24} md={6}>
                                            <Form.Item name={["private", "storage", "autoSyncAllAssets"]} label="全部素材云端同步" extra="上传、导入及生成的图片、视频、音频自动同步到可用云存储；关闭保持原有行为" valuePropName="checked">
                                                <Switch />
                                            </Form.Item>
                                        </Col>
                                        <Col xs={24} md={8}>
                                            <Form.Item name={["private", "storage", "capacityCheck", "enabled"]} label="定时统计容量" valuePropName="checked">
                                                <Switch />
                                            </Form.Item>
                                        </Col>
                                        <Col xs={24} md={8}>
                                            <Form.Item name={["private", "storage", "capacityCheck", "cron"]} label="容量统计 Cron">
                                                <Input placeholder="0 */6 * * *" />
                                            </Form.Item>
                                        </Col>
                                        <Col xs={24} md={8}>
                                            <Form.Item name={["private", "storage", "capacityLimitBytes"]} label="容量上限(字节)" extra="默认 9GB，达到上限后会自动禁用该配置。">
                                                <InputNumber min={1} className="!w-full" />
                                            </Form.Item>
                                        </Col>
                                    </Row>
                                    <Form.List name={["private", "storage", "providers"]}>
                                        {(fields, { add, remove }) => (
                                            <Flex vertical gap={12}>
                                                <Button icon={<PlusOutlined />} onClick={() => add(newAdminStorageProvider("s3", storageProviders))}>
                                                    新增 S3/R2 配置
                                                </Button>
                                                <Button icon={<PlusOutlined />} onClick={() => add(newAdminStorageProvider("webdav", storageProviders))}>
                                                    新增 WebDAV 配置
                                                </Button>
                                                {fields.map((field) => {
                                                    const provider = storageProviders[field.name] || emptyS3StorageProvider;
                                                    const isWebDAV = provider.type === "webdav";
                                                    const weightField = (
                                                        <Col xs={24} md={3}>
                                                            <Form.Item name={[field.name, "weight"]} label="权重">
                                                                <InputNumber min={1} className="!w-full" />
                                                            </Form.Item>
                                                        </Col>
                                                    );
                                                    return (
                                                        <Card
                                                            key={field.key}
                                                            size="small"
                                                            title={isWebDAV ? "WebDAV" : "S3/R2"}
                                                            extra={
                                                                <Flex gap={8}>
                                                                    <Button size="small" loading={measuringProviderIndex === field.name} onClick={() => void measureStorageProviderAt(field.name)}>
                                                                        统计容量
                                                                    </Button>
                                                                    <Button danger size="small" icon={<DeleteOutlined />} onClick={() => remove(field.name)} />
                                                                </Flex>
                                                            }
                                                        >
                                                            <Form.Item name={[field.name, "type"]} hidden>
                                                                <Input />
                                                            </Form.Item>
                                                            <Row gutter={12}>
                                                                <Col xs={24} md={6}>
                                                                    <Form.Item name={[field.name, "name"]} label="名称">
                                                                        <Input placeholder={isWebDAV ? "WebDAV" : "Cloudflare R2"} />
                                                                    </Form.Item>
                                                                </Col>
                                                                <Col xs={24} md={isWebDAV ? 8 : 6}>
                                                                    <Form.Item name={[field.name, "endpoint"]} label={isWebDAV ? "WebDAV 地址" : "Endpoint"}>
                                                                        <Input placeholder={isWebDAV ? "https://dav.example.com/webdav" : "https://<account>.r2.cloudflarestorage.com"} />
                                                                    </Form.Item>
                                                                </Col>
                                                                {isWebDAV && (
                                                                    <Col xs={24} md={3}>
                                                                        <Form.Item name={[field.name, "allowPrivateNetwork"]} label="允许内网" valuePropName="checked">
                                                                            <Switch />
                                                                        </Form.Item>
                                                                    </Col>
                                                                )}
                                                                {!isWebDAV && (
                                                                    <>
                                                                        <Col xs={24} md={3}>
                                                                            <Form.Item name={[field.name, "region"]} label="Region">
                                                                                <Input placeholder="auto" />
                                                                            </Form.Item>
                                                                        </Col>
                                                                        <Col xs={24} md={3}>
                                                                            <Form.Item name={[field.name, "bucket"]} label="Bucket">
                                                                                <Input />
                                                                            </Form.Item>
                                                                        </Col>
                                                                        <Col xs={24} md={3}>
                                                                            <Form.Item name={[field.name, "bucketInHost"]} label="路径 / 子域名" valuePropName="checked">
                                                                                <Switch />
                                                                            </Form.Item>
                                                                        </Col>
                                                                    </>
                                                                )}
                                                                <Col xs={24} md={isWebDAV ? 4 : 3}>
                                                                    <Form.Item name={[field.name, "enabled"]} label="启用" valuePropName="checked">
                                                                        <Switch
                                                                            onChange={(checked) => {
                                                                                if (!checked) return;
                                                                                const providers = form.getFieldValue(["private", "storage", "providers"]) || [];
                                                                                const type = form.getFieldValue(["private", "storage", "providers", field.name, "type"]);
                                                                                providers.forEach((item: AdminStorageProvider, i: number) => {
                                                                                    if (i !== field.name && item.type !== type) {
                                                                                        form.setFieldValue(["private", "storage", "providers", i, "enabled"], false);
                                                                                    }
                                                                                });
                                                                            }}
                                                                        />
                                                                    </Form.Item>
                                                                </Col>
                                                                {isWebDAV && weightField}
                                                                {isWebDAV ? (
                                                                    <>
                                                                        <Col xs={24} md={6}>
                                                                            <Form.Item name={[field.name, "pathPrefix"]} label="远程目录">
                                                                                <Input placeholder="请输入远程目录" />
                                                                            </Form.Item>
                                                                        </Col>
                                                                        <Col xs={24} md={6}>
                                                                            <Form.Item name={[field.name, "username"]} label="用户名">
                                                                                <Input />
                                                                            </Form.Item>
                                                                        </Col>
                                                                        <Col xs={24} md={6}>
                                                                            <Form.Item name={[field.name, "password"]} label="密码 / 应用密码">
                                                                                <Input.Password placeholder="留空沿用已保存密码" />
                                                                            </Form.Item>
                                                                        </Col>
                                                                        <Col xs={0} md={6} />
                                                                    </>
                                                                ) : (
                                                                    <>
                                                                        <Col xs={24} md={6}>
                                                                            <Form.Item name={[field.name, "accessKeyId"]} label="Access Key ID">
                                                                                <Input />
                                                                            </Form.Item>
                                                                        </Col>
                                                                        <Col xs={24} md={6}>
                                                                            <Form.Item name={[field.name, "secretAccessKey"]} label="Secret Access Key">
                                                                                <Input.Password placeholder="留空沿用已保存密钥" />
                                                                            </Form.Item>
                                                                        </Col>
                                                                        <Col xs={24} md={6}>
                                                                            <Form.Item name={[field.name, "publicBaseUrl"]} label="公开访问域名">
                                                                                <Input placeholder="可选，不填则走后端代理读取" />
                                                                            </Form.Item>
                                                                        </Col>
                                                                        <Col xs={24} md={3}>
                                                                            <Form.Item name={[field.name, "pathPrefix"]} label="路径前缀">
                                                                                <Input placeholder="canvas" />
                                                                            </Form.Item>
                                                                        </Col>
                                                                        {weightField}
                                                                    </>
                                                                )}
                                                                <Col xs={24} md={4}>
                                                                    <Form.Item label="已用容量">
                                                                        <Typography.Text>{formatStorageBytes(form.getFieldValue(["private", "storage", "providers", field.name, "capacityBytes"]) || 0)}</Typography.Text>
                                                                    </Form.Item>
                                                                </Col>
                                                                <Col xs={24} md={5}>
                                                                    <Form.Item name={[field.name, "capacityCheckedAt"]} label="统计时间">
                                                                        <Input disabled />
                                                                    </Form.Item>
                                                                </Col>
                                                                <Col xs={24} md={3}>
                                                                    <Form.Item name={[field.name, "capacityExceeded"]} label="超限" valuePropName="checked">
                                                                        <Switch disabled />
                                                                    </Form.Item>
                                                                </Col>
                                                            </Row>
                                                        </Card>
                                                    );
                                                })}
                                            </Flex>
                                        )}
                                    </Form.List>
                                </Card>
                                <Space>
                                    <Button type="primary" icon={<PlusOutlined />} onClick={() => openChannelDrawer(null)}>
                                        新增渠道
                                    </Button>
                                    <Button icon={<ImportOutlined />} onClick={openBulkImport}>
                                        批量导入
                                    </Button>
                                </Space>
                                <Table
                                    rowKey="_rowKey"
                                    pagination={false}
                                    dataSource={channelTableData}
                                    columns={[
                                        { title: "名称", dataIndex: "name", render: (value) => value || "未命名渠道" },
                                        { title: "协议", dataIndex: "protocol", width: 96, render: (value) => <Tag>{value || "openai"}</Tag> },
                                        { title: "状态", dataIndex: "enabled", width: 120, render: (value, item) => isWorkflowProtocol(item.protocol) ? <Tag>{`启用 ${(item.workflows || []).filter((entry) => entry.enabled).length} / ${(item.workflows || []).length} 条`}</Tag> : <Tag color={value ? "success" : "default"}>{value ? "已启用" : "已停用"}</Tag> },
                                        {
                                            title: "模型",
                                            dataIndex: "models",
                                            render: (value: string[], item) => (
                                                <Typography.Text ellipsis style={{ maxWidth: 360 }}>
                                                    {isWorkflowProtocol(item.protocol) ? (item.workflows || []).map((entry) => entry.title || entry.workflowId).join("、") || "未配置工作流" : modelSummary(value || [])}
                                                </Typography.Text>
                                            ),
                                        },
                                        { title: "可用分组", dataIndex: "groups", render: (value: string[] | undefined) => <Space wrap>{(value?.length ? value : ["default"]).map((id) => <Tag key={id}>{pricingGroups.find((group) => group.id === id)?.name || id}</Tag>)}</Space> },
                                        { title: "权重", dataIndex: "weight", width: 88 },
                                        { title: "超时", dataIndex: "timeout", width: 96, render: (value) => `${value || 600}s` },
                                        {
                                            title: "健康",
                                            key: "health",
                                            width: 130,
                                            render: (_, item) => {
                                                const health = item.id ? channelHealth[item.id] : undefined;
                                                if (!health || !isChannelCooling(health)) return <Tag color="success">正常</Tag>;
                                                return (
                                                    <Popover
                                                        title={channelHealthReasonLabel(health.reason)}
                                                        content={
                                                            <div style={{ maxWidth: 320, fontSize: 12 }}>
                                                                <div>剩余：{formatCooldownRemaining(health.cooldownUntil)}</div>
                                                                <div>熔断次数：{health.circuitCount}</div>
                                                                {health.failures > 0 ? <div>连续失败：{health.failures}</div> : null}
                                                                {health.upstreamError ? <div style={{ marginTop: 6, color: "var(--ant-color-text-secondary)", wordBreak: "break-all" }}>上游原文：{health.upstreamError}</div> : null}
                                                                <Button size="small" type="primary" style={{ marginTop: 8 }} onClick={() => void restoreChannelToPool(item.id)}>放回号池</Button>
                                                            </div>
                                                        }
                                                    >
                                                        <Tag color="warning" style={{ cursor: "pointer" }}>冷却中 {formatCooldownRemaining(health.cooldownUntil)}</Tag>
                                                    </Popover>
                                                );
                                            },
                                        },
                                        {
                                            title: "操作",
                                            key: "actions",
                                            width: 220,
                                            render: (_, item) => (
                                                <Space size={4}>
                                                    {!isWorkflowProtocol(item.protocol) ? <Button size="small" onClick={() => openTestDialog(item._index)}>测试</Button> : null}
                                                    <Button size="small" onClick={() => openChannelDrawer(item._index)}>
                                                        编辑
                                                    </Button>
                                                    <Button
                                                        danger
                                                        size="small"
                                                        icon={<DeleteOutlined />}
                                                        onClick={() => {
                                                            const nextChannels = [...channels];
                                                            nextChannels.splice(item._index, 1);
                                                            void persistChannels(nextChannels);
                                                        }}
                                                    />
                                                </Space>
                                            ),
                                        },
                                    ]}
                                />
                            </Flex>
                        </Form>
                    ) : (
                        <div style={{ overflow: "hidden", border: "1px solid var(--ant-color-border)", borderRadius: 6 }}>
                            <CodeMirror
                                value={activeJsonText}
                                height="520px"
                                extensions={[json(), jsonEditorTheme]}
                                basicSetup={{ foldGutter: true, lineNumbers: true, highlightActiveLine: true, highlightActiveLineGutter: true }}
                                theme="none"
                                onChange={(value) => setJsonText((current) => ({ ...current, private: value }))}
                                style={{ fontSize: 13 }}
                            />
                        </div>
                    )}
                </Card>
                <Card size="small" title="渠道换号重试与熔断">
                    <Row gutter={16}>
                        <Col xs={24} md={6}>
                            <Form.Item name={["private", "channelHealth", "retryTimes"]} label="换号重试次数" extra="失败后换同号池其他 Key 重试的次数，0 表示关闭">
                                <InputNumber min={0} max={20} precision={0} className="!w-full" />
                            </Form.Item>
                        </Col>
                        <Col xs={24} md={6}>
                            <Form.Item name={["private", "channelHealth", "deadCooldownMinutes"]} label="失效冷却（分钟）" extra="密钥失效 / 封禁 / 额度耗尽的冷却时长，连续熔断会翻倍">
                                <InputNumber min={1} precision={0} className="!w-full" />
                            </Form.Item>
                        </Col>
                        <Col xs={24} md={6}>
                            <Form.Item name={["private", "channelHealth", "rateLimitCooldownSec"]} label="限流冷却（秒）" extra="429 限流的冷却时长">
                                <InputNumber min={1} precision={0} className="!w-full" />
                            </Form.Item>
                        </Col>
                        <Col xs={24} md={6}>
                            <Form.Item name={["private", "channelHealth", "upstreamFailureLimit"]} label="上游波动阈值" extra="连续多少次 5xx 才熔断">
                                <InputNumber min={1} precision={0} className="!w-full" />
                            </Form.Item>
                        </Col>
                        <Col xs={24} md={6}>
                            <Form.Item name={["private", "channelHealth", "upstreamCooldownMinutes"]} label="上游波动冷却（分钟）">
                                <InputNumber min={1} precision={0} className="!w-full" />
                            </Form.Item>
                        </Col>
                        <Col xs={24} md={6}>
                            <Form.Item name={["private", "channelHealth", "timeoutRetry"]} label="超时 / 5xx 也换号" valuePropName="checked" extra="默认关闭，避免上游已生成却重复计费">
                                <Switch />
                            </Form.Item>
                        </Col>
                    </Row>
                </Card>
                <Drawer
                    title={editingChannelIndex === null ? "新增渠道" : "编辑渠道"}
                    open={isChannelDrawerOpen}
                    size={isWorkflowProtocol(channelProtocol) ? "75vw" : 560}
                    onClose={closeChannelDrawer}
                    extra={
                        <Space>
                            <Button onClick={closeChannelDrawer}>取消</Button>
                            <Button type="primary" disabled={isLoading} onClick={() => void saveChannel()}>
                                保存
                            </Button>
                        </Space>
                    }
                    destroyOnHidden
                >
                    <Form form={channelForm} layout="vertical" requiredMark={false} initialValues={emptyChannel}>
                        <Row gutter={16}>
                            <Col span={12}>
                                <Form.Item name="name" label="渠道名称" rules={[{ required: true, message: "请输入渠道名称" }]}>
                                    <Input />
                                </Form.Item>
                            </Col>
                            <Col span={12}>
                                <Form.Item name="protocol" label="协议">
                                    <Select
                                        options={modelChannelProtocolOptions}
                                        onChange={(protocol: AdminModelChannel["protocol"]) => {
                                            channelForm.setFieldValue("baseUrl", modelChannelDefaultBaseUrls[protocol]);
                                            setWorkflowChannelDraft((current) => ({ ...current, protocol, baseUrl: modelChannelDefaultBaseUrls[protocol] }));
                                        }}
                                    />
                                </Form.Item>
                            </Col>
                            <Col span={24}>
                                <Form.Item name="groups" label="所属调用分组" extra="所有已配置分组对用户开放；调用与重试只使用所选分组的渠道。" rules={[{ required: true, type: "array", min: 1, message: "请选择至少一个调用分组" }]}><Select mode="multiple" options={pricingGroups.map((group) => ({ value: group.id, label: `${group.name}（×${group.ratio}）` }))} /></Form.Item>
                            </Col>
                            {!isWorkflowProtocol(channelProtocol) ? <>
                            <Col span={12}>
                                <Form.Item name="weight" label="权重">
                                    <InputNumber min={1} step={1} className="!w-full" />
                                </Form.Item>
                            </Col>
                            <Col span={12}>
                                <Form.Item name="timeout" label="请求超时（秒）" extra="用于后台代理请求、模型列表读取和渠道测试">
                                    <InputNumber min={1} step={30} className="!w-full" />
                                </Form.Item>
                            </Col>
                            <Col span={12}>
                                <Form.Item name="enabled" label="启用" valuePropName="checked">
                                    <Switch />
                                </Form.Item>
                            </Col>
                            <Col span={24}>
                                <Form.Item
                                    name="baseUrl"
                                    label={
                                        <span className="relative inline-flex items-center">
                                            接口地址
                                            {channelProtocol === "tokendance" || channelApiKeyUrl ? (
                                                <span className="absolute left-full top-1/2 ml-2 -translate-y-1/2 whitespace-nowrap">
                                                    <Button
                                                        type="primary"
                                                        size="small"
                                                        href={channelProtocol === "tokendance" ? undefined : channelApiKeyUrl}
                                                        target={channelProtocol === "tokendance" ? undefined : "_blank"}
                                                        onClick={channelProtocol === "tokendance" ? () => void loginTokenDance() : undefined}
                                                    >
                                                        {channelProtocol === "tokendance" ? "登录" : "获取 API Key"}
                                                    </Button>
                                                </span>
                                            ) : null}
                                        </span>
                                    }
                                    rules={[{ required: true, message: "请输入接口地址" }]}
                                >
                                    <Input />
                                </Form.Item>
                            </Col>
                            <Col span={24}>
                                <Form.Item name="apiKey" label="API Key" rules={editingChannelIndex === null ? [{ required: true, message: "请输入 API Key" }] : []}>
                                    <Input.Password placeholder={editingChannelIndex === null ? "" : "留空则沿用已保存的 API Key"} />
                                </Form.Item>
                            </Col>
                            <Col span={24}>
                                <Form.Item label="渠道可用模型">
                                    <Space.Compact style={{ width: "100%" }}>
                                        <Form.Item name="models" noStyle>
                                            <Select mode="tags" showSearch={{ optionFilterProp: ["label", "value"] }} maxTagCount="responsive" tokenSeparators={[",", "\n"]} options={knownModels.map((model) => ({ label: modelLabel(model, { protocol: channelProtocol, baseUrl: channelBaseUrl }), value: model }))} />
                                        </Form.Item>
                                        <Button onClick={() => openChannelModelSelector()}>选择模型</Button>
                                    </Space.Compact>
                                </Form.Item>
                            </Col>
                            </> : <Col span={24} className="mb-3">
                                <WorkflowChannelPane
                                    key={`${editingChannelIndex ?? "new"}:${workflowChannelDraft.id}:${workflowChannelDraft.protocol}`}
                                    channel={workflowChannelDraft as WorkflowChannelSettings}
                                    workflows={workflowChannelDraft.workflows || []}
                                    token={token || ""}
                                    admin={{ index: editingChannelIndex ?? undefined, channel: workflowChannelDraft }}
                                    onChannelChange={(patch) => { channelForm.setFieldsValue(patch); setWorkflowChannelDraft((current) => ({ ...current, ...patch })); }}
                                    onBridgeDeleted={(bridgeId) => {
                                        const nextChannels = channels.map((channel) => channel.protocol === "comfyui" && channel.bridgeId === bridgeId ? { ...channel, bridgeId: "" } : channel);
                                        setChannels(nextChannels);
                                        form.setFieldValue(["private", "channels"], nextChannels);
                                        channelForm.setFieldValue("bridgeId", "");
                                        setWorkflowChannelDraft((current) => current.bridgeId === bridgeId ? { ...current, bridgeId: "" } : current);
                                    }}
                                    onWorkflowsChange={(workflows) => { channelForm.setFieldValue("workflows", workflows); setWorkflowChannelDraft((current) => ({ ...current, workflows })); }}
                                    onBeforeTest={async () => {
                                        const saved = editingChannelIndex === null ? undefined : channels[editingChannelIndex];
                                        if (!saved?.id) throw new Error("请先保存渠道后再测试");
                                        const draft = normalizeChannel({ ...workflowChannelDraft, ...channelForm.getFieldsValue(true) });
                                        if (JSON.stringify(draft) !== JSON.stringify(normalizeChannel(saved))) throw new Error("当前配置有未保存修改，请先保存后再测试");
                                        return saved.id;
                                    }}
                                />
                            </Col>}
                            <Col span={24}>
                                <Form.Item name="remark" label="备注">
                                    <Input.TextArea rows={3} />
                                </Form.Item>
                            </Col>
                        </Row>
                    </Form>
                </Drawer>
                <Modal
                    title="批量导入渠道"
                    open={isBulkImportOpen}
                    width={640}
                    onCancel={() => setIsBulkImportOpen(false)}
                    okText={`导入 ${countBulkKeys(bulkPreview)} 个渠道`}
                    okButtonProps={{ disabled: countBulkKeys(bulkPreview) === 0 }}
                    onOk={() => void importBulkChannels()}
                    destroyOnHidden
                >
                    <Form form={bulkForm} layout="vertical" requiredMark={false} initialValues={{ protocol: "openai", weight: 1, timeout: 600, models: [], groups: ["default"] }}>
                        <Typography.Text type="secondary">
                            一行一个 API Key，导入后每行生成一个渠道；名称自动编号，重复 Key 会跳过。
                        </Typography.Text>
                        <Row gutter={12} style={{ marginTop: 12 }}>
                            <Col span={12}>
                                <Form.Item name="protocol" label="协议">
                                    <Select options={modelChannelProtocolOptions} />
                                </Form.Item>
                            </Col>
                            <Col span={12}>
                                <Form.Item name="namePrefix" label="渠道名前缀" extra="留空则按接口域名生成">
                                    <Input placeholder="例如 hcnsec" />
                                </Form.Item>
                            </Col>
                            <Col span={24}>
                                <Form.Item name="baseUrl" label="接口地址" rules={[{ required: true, message: "请输入接口地址" }]}>
                                    <Input placeholder="https://api.example.com" />
                                </Form.Item>
                            </Col>
                            <Col span={24}>
                                <Form.Item name="models" label="渠道可用模型" extra="导入后可在各渠道里单独调整">
                                    <Select mode="tags" showSearch={{ optionFilterProp: ["label", "value"] }} tokenSeparators={[",", "\n"]} placeholder="回车或逗号分隔，例如 gpt-image-2" options={knownModels.map((model) => ({ label: model, value: model }))} />
                                </Form.Item>
                            </Col>
                            <Col span={24}>
                                <Form.Item name="groups" label="所属调用分组" rules={[{ required: true, type: "array", min: 1, message: "请选择至少一个调用分组" }]}><Select mode="multiple" options={pricingGroups.map((group) => ({ value: group.id, label: `${group.name}（×${group.ratio}）` }))} /></Form.Item>
                            </Col>
                            <Col span={12}>
                                <Form.Item name="weight" label="权重">
                                    <InputNumber min={1} step={1} className="!w-full" />
                                </Form.Item>
                            </Col>
                            <Col span={12}>
                                <Form.Item name="timeout" label="请求超时（秒）">
                                    <InputNumber min={1} step={30} className="!w-full" />
                                </Form.Item>
                            </Col>
                            <Col span={24}>
                                <Form.Item name="keys" label="API Key" rules={[{ required: true, message: "请至少输入一个 API Key" }]}>
                                    <Input.TextArea rows={10} placeholder="sk-aaaaaaaa&#10;sk-bbbbbbbb&#10;sk-cccccccc" />
                                </Form.Item>
                            </Col>
                        </Row>
                    </Form>
                </Modal>
                {isModelSelectorOpen ? (
                    <ChannelModelSelectorModal
                        channel={channelForm.getFieldsValue(true)}
                        parameterTranslation={channelForm.getFieldValue("parameterTranslation") || ""}
                        models={channelForm.getFieldValue("models") || []}
                        onCancel={closeChannelModelSelector}
                        onConfirm={confirmChannelModelSelector}
                        onFetchModels={fetchChannelModelList}
                        onModelsFetched={rememberModels}
                    />
                ) : null}
                <Modal
                    title={
                        <Space>
                            {testChannel?.name || "渠道"} 渠道的模型测试<Typography.Text type="secondary">共 {testChannel?.models.length || 0} 个模型</Typography.Text>
                        </Space>
                    }
                    open={testChannelIndex !== null}
                    width={920}
                    onCancel={closeTestDialog}
                    footer={
                        <Space>
                            <Button onClick={closeTestDialog}>取消</Button>
                            <Button type="primary" disabled={!selectedTestModels.length || testingModels.length > 0} onClick={() => void batchTestModels()}>
                                批量测试 {selectedTestModels.length} 个模型
                            </Button>
                        </Space>
                    }
                    destroyOnHidden
                >
                    <Flex vertical gap={12}>
                        <Typography.Text type="secondary">测试会向选中模型发送最小测试请求，用于确认渠道是否有响应。</Typography.Text>
                        <Input.Search placeholder="搜索模型..." allowClear value={testKeyword} onChange={(event) => setTestKeyword(event.target.value)} />
                        <Table
                            rowKey="model"
                            pagination={false}
                            scroll={{ y: 420 }}
                            dataSource={testModels.map((model) => ({ model }))}
                            rowSelection={{
                                selectedRowKeys: selectedTestModels,
                                onChange: (keys) => setSelectedTestModels(keys.map(String)),
                            }}
                            columns={[
                                { title: "模型名称", dataIndex: "model", render: (value) => <Typography.Text strong title={value}>{modelLabel(value, testChannel)}</Typography.Text> },
                                {
                                    title: "状态",
                                    dataIndex: "model",
                                    width: 260,
                                    render: (value) => {
                                        if (testingModels.includes(value)) return <Tag icon={<LoadingOutlined className="animate-spin" />}>测试中</Tag>;
                                        const result = testResults[value];
                                        if (!result) return <Tag>未开始</Tag>;
                                        return result.status === "success" ? (
                                            <Space size={6} wrap>
                                                <Tag color="success">成功</Tag>
                                                <Typography.Text type="secondary">请求时长: {result.duration}</Typography.Text>
                                                {result.message && result.message !== "ok" ? <Typography.Text type="secondary">{result.message}</Typography.Text> : null}
                                            </Space>
                                        ) : (
                                            <Typography.Text type="danger">{result.message}</Typography.Text>
                                        );
                                    },
                                },
                                {
                                    title: "操作",
                                    key: "actions",
                                    width: 120,
                                    render: (_, item) => (
                                        <Button size="small" loading={testingModels.includes(item.model)} onClick={() => void testModelOnline(item.model)}>
                                            测试
                                        </Button>
                                    ),
                                },
                            ]}
                        />
                    </Flex>
                </Modal>
            </Flex>
        </main>
    );
}

function normalizeSettings(settings: Partial<AdminSettings> = {}): AdminSettings {
    const privateSetting = normalizePrivateSetting(settings.private);
    return {
        public: {
            ...normalizePublicSetting(settings.public),
        },
        private: privateSetting,
    };
}

function normalizePublicSetting(setting: Partial<AdminSettings["public"]> = {}): AdminSettings["public"] {
    return {
        ...emptySettings.public,
        announcements: setting.announcements || [],
        recharge: normalizeRechargeSetting(setting.recharge),
        modelChannel: {
            ...emptySettings.public.modelChannel,
            ...(setting.modelChannel || {}),
            availableModels: setting.modelChannel?.availableModels || [],
            availableWorkflows: setting.modelChannel?.availableWorkflows || [],
            modelCosts: normalizeModelCosts(setting.modelChannel?.modelCosts || []),
            pricing: normalizePricingGroups(setting.modelChannel?.pricing),
            channels: setting.modelChannel?.channels || [],
            systemPrompts: {
                ...emptySettings.public.modelChannel.systemPrompts,
                image: setting.modelChannel?.systemPrompts?.image || "",
                video: setting.modelChannel?.systemPrompts?.video || "",
                text: setting.modelChannel?.systemPrompts?.text || "",
                workflow: setting.modelChannel?.systemPrompts?.workflow || "",
                workflowAgent: setting.modelChannel?.systemPrompts?.workflowAgent || "",
            },
        },
        auth: {
            allowRegister: setting.auth?.allowRegister !== false,
            emailVerification: setting.auth?.emailVerification === true,
            linuxDo: {
                enabled: setting.auth?.linuxDo?.enabled === true,
            },
        },
        storage: {
            mode: setting.storage?.mode || "local_indexeddb",
            allowUserProvider: setting.storage?.allowUserProvider === true,
        },
    };
}

function normalizePricingGroups(pricing: Partial<AdminSettings["public"]["modelChannel"]["pricing"]> | undefined) {
    const groups = (pricing?.groups || [])
        .filter((group) => group && (group.id || "").trim())
        .map((group) => ({ id: (group.id || "").trim(), name: (group.name || group.id || "").trim(), ratio: Number(group.ratio) > 0 ? Number(group.ratio) : 1, desc: group.desc || "" }));
    return {
        currency: pricing?.currency || "CNY",
        creditRate: Number(pricing?.creditRate) > 0 ? Number(pricing?.creditRate) : 1,
        groups: groups.length ? groups : defaultPricingGroups.map((group) => ({ ...group })),
    };
}

function normalizeModelCosts(items: Partial<AdminSettings["public"]["modelChannel"]["modelCosts"][number]>[]) {
    return items
        .filter((item) => item.model)
        .map((item) => {
            const resolution = item.resolution || "";
            return {
                model: item.model || "",
                resolution,
                billingMode: (item.billingMode || (resolution ? "second" : "image")) as AdminModelCost["billingMode"],
                price: Math.max(0, Number(item.price) || 0),
                credits: Math.max(0, Number(item.credits) || 0),
                vendor: item.vendor || "",
                tags: Array.isArray(item.tags) ? item.tags : [],
            };
        });
}

function normalizePrivateSetting(setting: Partial<AdminSettings["private"]> = {}): AdminSettings["private"] {
    return {
        channels: (setting.channels || []).map(normalizeChannel),
        channelHealth: normalizeChannelHealthSetting(setting.channelHealth),
        promptSync: {
            enabled: setting.promptSync?.enabled !== false,
            cron: setting.promptSync?.cron || "0 0 * * *",
        },
        aiLog: {
            localDirectReportEnabled: setting.aiLog?.localDirectReportEnabled === true,
            cleanup: {
                enabled: setting.aiLog?.cleanup?.enabled === true,
                retentionDays: Number(setting.aiLog?.cleanup?.retentionDays) || 14,
                cron: setting.aiLog?.cleanup?.cron || "0 3 * * *",
            },
        },
        auth: {
            linuxDo: {
                clientId: setting.auth?.linuxDo?.clientId || "",
                clientSecret: setting.auth?.linuxDo?.clientSecret || "",
            },
        },
        storage: {
            mode: setting.storage?.mode || "local_indexeddb",
            allowUserProvider: setting.storage?.allowUserProvider === true,
            allowUserGlobalProvider: setting.storage?.allowUserGlobalProvider === true,
            autoSyncAllAssets: setting.storage?.autoSyncAllAssets === true,
            providers: (setting.storage?.providers || []).map(normalizeStorageProvider),
            roundRobinCursor: Number(setting.storage?.roundRobinCursor) || 0,
            capacityCheck: {
                enabled: setting.storage?.capacityCheck?.enabled === true,
                cron: setting.storage?.capacityCheck?.cron || "0 */6 * * *",
            },
            capacityLimitBytes: Number(setting.storage?.capacityLimitBytes) || 9 * 1024 * 1024 * 1024,
        },
    };
}

function normalizeChannelHealthSetting(setting: Partial<AdminSettings["private"]["channelHealth"]> = {}): AdminSettings["private"]["channelHealth"] {
    return {
        retryTimes: Math.max(0, Number(setting.retryTimes) || 0),
        deadCooldownMinutes: Number(setting.deadCooldownMinutes) > 0 ? Number(setting.deadCooldownMinutes) : 300,
        rateLimitCooldownSec: Number(setting.rateLimitCooldownSec) > 0 ? Number(setting.rateLimitCooldownSec) : 60,
        upstreamFailureLimit: Number(setting.upstreamFailureLimit) > 0 ? Number(setting.upstreamFailureLimit) : 5,
        upstreamCooldownMinutes: Number(setting.upstreamCooldownMinutes) > 0 ? Number(setting.upstreamCooldownMinutes) : 5,
        timeoutRetry: setting.timeoutRetry === true,
    };
}

function isChannelCooling(item: AdminChannelHealthInfo) {
    return item.status === "cooling" && new Date(item.cooldownUntil).getTime() > Date.now();
}

function channelHealthReasonLabel(reason: string) {
    switch (reason) {
        case "key_invalid": return "密钥失效";
        case "suspended": return "账号封禁";
        case "quota": return "额度耗尽";
        case "rate_limit": return "限流";
        case "upstream_error": return "上游波动";
        default: return "冷却中";
    }
}

function formatCooldownRemaining(until: string) {
    const diff = new Date(until).getTime() - Date.now();
    if (!Number.isFinite(diff) || diff <= 0) return "即将恢复";
    const minutes = Math.ceil(diff / 60000);
    if (minutes < 60) return `${minutes} 分钟`;
    const hours = Math.floor(minutes / 60);
    const rest = minutes % 60;
    return rest ? `${hours} 小时 ${rest} 分` : `${hours} 小时`;
}

function normalizeStorageProvider(item: Partial<AdminStorageProvider> = {}): AdminStorageProvider {
    const type = item.type === "webdav" ? "webdav" : "s3";
    return {
        ...(type === "webdav" ? emptyWebDAVStorageProvider : emptyS3StorageProvider),
        ...item,
        id: item.id || "",
        type,
        region: type === "s3" ? item.region || "auto" : "",
        weight: Math.max(1, Number(item.weight) || 1),
        enabled: item.enabled !== false,
        capacityBytes: Number(item.capacityBytes) || 0,
        capacityCheckedAt: item.capacityCheckedAt || "",
        capacityExceeded: item.capacityExceeded === true,
    };
}

function newAdminStorageProvider(type: AdminStorageProvider["type"], providers: AdminStorageProvider[]) {
    const template = type === "webdav" ? emptyWebDAVStorageProvider : emptyS3StorageProvider;
    return {
        ...template,
        enabled: !providers.some((provider) => provider.enabled && provider.type !== type),
    };
}

function normalizeChannel(item: Partial<AdminModelChannel> = {}): AdminModelChannel {
    return {
        id: item.id || "",
        protocol: item.protocol || "openai",
        name: item.name || "",
        baseUrl: item.baseUrl || "",
        apiKey: item.apiKey || "",
        models: item.models || [],
        groups: item.groups?.length ? item.groups : ["default"],
        modelCapabilities: item.modelCapabilities || {},
        parameterTranslation: item.parameterTranslation || "",
        uploadApiKey: item.uploadApiKey || "",
        bridgeId: item.bridgeId || "",
        comfyUrl: item.comfyUrl || "",
        workflowDir: item.workflowDir || "",
        workflows: item.workflows || [],
        weight: Math.max(1, Number(item.weight) || 1),
        timeout: Math.max(1, Number(item.timeout) || 600),
        enabled: item.enabled !== false,
        remark: item.remark || "",
    };
}

const defaultPricingGroups: AdminModelGroup[] = [{ id: "default", name: "默认分组", ratio: 1, desc: "" }];

const billingModeOptions = [
    { value: "image", label: "按张" },
    { value: "second", label: "按秒" },
    { value: "request", label: "按次" },
];

function billingUnitLabel(mode: string) {
    if (mode === "second") return "元/秒";
    if (mode === "request") return "元/次";
    return "元/张";
}

function findModelCostEntry(items: AdminModelCost[], model: string, resolution = "") {
    return items.find((item) => item.model === model && (item.resolution || "") === resolution);
}

function modelCostPrice(items: AdminModelCost[], model: string, resolution = "") {
    return findModelCostEntry(items, model, resolution)?.price || 0;
}

function modelCostMode(items: AdminModelCost[], model: string, resolution = "", fallback = "image") {
    return findModelCostEntry(items, model, resolution)?.billingMode || (resolution ? "second" : fallback);
}

type ModelCostPatch = {
    model: string;
    resolution?: string;
    previousResolution?: string;
    billingMode?: string;
    price?: number;
};

function setModelCost(form: any, setModelCosts: (items: AdminModelCost[]) => void, patch: ModelCostPatch) {
    const current = (form.getFieldValue(["public", "modelChannel", "modelCosts"]) || []) as AdminModelCost[];
    const resolution = patch.resolution || "";
    const previousResolution = patch.previousResolution ?? resolution;
    const existed = current.find((item) => item.model === patch.model && (item.resolution || "") === previousResolution);
    const next = current.filter((item) => item.model !== patch.model || (item.resolution || "") !== previousResolution);
    const mode = patch.billingMode ?? existed?.billingMode ?? (resolution ? "second" : "image");
    const price = patch.price ?? existed?.price ?? 0;
    next.push({ model: patch.model, resolution, billingMode: mode as AdminModelCost["billingMode"], price: Math.max(0, price), credits: 0, vendor: existed?.vendor || "", tags: existed?.tags || [] });
    form.setFieldValue(["public", "modelChannel", "modelCosts"], next);
    setModelCosts(next);
}

function updatePricingGroupIn(items: AdminModelGroup[], id: string, patch: Partial<AdminModelGroup>) {
    return items.map((group) => (group.id === id ? { ...group, ...patch } : group));
}

function addModelResolutionCost(form: any, setModelCosts: (items: AdminModelCost[]) => void, model: string) {
    const current = (form.getFieldValue(["public", "modelChannel", "modelCosts"]) || []) as AdminModelCost[];
    const resolution = videoResolutionOptions.find((option) => !current.some((item) => item.model === model && item.resolution === option.value))?.value;
    if (resolution) setModelCost(form, setModelCosts, { model, resolution, billingMode: "second" });
}

function removeModelCost(form: any, setModelCosts: (items: AdminModelCost[]) => void, model: string, resolution: string) {
    const current = (form.getFieldValue(["public", "modelChannel", "modelCosts"]) || []) as AdminModelCost[];
    const next = current.filter((item) => item.model !== model || item.resolution !== resolution);
    form.setFieldValue(["public", "modelChannel", "modelCosts"], next);
    setModelCosts(next);
}

type BulkImportValues = {
    namePrefix: string;
    protocol: AdminModelChannel["protocol"];
    baseUrl: string;
    models: string[];
    groups: string[];
    keys: string;
    weight: number;
    timeout: number;
};

// buildBulkChannels 把一行一个的 API Key 展开成渠道列表，名称自动编号并跳过重复 Key。
function buildBulkChannels(values: BulkImportValues, existing: AdminModelChannel[]) {
    const baseUrl = (values.baseUrl || "").trim();
    const models = uniqueModels(values.models || []);
    const prefix = (values.namePrefix || "").trim() || hostLabel(baseUrl);
    const existingKeys = new Set(existing.filter((channel) => channel.baseUrl === baseUrl).map((channel) => channel.apiKey).filter(Boolean));
    const existingNames = new Set(existing.map((channel) => channel.name));
    const channels: AdminModelChannel[] = [];
    let skipped = 0;
    let seq = 0;
    for (const raw of (values.keys || "").split(/\r?\n/)) {
        const key = raw.trim();
        if (!key || key.startsWith("#")) continue;
        if (existingKeys.has(key)) {
            skipped += 1;
            continue;
        }
        existingKeys.add(key);
        let name = "";
        do {
            seq += 1;
            name = `${prefix}-${seq}`;
        } while (existingNames.has(name));
        existingNames.add(name);
        channels.push(
            normalizeChannel({
                id: "",
                protocol: values.protocol,
                name,
                baseUrl,
                apiKey: key,
                models,
                groups: values.groups,
                weight: Math.max(1, Number(values.weight) || 1),
                timeout: Math.max(1, Number(values.timeout) || 600),
                enabled: true,
                remark: "批量导入",
            }),
        );
    }
    return { channels, skipped };
}

function countBulkKeys(keys: string) {
    return (keys || "").split(/\r?\n/).filter((key) => key.trim() && !key.trim().startsWith("#")).length;
}

function hostLabel(baseUrl: string) {
    try {
        return new URL(baseUrl).hostname.replace(/\./g, "-") || "channel";
    } catch {
        return "channel";
    }
}

function mergeChannelApiKeys(currentChannels: AdminModelChannel[], saved: AdminSettings): AdminSettings {
    const channels = saved.private.channels.map((item, index) => {
        const source = isWorkflowProtocol(item.protocol) ? currentChannels.find((channel) => channel.id === item.id && channel.protocol === item.protocol) : currentChannels[index];
        return { ...item, apiKey: source?.apiKey || item.apiKey, uploadApiKey: source?.uploadApiKey || item.uploadApiKey };
    });
    return {
        public: saved.public,
        private: { ...saved.private, channels },
    };
}

function collectChannelModels(channels: AdminModelChannel[]) {
    return uniqueModels(channels.filter((channel) => channel.enabled && !isWorkflowProtocol(channel.protocol)).flatMap((channel) => channel.models || []));
}

function collectChannelWorkflows(channels: AdminModelChannel[]) {
    return channels.flatMap((channel) => isWorkflowProtocol(channel.protocol) ? (channel.workflows || []).filter((entry) => entry.enabled && entry.provider === channel.protocol).map((entry) => ({ label: `${channel.name} · ${entry.title || entry.workflowId}（工作流）`, value: `workflow:system:${channel.id}:${entry.kind}:${entry.workflowId}` })) : []);
}

function collectKnownModels(settings: AdminSettings) {
    return uniqueModels([...(settings.public.modelChannel.availableModels || []), ...(settings.public.modelChannel.modelCosts || []).map((item) => item.model), ...settings.private.channels.flatMap((channel) => channel.models || [])]);
}

function uniqueModels(models: string[]) {
    return Array.from(new Set(models.filter(Boolean)));
}

function filterModels(models: string[], options: string[]) {
    const optionSet = new Set(options);
    return uniqueModels(models).filter((model) => optionSet.has(model));
}

function modelSummary(models: string[]) {
    if (!models.length) return "未配置模型";
    const preview = models.slice(0, 3).join(", ");
    return models.length > 3 ? `${models.length} 个模型：${preview}...` : preview;
}

function formatStorageBytes(bytes: number) {
    if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
    const units = ["B", "KB", "MB", "GB", "TB"];
    let value = bytes;
    let index = 0;
    while (value >= 1024 && index < units.length - 1) {
        value /= 1024;
        index += 1;
    }
    return `${value.toFixed(index === 0 ? 0 : 2)} ${units[index]}`;
}

function parseTabJson(tab: "public", value: string): AdminSettings["public"] | null;
function parseTabJson(tab: "private", value: string): AdminSettings["private"] | null;
function parseTabJson(tab: SettingsTabKey, value: string): AdminSettings[SettingsTabKey] | null;
function parseTabJson(tab: SettingsTabKey, value: string): AdminSettings[SettingsTabKey] | null {
    try {
        return tab === "public" ? normalizePublicSetting(JSON.parse(value) as Partial<AdminSettings["public"]>) : normalizePrivateSetting(JSON.parse(value) as Partial<AdminSettings["private"]>);
    } catch {
        return null;
    }
}

async function collectSettings(form: any, editorMode: Record<SettingsTabKey, EditorMode>, jsonText: Record<SettingsTabKey, string>, message: { error: (value: string) => void }) {
    const values = normalizeSettings(form.getFieldsValue(true) as AdminSettings);
    if (editorMode.public === "json") {
        const publicSetting = parseTabJson("public", jsonText.public);
        if (!publicSetting) {
            message.error("公开配置 JSON 格式不正确");
            return null;
        }
        values.public = publicSetting;
    }
    if (editorMode.private === "json") {
        const privateSetting = parseTabJson("private", jsonText.private);
        if (!privateSetting) {
            message.error("私有配置 JSON 格式不正确");
            return null;
        }
        values.private = privateSetting;
    }
    values.public.modelChannel.availableModels = filterModels(values.public.modelChannel.availableModels, collectChannelModels(values.private.channels));
    values.public.modelChannel.availableWorkflows = filterModels(values.public.modelChannel.availableWorkflows, collectChannelWorkflows(values.private.channels).map((item) => item.value));
    return normalizeSettings(values);
}

function getJsonError(value: string) {
    try {
        JSON.parse(value);
        return "";
    } catch (error) {
        return error instanceof Error ? error.message : "JSON 格式不正确";
    }
}
