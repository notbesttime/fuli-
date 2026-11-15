"use client";

import { DeleteOutlined, EditOutlined, PlusOutlined, ReloadOutlined, SearchOutlined, ThunderboltOutlined } from "@ant-design/icons";
import { ProTable, type ProColumns } from "@ant-design/pro-components";
import { Button, Card, Col, Flex, Form, Input, InputNumber, Modal, Popconfirm, Row, Select, Space, Switch, Tag, Tooltip, Typography } from "antd";
import dayjs from "dayjs";
import { useEffect, useMemo, useState } from "react";

import { isWorkflowProtocol, modelChannelDefaultBaseUrls, modelChannelProtocolOptions } from "@/lib/model-channel";
import type { AdminChannelHealthInfo, AdminModelChannel } from "@/services/api/admin";
import { useAdminChannels } from "./use-admin-channels";

type ChannelFormValues = {
    name: string;
    protocol: AdminModelChannel["protocol"];
    baseUrl: string;
    apiKey: string;
    models: string[];
    groups: string[];
    weight: number;
    timeout: number;
    enabled: boolean;
    remark: string;
};

const healthReasonLabels: Record<string, string> = {
    key_invalid: "密钥失效",
    suspended: "账号封禁",
    quota: "额度耗尽",
    rate_limit: "限流",
    upstream_error: "上游波动",
};

function emptyChannel(): AdminModelChannel {
    return { id: "", protocol: "openai", name: "", baseUrl: modelChannelDefaultBaseUrls.openai, apiKey: "", models: [], groups: ["default"], weight: 1, timeout: 600, enabled: true, remark: "" };
}

function healthTag(info: AdminChannelHealthInfo | undefined) {
    if (!info) return <Tag color="green">正常</Tag>;
    if (info.status === "cooling" && info.cooldownUntil && dayjs(info.cooldownUntil).isAfter(dayjs())) {
        return <Tag color="red">冷却至 {dayjs(info.cooldownUntil).format("HH:mm")}</Tag>;
    }
    if (info.failures > 0) return <Tag color="orange">失败 {info.failures} 次</Tag>;
    return <Tag color="default">待恢复</Tag>;
}

export default function AdminChannelsPage() {
    const { channels, groups, healthMap, isLoading, isSaving, createChannel, updateChannel, toggleChannel, setChannelsEnabled, removeChannels, testChannel, fetchModels, restoreHealth, refresh } = useAdminChannels();
    const [form] = Form.useForm<ChannelFormValues>();
    const protocolValue = Form.useWatch("protocol", form);
    const [editingIndex, setEditingIndex] = useState<number | null>(null);
    const [creating, setCreating] = useState(false);
    const [testingKey, setTestingKey] = useState<string | null>(null);
    const [fetchingModels, setFetchingModels] = useState(false);
    const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
    const [keyword, setKeyword] = useState("");
    const [keywordText, setKeywordText] = useState("");
    const [groupFilter, setGroupFilter] = useState<string>("");
    const [statusFilter, setStatusFilter] = useState<string>("");

    const groupOptions = useMemo(() => {
        const list = groups.length ? groups : [{ id: "default", name: "默认分组", ratio: 1 }];
        return list.map((group) => ({ label: group.name || group.id, value: group.id }));
    }, [groups]);

    const rowKey = (index: number) => String(index);

    const filtered = useMemo(() => {
        const text = keyword.trim().toLowerCase();
        return channels
            .map((channel, index) => ({ channel, index }))
            .filter(({ channel }) => {
                if (text) {
                    const haystack = [channel.name, channel.baseUrl, channel.remark, ...(channel.models || [])].join(" ").toLowerCase();
                    if (!haystack.includes(text)) return false;
                }
                if (groupFilter && !(channel.groups || []).includes(groupFilter)) return false;
                if (statusFilter === "enabled" && !channel.enabled) return false;
                if (statusFilter === "disabled" && channel.enabled) return false;
                return true;
            });
    }, [channels, groupFilter, keyword, statusFilter]);

    const openCreate = () => {
        form.setFieldsValue(viewToForm(emptyChannel()));
        setCreating(true);
    };

    const openEdit = (index: number) => {
        form.setFieldsValue(viewToForm(channels[index]));
        setEditingIndex(index);
    };

    const closeEditor = () => {
        setCreating(false);
        setEditingIndex(null);
    };

    useEffect(() => {
        if (!creating && editingIndex === null) return;
        const index = editingIndex;
        const channel = index === null ? emptyChannel() : channels[index];
        if (channel) form.setFieldsValue(viewToForm(channel));
    }, [channels, creating, editingIndex, form]);

    const submit = async () => {
        const values = await form.validateFields();
        const isNew = editingIndex === null;
        const base = isNew ? emptyChannel() : channels[editingIndex];
        const next: AdminModelChannel = { ...base, ...formToChannel(values), id: base.id };
        if (isNew && !isWorkflowProtocol(values.protocol) && !values.apiKey.trim()) {
            form.setFields([{ name: "apiKey", errors: ["新建渠道必须填写 API Key"] }]);
            return;
        }
        if (isNew) await createChannel(next);
        else await updateChannel(editingIndex as number, next);
        closeEditor();
    };

    const runTest = async (index: number, channel: AdminModelChannel, model: string) => {
        setTestingKey(rowKey(index));
        try {
            await testChannel(index, channel, model);
        } catch (error) {
            Modal.error({ title: "渠道测试失败", content: error instanceof Error ? error.message : "未知错误" });
        } finally {
            setTestingKey(null);
        }
    };

    const pullModels = async () => {
        const values = form.getFieldsValue();
        const index = editingIndex;
        const channel: AdminModelChannel = { ...emptyChannel(), ...values, id: index === null ? "" : channels[index].id };
        setFetchingModels(true);
        try {
            const models = await fetchModels(index ?? -1, channel);
            const merged = Array.from(new Set([...(values.models || []), ...models]));
            form.setFieldsValue({ models: merged });
            Modal.success({ title: "获取成功", content: `共获取 ${models.length} 个模型，已合并到模型列表` });
        } catch (error) {
            Modal.error({ title: "获取模型失败", content: error instanceof Error ? error.message : "未知错误" });
        } finally {
            setFetchingModels(false);
        }
    };

    const columns: ProColumns<{ channel: AdminModelChannel; index: number }>[] = [
        {
            title: "渠道",
            dataIndex: ["channel", "name"],
            width: 210,
            render: (_, row) => (
                <Flex vertical style={{ minWidth: 0 }}>
                    <Typography.Text strong ellipsis>
                        {row.channel.name || "未命名"}
                    </Typography.Text>
                    <Space size={4}>
                        <Tag color="blue">{modelChannelProtocolOptions.find((item) => item.value === row.channel.protocol)?.label || row.channel.protocol}</Tag>
                        {row.channel.remark ? <Typography.Text type="secondary" style={{ fontSize: 12 }} ellipsis>{row.channel.remark}</Typography.Text> : null}
                    </Space>
                </Flex>
            ),
        },
        {
            title: "接口地址",
            dataIndex: ["channel", "baseUrl"],
            width: 220,
            render: (_, row) => <Typography.Text type="secondary" copyable={{ text: row.channel.baseUrl }} ellipsis style={{ maxWidth: 200 }}>{row.channel.baseUrl || "-"}</Typography.Text>,
        },
        {
            title: "模型",
            dataIndex: ["channel", "models"],
            width: 200,
            render: (_, row) => {
                const models = row.channel.models || [];
                if (!models.length) return <Typography.Text type="secondary">未配置</Typography.Text>;
                return (
                    <Tooltip title={models.join("、")}>
                        <Tag>{models.length} 个</Tag>
                        <Typography.Text type="secondary" style={{ fontSize: 12 }} ellipsis>{models.slice(0, 2).join(", ")}{models.length > 2 ? "…" : ""}</Typography.Text>
                    </Tooltip>
                );
            },
        },
        {
            title: "调用组",
            dataIndex: ["channel", "groups"],
            width: 150,
            render: (_, row) => (
                <Space size={2} wrap>
                    {(row.channel.groups || ["default"]).map((group) => (
                        <Tag key={group}>{groupOptions.find((option) => option.value === group)?.label || group}</Tag>
                    ))}
                </Space>
            ),
        },
        { title: "权重", dataIndex: ["channel", "weight"], width: 70 },
        { title: "超时", dataIndex: ["channel", "timeout"], width: 80, render: (_, row) => `${row.channel.timeout}s` },
        {
            title: "健康",
            key: "health",
            width: 150,
            render: (_, row) => {
                const info = healthMap.get(row.channel.id);
                return (
                    <Space size={4}>
                        {healthTag(info)}
                        {info ? (
                            <Tooltip title={info.upstreamError || healthReasonLabels[info.reason] || "恢复熔断"}>
                                <Button type="link" size="small" onClick={() => void restoreHealth(row.channel.id)}>
                                    恢复
                                </Button>
                            </Tooltip>
                        ) : null}
                    </Space>
                );
            },
        },
        {
            title: "启用",
            key: "enabled",
            width: 80,
            render: (_, row) => <Switch size="small" checked={row.channel.enabled} loading={isSaving} onChange={(checked) => void toggleChannel(row.index, checked)} />,
        },
        {
            title: "操作",
            key: "actions",
            width: 140,
            render: (_, row) => (
                <Space size={2}>
                    <Tooltip title="测试">
                        <Button
                            type="text"
                            size="small"
                            loading={testingKey === rowKey(row.index)}
                            icon={<ThunderboltOutlined />}
                            onClick={() => void runTest(row.index, row.channel, row.channel.models[0] || "")}
                        />
                    </Tooltip>
                    <Tooltip title="编辑">
                        <Button type="text" size="small" icon={<EditOutlined />} onClick={() => openEdit(row.index)} />
                    </Tooltip>
                    <Popconfirm
                        title={`确认删除渠道「${row.channel.name || "未命名"}」？`}
                        onConfirm={async () => {
                            await removeChannels([row.index]);
                            setSelectedKeys([]);
                        }}
                        okText="删除"
                        cancelText="取消"
                    >
                        <Button type="text" size="small" danger icon={<DeleteOutlined />} />
                    </Popconfirm>
                </Space>
            ),
        },
    ];

    const selectedIndices = selectedKeys.map((key) => Number(key)).filter((index) => Number.isInteger(index) && index >= 0);

    return (
        <main style={{ padding: 24 }}>
            <Flex vertical gap={16}>
                <Card variant="borderless">
                    <Row gutter={[16, 12]} align="bottom">
                        <Col flex="280px">
                            <Input.Search
                                value={keywordText}
                                placeholder="搜索渠道名称、地址或模型"
                                allowClear
                                enterButton={<SearchOutlined />}
                                onSearch={(value) => setKeyword(value)}
                                onChange={(event) => {
                                    setKeywordText(event.target.value);
                                    if (!event.target.value) setKeyword("");
                                }}
                            />
                        </Col>
                        <Col flex="160px">
                            <Select allowClear placeholder="全部调用组" value={groupFilter || undefined} onChange={(value) => setGroupFilter(value || "")} options={groupOptions} style={{ width: "100%" }} />
                        </Col>
                        <Col flex="140px">
                            <Select
                                allowClear
                                placeholder="全部状态"
                                value={statusFilter || undefined}
                                onChange={(value) => setStatusFilter(value || "")}
                                options={[
                                    { label: "已启用", value: "enabled" },
                                    { label: "已停用", value: "disabled" },
                                ]}
                                style={{ width: "100%" }}
                            />
                        </Col>
                        <Col flex="none">
                            <Space>
                                <Button icon={<ReloadOutlined />} onClick={() => void refresh()}>
                                    刷新
                                </Button>
                                <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
                                    新增渠道
                                </Button>
                            </Space>
                        </Col>
                    </Row>
                    {selectedIndices.length > 0 ? (
                        <Flex gap={8} align="center" style={{ marginTop: 12 }}>
                            <Typography.Text type="secondary">已选 {selectedIndices.length} 个</Typography.Text>
                            <Button
                                size="small"
                                onClick={async () => {
                                    await removeChannels(selectedIndices);
                                    setSelectedKeys([]);
                                }}
                                loading={isSaving}
                            >
                                批量删除
                            </Button>
                            <Button size="small" onClick={() => void setChannelsEnabled(selectedIndices, true)} loading={isSaving}>
                                批量启用
                            </Button>
                            <Button size="small" onClick={() => void setChannelsEnabled(selectedIndices, false)} loading={isSaving}>
                                批量停用
                            </Button>
                            <Button size="small" type="link" onClick={() => setSelectedKeys([])}>
                                取消选择
                            </Button>
                        </Flex>
                    ) : null}
                </Card>

                <ProTable<{ channel: AdminModelChannel; index: number }>
                    rowKey={(row) => rowKey(row.index)}
                    columns={columns}
                    dataSource={filtered}
                    loading={isLoading || isSaving}
                    search={false}
                    defaultSize="middle"
                    tableLayout="fixed"
                    cardProps={{ variant: "borderless" }}
                    headerTitle={
                        <Space>
                            <Typography.Text strong>渠道列表</Typography.Text>
                            <Tag>{channels.length} 个</Tag>
                            {healthMap.size > 0 ? <Tag color="orange">{healthMap.size} 个异常</Tag> : null}
                        </Space>
                    }
                    options={{ density: true, setting: true, reload: () => void refresh() }}
                    rowSelection={{
                        selectedRowKeys: selectedKeys,
                        onChange: (keys) => setSelectedKeys(keys as string[]),
                        preserveSelectedRowKeys: false,
                    }}
                    pagination={{ pageSize: 20, showSizeChanger: true, showTotal: (value) => `共 ${value} 个` }}
                />
            </Flex>

            <Modal
                title={creating ? "新增渠道" : "编辑渠道"}
                open={creating || editingIndex !== null}
                width={760}
                onCancel={closeEditor}
                onOk={() => void submit()}
                okText="保存"
                cancelText="取消"
                confirmLoading={isSaving}
                destroyOnHidden
            >
                <Form form={form} layout="vertical" requiredMark={false}>
                    <Row gutter={14}>
                        <Col span={12}>
                            <Form.Item name="name" label="渠道名称" rules={[{ required: true, message: "请输入渠道名称" }]}>
                                <Input maxLength={64} placeholder="例如：OpenAI 主账号" />
                            </Form.Item>
                        </Col>
                        <Col span={12}>
                            <Form.Item name="protocol" label="渠道类型" rules={[{ required: true, message: "请选择渠道类型" }]}>
                                <Select
                                    options={modelChannelProtocolOptions}
                                    onChange={(value: AdminModelChannel["protocol"]) => {
                                        const current = form.getFieldValue("baseUrl");
                                        if (!current) form.setFieldsValue({ baseUrl: modelChannelDefaultBaseUrls[value] });
                                    }}
                                />
                            </Form.Item>
                        </Col>
                        <Col span={24}>
                            <Form.Item name="baseUrl" label="接口地址" rules={[{ required: true, message: "请输入接口地址" }]}>
                                <Input placeholder="https://api.example.com" />
                            </Form.Item>
                        </Col>
                        <Col span={24}>
                            <Form.Item name="apiKey" label="API Key" extra="编辑时留空表示保留原密钥；新建渠道必须填写（工作流渠道除外）">
                                <Input.Password placeholder="留空则保留原密钥" autoComplete="new-password" />
                            </Form.Item>
                        </Col>
                        <Col span={24}>
                            <Form.Item label="模型" required={false}>
                                <Space.Compact style={{ width: "100%" }}>
                                    <Form.Item name="models" noStyle>
                                        <Select mode="tags" placeholder="输入模型名后回车，或点击右侧获取模型" tokenSeparators={[",", " "]} options={[]} />
                                    </Form.Item>
                                    <Button loading={fetchingModels} onClick={() => void pullModels()}>
                                        获取模型
                                    </Button>
                                </Space.Compact>
                            </Form.Item>
                        </Col>
                        <Col span={12}>
                            <Form.Item name="groups" label="调用组" rules={[{ required: true, message: "请至少选择一个调用组" }]}>
                                <Select mode="multiple" options={groupOptions} placeholder="该渠道可服务的调用组" />
                            </Form.Item>
                        </Col>
                        <Col span={6}>
                            <Form.Item name="weight" label="权重" rules={[{ required: true, message: "请输入权重" }]}>
                                <InputNumber min={1} max={1000} style={{ width: "100%" }} />
                            </Form.Item>
                        </Col>
                        <Col span={6}>
                            <Form.Item name="timeout" label="超时（秒）" rules={[{ required: true, message: "请输入超时" }]}>
                                <InputNumber min={1} max={3600} style={{ width: "100%" }} />
                            </Form.Item>
                        </Col>
                        <Col span={18}>
                            <Form.Item name="remark" label="备注">
                                <Input.TextArea rows={2} maxLength={200} placeholder="可选，例如余额、用途说明" />
                            </Form.Item>
                        </Col>
                        <Col span={6}>
                            <Form.Item name="enabled" label="启用" valuePropName="checked">
                                <Switch />
                            </Form.Item>
                        </Col>
                    </Row>
                    {protocolValue && isWorkflowProtocol(protocolValue) ? (
                        <Typography.Text type="warning" style={{ fontSize: 12 }}>
                            工作流渠道（RunningHub / ComfyUI）的工作流上传与字段映射请在「系统设置」中配置。
                        </Typography.Text>
                    ) : null}
                </Form>
            </Modal>
        </main>
    );
}

function viewToForm(channel: AdminModelChannel): ChannelFormValues {
    return {
        name: channel.name || "",
        protocol: channel.protocol,
        baseUrl: channel.baseUrl || "",
        apiKey: "",
        models: channel.models || [],
        groups: channel.groups?.length ? channel.groups : ["default"],
        weight: Math.max(1, Number(channel.weight) || 1),
        timeout: Math.max(1, Number(channel.timeout) || 600),
        enabled: channel.enabled !== false,
        remark: channel.remark || "",
    };
}

function formToChannel(values: ChannelFormValues): Partial<AdminModelChannel> {
    return {
        name: values.name.trim(),
        protocol: values.protocol,
        baseUrl: values.baseUrl.trim(),
        apiKey: (values.apiKey || "").trim(),
        models: values.models || [],
        groups: values.groups?.length ? values.groups : ["default"],
        weight: Math.max(1, Number(values.weight) || 1),
        timeout: Math.max(1, Number(values.timeout) || 600),
        enabled: values.enabled !== false,
        remark: values.remark || "",
    };
}
