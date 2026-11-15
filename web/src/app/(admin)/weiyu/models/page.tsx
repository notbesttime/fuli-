"use client";

import { DeleteOutlined, EditOutlined, PlusOutlined, ReloadOutlined, SyncOutlined } from "@ant-design/icons";
import { ProTable, type ProColumns } from "@ant-design/pro-components";
import { Alert, Button, Card, Col, Flex, Form, Input, InputNumber, Modal, Popconfirm, Row, Select, Space, Tabs, Tag, Tooltip, Typography } from "antd";
import { useEffect, useMemo, useState } from "react";

import type { AdminBillingMode, AdminModelCost, AdminModelGroup } from "@/services/api/admin";
import { useAdminModels } from "./use-admin-models";

const billingModeLabels: Record<string, string> = { image: "按张", second: "按秒", request: "按次" };
const billingModeOptions = [
    { label: "按张", value: "image" },
    { label: "按秒", value: "second" },
    { label: "按次", value: "request" },
];

type CostFormValues = { model: string; resolution: string; billingMode: AdminBillingMode; price: number; credits: number; vendor: string; tags: string[] };

export default function AdminModelsPage() {
    const { costs, groups, creditRate, currency, modelOptions, channelModels, availableModels, defaults, isLoading, isSaving, unitsFor, saveCosts, savePricing, saveDefaults, saveAvailableModels } = useAdminModels();
    const channelModelOptions = useMemo(() => channelModels.map((model) => ({ label: model, value: model })), [channelModels]);
    const [costForm] = Form.useForm<CostFormValues>();
    const [groupForm] = Form.useForm<{ id: string; name: string; ratio: number; desc: string }>();
    const [defaultForm] = Form.useForm<{ defaultModel: string; defaultImageModel: string; defaultVideoModel: string; defaultTextModel: string; availableModels: string[] }>();
    const [costEditing, setCostEditing] = useState<{ index: number | null } | null>(null);
    const [groupEditing, setGroupEditing] = useState<{ index: number | null } | null>(null);
    const [selectedCostKeys, setSelectedCostKeys] = useState<string[]>([]);
    const [rateDraft, setRateDraft] = useState<number>(creditRate);

    useEffect(() => setRateDraft(creditRate), [creditRate]);
    useEffect(() => {
        defaultForm.setFieldsValue({ ...defaults, availableModels });
    }, [availableModels, defaultForm, defaults]);

    const costRowKey = (index: number) => String(index);

    const openCostEditor = (index: number | null) => {
        const cost = index === null ? null : costs[index];
        costForm.setFieldsValue({
            model: cost?.model || "",
            resolution: cost?.resolution || "",
            billingMode: (cost?.billingMode as AdminBillingMode) || "image",
            price: Number(cost?.price) || 0,
            credits: Number(cost?.credits) || 0,
            vendor: cost?.vendor || "",
            tags: cost?.tags || [],
        });
        setCostEditing({ index });
    };

    const submitCost = async () => {
        const values = await costForm.validateFields();
        const price = Math.max(0, Number(values.price) || 0);
        const next: AdminModelCost = {
            model: values.model.trim(),
            resolution: (values.resolution || "").trim(),
            billingMode: values.billingMode,
            price,
            credits: price > 0 ? unitsFor(price) : Math.max(0, Number(values.credits) || 0),
            vendor: (values.vendor || "").trim(),
            tags: values.tags || [],
        };
        const list = costEditing?.index === null || costEditing?.index === undefined ? [...costs, next] : costs.map((item, index) => (index === costEditing.index ? next : item));
        await saveCosts(list);
        setCostEditing(null);
    };

    const removeCosts = async (indices: number[]) => {
        const removeSet = new Set(indices);
        await saveCosts(costs.filter((_, index) => !removeSet.has(index)));
        setSelectedCostKeys([]);
    };

    const openGroupEditor = (index: number | null) => {
        const group = index === null ? null : groups[index];
        groupForm.setFieldsValue({ id: group?.id || "", name: group?.name || "", ratio: Number(group?.ratio) || 1, desc: group?.desc || "" });
        setGroupEditing({ index });
    };

    const submitGroup = async () => {
        const values = await groupForm.validateFields();
        const next: AdminModelGroup = { id: values.id.trim(), name: (values.name || "").trim() || values.id.trim(), ratio: Math.max(0.0001, Number(values.ratio) || 1), desc: (values.desc || "").trim() };
        const list = groupEditing?.index === null || groupEditing?.index === undefined ? [...groups, next] : groups.map((item, index) => (index === groupEditing.index ? next : item));
        await savePricing({ creditRate: rateDraft, groups: list });
        setGroupEditing(null);
    };

    const removeGroup = async (index: number) => {
        await savePricing({ creditRate: rateDraft, groups: groups.filter((_, current) => current !== index) });
    };

    const costColumns: ProColumns<AdminModelCost>[] = [
        { title: "模型", dataIndex: "model", width: 220, render: (_, item) => <Typography.Text strong copyable={{ text: item.model }}>{item.model}</Typography.Text> },
        { title: "分辨率", dataIndex: "resolution", width: 110, render: (_, item) => item.resolution || <Typography.Text type="secondary">-</Typography.Text> },
        { title: "计费方式", dataIndex: "billingMode", width: 100, render: (_, item) => <Tag>{billingModeLabels[item.billingMode || "image"] || item.billingMode}</Tag> },
        {
            title: `单价（${currency}）`,
            dataIndex: "price",
            width: 120,
            render: (_, item) => (Number(item.price) > 0 ? Number(item.price).toFixed(4) : <Typography.Text type="secondary">未设置</Typography.Text>),
        },
        {
            title: "算力点",
            dataIndex: "credits",
            width: 110,
            render: (_, item) => {
                const units = Number(item.price) > 0 ? unitsFor(Number(item.price)) : Number(item.credits) || 0;
                return <Typography.Text type="secondary">{units}</Typography.Text>;
            },
        },
        { title: "厂商", dataIndex: "vendor", width: 110, render: (_, item) => item.vendor || "-" },
        {
            title: "标签",
            dataIndex: "tags",
            width: 160,
            render: (_, item) => (
                <Space size={2} wrap>
                    {(item.tags || []).map((tag) => (
                        <Tag key={tag}>{tag}</Tag>
                    ))}
                    {!(item.tags || []).length ? <Typography.Text type="secondary">-</Typography.Text> : null}
                </Space>
            ),
        },
        {
            title: "操作",
            key: "actions",
            width: 100,
            render: (_, item, index) => (
                <Space size={2}>
                    <Button type="text" size="small" icon={<EditOutlined />} onClick={() => openCostEditor(index)} />
                    <Popconfirm title={`确认删除「${item.model}」的价格配置？`} onConfirm={() => void removeCosts([index])} okText="删除" cancelText="取消">
                        <Button type="text" size="small" danger icon={<DeleteOutlined />} />
                    </Popconfirm>
                </Space>
            ),
        },
    ];

    const groupColumns: ProColumns<AdminModelGroup>[] = [
        { title: "分组 ID", dataIndex: "id", width: 160, render: (_, item) => <Typography.Text code>{item.id}</Typography.Text> },
        { title: "名称", dataIndex: "name", width: 180 },
        { title: "倍率", dataIndex: "ratio", width: 110 },
        { title: "说明", dataIndex: "desc", render: (_, item) => item.desc || "-" },
        {
            title: "操作",
            key: "actions",
            width: 110,
            render: (_, item, index) => {
                return (
                    <Space size={2}>
                        <Button type="text" size="small" icon={<EditOutlined />} onClick={() => openGroupEditor(index)} />
                        <Tooltip title={item.id === "default" ? "默认分组不可删除" : "删除"}>
                            <Button type="text" size="small" danger disabled={item.id === "default"} icon={<DeleteOutlined />} onClick={() => void removeGroup(index)} />
                        </Tooltip>
                    </Space>
                );
            },
        },
    ];

    const selectedCostIndices = selectedCostKeys.map((key) => Number(key)).filter((index) => Number.isInteger(index) && index >= 0);

    const costTab = (
        <Flex vertical gap={12}>
            <Typography.Text type="secondary">
                单价（{currency}）是计费基准，算力点 = 单价 ÷ 汇率 × 调用组倍率。单价留空（0）时可单独填算力点，此时按算力点计费。
            </Typography.Text>
            {selectedCostIndices.length ? (
                <Flex gap={8} align="center">
                    <Typography.Text type="secondary">已选 {selectedCostIndices.length} 项</Typography.Text>
                    <Button size="small" danger onClick={() => void removeCosts(selectedCostIndices)} loading={isSaving}>
                        批量删除
                    </Button>
                    <Button size="small" type="link" onClick={() => setSelectedCostKeys([])}>
                        取消选择
                    </Button>
                </Flex>
            ) : null}
            <ProTable<AdminModelCost>
                rowKey={(item) => String(costs.indexOf(item))}
                columns={costColumns}
                dataSource={costs}
                loading={isLoading || isSaving}
                search={false}
                defaultSize="middle"
                tableLayout="fixed"
                cardProps={{ variant: "borderless" }}
                headerTitle={
                    <Space>
                        <Typography.Text strong>模型价格</Typography.Text>
                        <Tag>{costs.length} 条</Tag>
                        <Button size="small" type="primary" icon={<PlusOutlined />} onClick={() => openCostEditor(null)}>
                            新增模型价格
                        </Button>
                    </Space>
                }
                options={{ density: true, setting: true }}
                rowSelection={{ selectedRowKeys: selectedCostKeys, onChange: (keys) => setSelectedCostKeys(keys as string[]) }}
                pagination={{ pageSize: 20, showSizeChanger: true, showTotal: (value) => `共 ${value} 条` }}
            />
        </Flex>
    );

    const groupTab = (
        <Flex vertical gap={12}>
            <Card size="small" variant="borderless">
                <Flex gap={12} align="center" wrap>
                    <Typography.Text strong>算力点汇率</Typography.Text>
                    <InputNumber min={0.0001} step={0.1} value={rateDraft} onChange={(value) => setRateDraft(Number(value) || 1)} style={{ width: 160 }} addonAfter={currency} />
                    <Typography.Text type="secondary">1 元 = {Math.round((1 / (rateDraft || 1)) * 10000) / 10000} 算力点</Typography.Text>
                    <Button loading={isSaving} onClick={() => void savePricing({ creditRate: Math.max(0.0001, rateDraft || 1), groups })}>
                        保存汇率
                    </Button>
                </Flex>
            </Card>
            <ProTable<AdminModelGroup>
                rowKey="id"
                columns={groupColumns}
                dataSource={groups}
                loading={isLoading || isSaving}
                search={false}
                defaultSize="middle"
                tableLayout="fixed"
                cardProps={{ variant: "borderless" }}
                headerTitle={
                    <Space>
                        <Typography.Text strong>调用组倍率</Typography.Text>
                        <Tag>{groups.length} 个</Tag>
                        <Button size="small" type="primary" icon={<PlusOutlined />} onClick={() => openGroupEditor(null)}>
                            新增调用组
                        </Button>
                    </Space>
                }
                options={{ density: true, setting: true }}
                pagination={false}
            />
        </Flex>
    );

    const defaultTab = (
        <Card variant="borderless">
            <Alert
                type={channelModels.length ? "info" : "warning"}
                showIcon
                style={{ marginBottom: 16 }}
                message={
                    channelModels.length
                        ? `可用模型来自已启用渠道（当前 ${channelModels.length} 个）；下方的「可用模型」用于进一步收窄模型广场的展示范围，留空表示全部展示。`
                        : "当前没有已启用的渠道，因此没有可选模型。请先在「渠道管理」中添加并启用渠道，模型白名单与默认模型才有意义。"
                }
            />
            <Form form={defaultForm} layout="vertical" requiredMark={false}>
                <Row gutter={[16, 12]}>
                    <Col span={12}>
                        <Form.Item name="defaultModel" label="默认模型">
                            <Select allowClear showSearch options={channelModelOptions} placeholder="未设置" />
                        </Form.Item>
                    </Col>
                    <Col span={12}>
                        <Form.Item name="defaultImageModel" label="默认绘图模型">
                            <Select allowClear showSearch options={channelModelOptions} placeholder="未设置" />
                        </Form.Item>
                    </Col>
                    <Col span={12}>
                        <Form.Item name="defaultVideoModel" label="默认视频模型">
                            <Select allowClear showSearch options={channelModelOptions} placeholder="未设置" />
                        </Form.Item>
                    </Col>
                    <Col span={12}>
                        <Form.Item name="defaultTextModel" label="默认文本模型">
                            <Select allowClear showSearch options={channelModelOptions} placeholder="未设置" />
                        </Form.Item>
                    </Col>
                    <Col span={24}>
                        <Form.Item name="availableModels" label="可用模型（白名单）" extra="只能来自已启用渠道的模型；留空表示全部展示，保存后会自动与渠道模型求交集">
                            <Select mode="multiple" options={channelModelOptions} placeholder="留空 = 全部渠道模型" />
                        </Form.Item>
                    </Col>
                    <Col span={24}>
                        <Space>
                            <Button
                                icon={<SyncOutlined />}
                                loading={isSaving}
                                onClick={() => {
                                    defaultForm.setFieldsValue({ availableModels: channelModels });
                                    void saveAvailableModels(channelModels);
                                }}
                            >
                                从已启用渠道同步
                            </Button>
                            <Button
                                type="primary"
                                loading={isSaving}
                                onClick={async () => {
                                    const values = await defaultForm.validateFields();
                                    await saveDefaults({
                                        defaultModel: values.defaultModel || "",
                                        defaultImageModel: values.defaultImageModel || "",
                                        defaultVideoModel: values.defaultVideoModel || "",
                                        defaultTextModel: values.defaultTextModel || "",
                                    });
                                    await saveAvailableModels(values.availableModels || []);
                                }}
                            >
                                保存
                            </Button>
                            <Button icon={<ReloadOutlined />} onClick={() => defaultForm.setFieldsValue({ ...defaults, availableModels })}>
                                重置
                            </Button>
                        </Space>
                    </Col>
                </Row>
            </Form>
        </Card>
    );

    return (
        <main style={{ padding: 24 }}>
            <Card variant="borderless">
                <Tabs
                    defaultActiveKey="costs"
                    items={[
                        { key: "costs", label: "模型价格", children: costTab },
                        { key: "groups", label: "调用组与汇率", children: groupTab },
                        { key: "defaults", label: "默认模型", children: defaultTab },
                    ]}
                />
            </Card>

            <Modal
                title={costEditing?.index === null ? "新增模型价格" : "编辑模型价格"}
                open={Boolean(costEditing)}
                width={680}
                onCancel={() => setCostEditing(null)}
                onOk={() => void submitCost()}
                okText="保存"
                cancelText="取消"
                confirmLoading={isSaving}
                destroyOnHidden
            >
                <Form form={costForm} layout="vertical" requiredMark={false}>
                    <Row gutter={14}>
                        <Col span={14}>
                            <Form.Item name="model" label="模型名" rules={[{ required: true, message: "请输入模型名" }]}>
                                <Select mode="tags" maxCount={1} tokenSeparators={[",", " "]} options={modelOptions.map((model) => ({ label: model, value: model }))} placeholder="选择或输入模型名" />
                            </Form.Item>
                        </Col>
                        <Col span={10}>
                            <Form.Item name="resolution" label="分辨率 / 规格">
                                <Input placeholder="可选，如 1024x1024" />
                            </Form.Item>
                        </Col>
                        <Col span={10}>
                            <Form.Item name="billingMode" label="计费方式" rules={[{ required: true, message: "请选择计费方式" }]}>
                                <Select options={billingModeOptions} />
                            </Form.Item>
                        </Col>
                        <Col span={7}>
                            <Form.Item name="price" label={`单价（${currency}）`}>
                                <InputNumber min={0} step={0.01} style={{ width: "100%" }} placeholder="0 表示按算力点" />
                            </Form.Item>
                        </Col>
                        <Col span={7}>
                            <Form.Item name="credits" label="算力点（单价为 0 时生效）">
                                <InputNumber min={0} step={0.1} style={{ width: "100%" }} />
                            </Form.Item>
                        </Col>
                        <Col span={12}>
                            <Form.Item name="vendor" label="厂商">
                                <Input placeholder="可选，如 OpenAI" />
                            </Form.Item>
                        </Col>
                        <Col span={12}>
                            <Form.Item name="tags" label="标签">
                                <Select mode="tags" tokenSeparators={[",", " "]} placeholder="可选，如 图像、旗舰" />
                            </Form.Item>
                        </Col>
                    </Row>
                </Form>
            </Modal>

            <Modal
                title={groupEditing?.index === null ? "新增调用组" : "编辑调用组"}
                open={Boolean(groupEditing)}
                width={560}
                onCancel={() => setGroupEditing(null)}
                onOk={() => void submitGroup()}
                okText="保存"
                cancelText="取消"
                confirmLoading={isSaving}
                destroyOnHidden
            >
                <Form form={groupForm} layout="vertical" requiredMark={false}>
                    <Row gutter={14}>
                        <Col span={12}>
                            <Form.Item name="id" label="分组 ID" rules={[{ required: true, message: "请输入分组 ID" }]} extra="创建后作为路由与计费标识，请勿随意修改">
                                <Input maxLength={64} placeholder="如 vip" disabled={groupEditing?.index !== null} />
                            </Form.Item>
                        </Col>
                        <Col span={12}>
                            <Form.Item name="name" label="名称">
                                <Input maxLength={64} placeholder="如 高级分组" />
                            </Form.Item>
                        </Col>
                        <Col span={12}>
                            <Form.Item name="ratio" label="倍率" rules={[{ required: true, message: "请输入倍率" }]}>
                                <InputNumber min={0.0001} step={0.1} style={{ width: "100%" }} />
                            </Form.Item>
                        </Col>
                        <Col span={12}>
                            <Form.Item name="desc" label="说明">
                                <Input maxLength={200} placeholder="可选" />
                            </Form.Item>
                        </Col>
                    </Row>
                </Form>
            </Modal>
        </main>
    );
}
