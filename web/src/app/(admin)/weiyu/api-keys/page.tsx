"use client";

import { CheckCircleOutlined, DeleteOutlined, EditOutlined, ReloadOutlined, SearchOutlined, StopOutlined } from "@ant-design/icons";
import { ProTable, type ProColumns } from "@ant-design/pro-components";
import { Button, Card, Col, Flex, Form, Input, Modal, Popconfirm, Row, Select, Space, Switch, Tag, Tooltip, Typography } from "antd";
import dayjs from "dayjs";
import { useEffect, useState } from "react";

import type { AdminAPIKey, AdminModelGroup } from "@/services/api/admin";
import { useConfigStore } from "@/stores/use-config-store";
import { useAdminAPIKeys, type APIKeySaveInput } from "./use-admin-api-keys";

const defaultGroups: AdminModelGroup[] = [{ id: "default", name: "默认分组", ratio: 1, desc: "" }];

const statusFilterOptions = [
    { label: "启用", value: "active" },
    { label: "禁用", value: "disabled" },
];

type APIKeyFormValues = { name: string; group: string; expiresAt: string; active: boolean };

export default function AdminAPIKeysPage() {
    const { items, keyword, filters, page, pageSize, total, isLoading, search, setFilter, changePage, changePageSize, resetFilters, refresh, saveKey, setActive, deleteKey } = useAdminAPIKeys();
    const [form] = Form.useForm<APIKeyFormValues>();
    const pricingGroups = useConfigStore((state) => state.publicSettings?.modelChannel.pricing?.groups);
    const groupOptions = (pricingGroups?.length ? pricingGroups : defaultGroups).map((group) => ({ label: group.name || group.id, value: group.id }));
    const [keywordText, setKeywordText] = useState(keyword);
    const [editing, setEditing] = useState<AdminAPIKey | null>(null);
    const [deleting, setDeleting] = useState<AdminAPIKey | null>(null);

    useEffect(() => setKeywordText(keyword), [keyword]);

    useEffect(() => {
        if (editing) form.setFieldsValue({ name: editing.name, group: editing.group || "default", expiresAt: editing.expiresAt || "", active: editing.active });
    }, [editing, form]);

    const save = async () => {
        if (!editing) return;
        const value = await form.validateFields();
        const input: APIKeySaveInput = { name: value.name, group: value.group, expiresAt: (value.expiresAt || "").trim(), active: value.active };
        await saveKey(editing.id, input);
        setEditing(null);
    };

    const columns: ProColumns<AdminAPIKey>[] = [
        {
            title: "名称 / 前缀",
            dataIndex: "name",
            width: 200,
            render: (_, item) => (
                <Flex vertical style={{ minWidth: 0 }}>
                    <Typography.Text strong ellipsis>
                        {item.name || "-"}
                    </Typography.Text>
                    <Typography.Text type="secondary" style={{ fontFamily: "monospace", fontSize: 12 }}>
                        {item.prefix}…
                    </Typography.Text>
                </Flex>
            ),
        },
        {
            title: "用户",
            dataIndex: "userDisplayName",
            width: 170,
            render: (_, item) => (
                <Flex vertical style={{ minWidth: 0 }}>
                    <Typography.Text ellipsis>{item.userDisplayName || item.username || "-"}</Typography.Text>
                    <Typography.Text type="secondary" ellipsis style={{ fontSize: 12 }}>
                        {item.username}
                    </Typography.Text>
                </Flex>
            ),
        },
        {
            title: "调用组",
            dataIndex: "group",
            width: 110,
            render: (_, item) => <Tag color="blue">{groupOptions.find((option) => option.value === (item.group || "default"))?.label || item.group || "默认分组"}</Tag>,
        },
        {
            title: "状态",
            dataIndex: "active",
            width: 90,
            render: (_, item) => (item.expired ? <Tag color="red">已过期</Tag> : item.active ? <Tag color="green">启用</Tag> : <Tag color="default">禁用</Tag>),
        },
        {
            title: "到期时间",
            dataIndex: "expiresAt",
            width: 170,
            render: (_, item) => <Typography.Text type="secondary">{item.expiresAt ? dayjs(item.expiresAt).format("YYYY-MM-DD HH:mm") : "永久"}</Typography.Text>,
        },
        {
            title: "最近使用",
            dataIndex: "lastUsedAt",
            width: 160,
            render: (_, item) => <Typography.Text type="secondary">{item.lastUsedAt ? dayjs(item.lastUsedAt).format("YYYY-MM-DD HH:mm") : "-"}</Typography.Text>,
        },
        {
            title: "操作",
            key: "actions",
            width: 130,
            render: (_, item) => (
                <Space size={2}>
                    <Tooltip title="编辑">
                        <Button type="text" size="small" icon={<EditOutlined />} onClick={() => setEditing(item)} />
                    </Tooltip>
                    <Tooltip title={item.active ? "禁用" : "启用"}>
                        <Popconfirm title={item.active ? "确认禁用该密钥？禁用后使用该 Key 的调用将失败。" : "确认启用该密钥？"} onConfirm={() => void setActive(item.id, !item.active)} okText="确定" cancelText="取消">
                            <Button type="text" size="small" danger={item.active} icon={item.active ? <StopOutlined /> : <CheckCircleOutlined />} />
                        </Popconfirm>
                    </Tooltip>
                    <Tooltip title="删除">
                        <Button danger type="text" size="small" icon={<DeleteOutlined />} onClick={() => setDeleting(item)} />
                    </Tooltip>
                </Space>
            ),
        },
    ];

    return (
        <main style={{ padding: 24 }}>
            <Flex vertical gap={16}>
                <Card variant="borderless">
                    <Form layout="vertical">
                        <Row gutter={[16, 12]} align="bottom">
                            <Col flex="300px">
                                <Form.Item label="关键词" style={{ marginBottom: 0 }}>
                                    <Input.Search
                                        value={keywordText}
                                        placeholder="搜索密钥名称、前缀或用户名"
                                        allowClear
                                        enterButton={<SearchOutlined />}
                                        onSearch={() => search(keywordText)}
                                        onChange={(event) => setKeywordText(event.target.value)}
                                    />
                                </Form.Item>
                            </Col>
                            <Col flex="160px">
                                <Form.Item label="调用组" style={{ marginBottom: 0 }}>
                                    <Select allowClear placeholder="全部调用组" value={filters.group || undefined} onChange={(value) => setFilter({ group: value || "" })} options={groupOptions} />
                                </Form.Item>
                            </Col>
                            <Col flex="140px">
                                <Form.Item label="状态" style={{ marginBottom: 0 }}>
                                    <Select allowClear placeholder="全部状态" value={filters.status || undefined} onChange={(value) => setFilter({ status: value || "" })} options={statusFilterOptions} />
                                </Form.Item>
                            </Col>
                            <Col flex="none">
                                <Space>
                                    <Button
                                        onClick={() => {
                                            setKeywordText("");
                                            resetFilters();
                                        }}
                                    >
                                        重置
                                    </Button>
                                    <Button type="primary" icon={<ReloadOutlined />} onClick={() => search(keywordText)}>
                                        查询
                                    </Button>
                                </Space>
                            </Col>
                        </Row>
                    </Form>
                </Card>
                <ProTable<AdminAPIKey>
                    rowKey="id"
                    columns={columns}
                    dataSource={items}
                    loading={isLoading}
                    search={false}
                    defaultSize="middle"
                    tableLayout="fixed"
                    cardProps={{ variant: "borderless" }}
                    headerTitle={
                        <Space>
                            <Typography.Text strong>API Key 列表</Typography.Text>
                            <Tag>{total} 个</Tag>
                        </Space>
                    }
                    options={{ density: true, setting: true, reload: () => void refresh() }}
                    pagination={{
                        current: page,
                        pageSize,
                        total,
                        showSizeChanger: true,
                        pageSizeOptions: [10, 20, 50, 100],
                        showTotal: (value) => `共 ${value} 个`,
                        onChange: (nextPage, nextPageSize) => (nextPageSize !== pageSize ? changePageSize(nextPageSize) : changePage(nextPage)),
                    }}
                />
            </Flex>

            <Modal title="编辑 API Key" open={Boolean(editing)} width={620} onCancel={() => setEditing(null)} onOk={() => void save()} okText="保存" cancelText="取消" destroyOnHidden>
                <Form form={form} layout="vertical" requiredMark={false}>
                    <Row gutter={14}>
                        <Col span={12}>
                            <Form.Item name="name" label="密钥名称" rules={[{ required: true, message: "请输入名称" }]}>
                                <Input maxLength={191} />
                            </Form.Item>
                        </Col>
                        <Col span={12}>
                            <Form.Item name="group" label="调用组" rules={[{ required: true, message: "请选择调用组" }]}>
                                <Select options={groupOptions} />
                            </Form.Item>
                        </Col>
                        <Col span={16}>
                            <Form.Item name="expiresAt" label="到期时间" extra="ISO 时间，如 2026-12-31T23:59:59+08:00；留空表示永久有效">
                                <Input placeholder="留空为永久有效" />
                            </Form.Item>
                        </Col>
                        <Col span={8}>
                            <Form.Item name="active" label="启用" valuePropName="checked">
                                <Switch />
                            </Form.Item>
                        </Col>
                    </Row>
                </Form>
            </Modal>

            <Modal
                title="删除 API Key"
                open={Boolean(deleting)}
                onCancel={() => setDeleting(null)}
                onOk={async () => {
                    if (!deleting) return;
                    await deleteKey(deleting.id);
                    setDeleting(null);
                }}
                okText="删除"
                okButtonProps={{ danger: true }}
                cancelText="取消"
            >
                确定删除「{deleting?.name || deleting?.prefix}」吗？删除后使用该密钥的调用将立即失败，且不可恢复。
            </Modal>
        </main>
    );
}
