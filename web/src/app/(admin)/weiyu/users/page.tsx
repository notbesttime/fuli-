"use client";

import { CheckCircleOutlined, DeleteOutlined, EditOutlined, EyeOutlined, PlusOutlined, ReloadOutlined, SearchOutlined, StopOutlined } from "@ant-design/icons";
import { ProTable, type ProColumns } from "@ant-design/pro-components";
import { Avatar, Button, Card, Col, Descriptions, Divider, Drawer, Flex, Form, Input, InputNumber, Modal, Popconfirm, Row, Select, Space, Statistic, Tag, Tooltip, Typography } from "antd";
import dayjs from "dayjs";
import { useEffect, useState } from "react";

import type { AdminUser, AdminModelGroup } from "@/services/api/admin";
import { useConfigStore } from "@/stores/use-config-store";
import { useAdminUsers } from "./use-admin-users";

const defaultUserGroups: AdminModelGroup[] = [{ id: "default", name: "默认分组", ratio: 1, desc: "" }];

type UserFormValues = Partial<AdminUser> & { password?: string };

const roleOptions = [
    { label: "普通用户", value: "user" },
    { label: "管理员", value: "admin" },
];

const statusOptions = [
    { label: "正常", value: "active" },
    { label: "禁用", value: "ban" },
];

export default function AdminUsersPage() {
    const { users, keyword, filters, page, pageSize, total, isLoading, detail, detailUserId, searchUsers, setFilter, changePage, changePageSize, resetFilters, refreshUsers, openDetail, closeDetail, setUserStatus, saveUser: saveAdminUser, adjustCredits, deleteUser } = useAdminUsers();
    const [form] = Form.useForm<UserFormValues>();
    const pricingGroups = useConfigStore((state) => state.publicSettings?.modelChannel.pricing?.groups);
    const groupOptions = (pricingGroups?.length ? pricingGroups : defaultUserGroups).map((group) => ({
        label: group.name || group.id,
        value: group.id,
    }));
    const [keywordText, setKeywordText] = useState(keyword);
    const [editingUser, setEditingUser] = useState<Partial<AdminUser> | null>(null);
    const [deletingUser, setDeletingUser] = useState<AdminUser | null>(null);

    useEffect(() => setKeywordText(keyword), [keyword]);

    useEffect(() => {
        if (editingUser) form.setFieldsValue({ role: "user", status: "active", group: "default", ...editingUser, password: "" });
    }, [editingUser, form]);

    const saveUser = async () => {
        const value = await form.validateFields();
        const userValue = { ...value };
        delete userValue.credits;
        await saveAdminUser({ ...editingUser, ...userValue, password: value.password || undefined });
        setEditingUser(null);
    };

    const saveCredits = async () => {
        if (!editingUser?.id) return;
        await adjustCredits(editingUser.id, form.getFieldValue("credits") || 0);
    };

    const columns: ProColumns<AdminUser>[] = [
        {
            title: "用户",
            dataIndex: "username",
            width: 250,
            render: (_, item) => (
                <Flex align="center" gap={10} style={{ minWidth: 0 }}>
                    <Avatar src={item.avatarUrl || undefined}>{(item.displayName || item.username || "U").slice(0, 1).toUpperCase()}</Avatar>
                    <Flex vertical style={{ minWidth: 0 }}>
                        <Typography.Text strong ellipsis>
                            {item.displayName || item.username}
                        </Typography.Text>
                        <Typography.Text type="secondary" ellipsis>
                            {item.username}
                        </Typography.Text>
                    </Flex>
                </Flex>
            ),
        },
        {
            title: "角色",
            dataIndex: "role",
            width: 90,
            render: (_, item) => <Tag color={item.role === "admin" ? "gold" : "default"}>{item.role === "admin" ? "管理员" : "用户"}</Tag>,
        },
        {
            title: "状态",
            dataIndex: "status",
            width: 80,
            render: (_, item) => <Tag color={item.status === "ban" ? "red" : "green"}>{item.status === "ban" ? "禁用" : "正常"}</Tag>,
        },
        {
            title: "账户组",
            dataIndex: "group",
            width: 120,
            render: (_, item) => <Tag color="blue">{groupOptions.find((option) => option.value === (item.group || "default"))?.label || item.group || "默认分组"}</Tag>,
        },
        {
            title: "算力点",
            dataIndex: "credits",
            width: 100,
            render: (_, item) => <Typography.Text>{item.credits}</Typography.Text>,
        },
        {
            title: "最近登录",
            dataIndex: "lastLoginAt",
            width: 170,
            render: (_, item) => <Typography.Text type="secondary">{item.lastLoginAt ? dayjs(item.lastLoginAt).format("YYYY-MM-DD HH:mm:ss") : "-"}</Typography.Text>,
        },
        {
            title: "操作",
            key: "actions",
            width: 150,
            render: (_, item) => (
                <Space size={2}>
                    <Tooltip title="详情">
                        <Button type="text" size="small" icon={<EyeOutlined />} onClick={() => openDetail(item.id)} />
                    </Tooltip>
                    <Tooltip title={item.status === "ban" ? "启用" : "禁用"}>
                        <Popconfirm
                            title={item.status === "ban" ? "确认启用该用户？" : "确认禁用该用户？禁用后该账号无法继续登录。"}
                            onConfirm={() => void setUserStatus(item.id, item.status === "ban" ? "active" : "ban")}
                            okText="确定"
                            cancelText="取消"
                        >
                            <Button type="text" size="small" danger={item.status !== "ban"} icon={item.status === "ban" ? <CheckCircleOutlined /> : <StopOutlined />} />
                        </Popconfirm>
                    </Tooltip>
                    <Tooltip title="编辑">
                        <Button type="text" size="small" icon={<EditOutlined />} onClick={() => setEditingUser(item)} />
                    </Tooltip>
                    <Tooltip title="删除">
                        <Button danger type="text" size="small" icon={<DeleteOutlined />} onClick={() => setDeletingUser(item)} />
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
                                        placeholder="搜索用户名、昵称、邮箱或 Linux.do ID"
                                        allowClear
                                        enterButton={<SearchOutlined />}
                                        onSearch={() => searchUsers(keywordText)}
                                        onChange={(event) => setKeywordText(event.target.value)}
                                    />
                                </Form.Item>
                            </Col>
                            <Col flex="150px">
                                <Form.Item label="角色" style={{ marginBottom: 0 }}>
                                    <Select allowClear placeholder="全部角色" value={filters.role || undefined} onChange={(value) => setFilter({ role: value || "" })} options={roleOptions} />
                                </Form.Item>
                            </Col>
                            <Col flex="140px">
                                <Form.Item label="状态" style={{ marginBottom: 0 }}>
                                    <Select allowClear placeholder="全部状态" value={filters.status || undefined} onChange={(value) => setFilter({ status: value || "" })} options={statusOptions} />
                                </Form.Item>
                            </Col>
                            <Col flex="160px">
                                <Form.Item label="账户组" style={{ marginBottom: 0 }}>
                                    <Select allowClear placeholder="全部账户组" value={filters.group || undefined} onChange={(value) => setFilter({ group: value || "" })} options={groupOptions} />
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
                                    <Button type="primary" icon={<ReloadOutlined />} onClick={() => searchUsers(keywordText)}>
                                        查询
                                    </Button>
                                </Space>
                            </Col>
                        </Row>
                    </Form>
                </Card>
                <ProTable<AdminUser>
                    rowKey="id"
                    columns={columns}
                    dataSource={users}
                    loading={isLoading}
                    search={false}
                    defaultSize="middle"
                    tableLayout="fixed"
                    cardProps={{ variant: "borderless" }}
                    headerTitle={
                        <Space>
                            <Typography.Text strong>用户列表</Typography.Text>
                            <Tag>{total} 人</Tag>
                        </Space>
                    }
                    options={{ density: true, setting: true, reload: () => void refreshUsers() }}
                    toolBarRender={() => [
                        <Button key="add" type="primary" icon={<PlusOutlined />} onClick={() => setEditingUser({ role: "user", status: "active" })}>
                            新增
                        </Button>,
                    ]}
                    pagination={{
                        current: page,
                        pageSize,
                        total,
                        showSizeChanger: true,
                        pageSizeOptions: [10, 20, 50, 100],
                        showTotal: (value) => `共 ${value} 人`,
                        onChange: (nextPage, nextPageSize) => (nextPageSize !== pageSize ? changePageSize(nextPageSize) : changePage(nextPage)),
                    }}
                />
            </Flex>

            <Drawer title="用户详情" open={Boolean(detailUserId)} onClose={closeDetail} size={440}>
                {detail ? (
                    <Flex vertical gap={20}>
                        <Flex align="center" gap={12}>
                            <Avatar size={48} src={detail.user.avatarUrl || undefined}>{(detail.user.displayName || detail.user.username || "U").slice(0, 1).toUpperCase()}</Avatar>
                            <Flex vertical>
                                <Typography.Text strong style={{ fontSize: 16 }}>
                                    {detail.user.displayName || detail.user.username}
                                </Typography.Text>
                                <Typography.Text type="secondary">{detail.user.username}</Typography.Text>
                            </Flex>
                        </Flex>
                        <Descriptions
                            column={1}
                            size="small"
                            bordered
                            items={[
                                { key: "role", label: "角色", children: detail.user.role === "admin" ? "管理员" : "用户" },
                                { key: "status", label: "状态", children: detail.user.status === "ban" ? "禁用" : "正常" },
                                { key: "group", label: "账户组", children: groupOptions.find((option) => option.value === (detail.user.group || "default"))?.label || detail.user.group || "默认分组" },
                                { key: "email", label: "邮箱", children: detail.user.email || "-" },
                                { key: "linuxdo", label: "Linux.do", children: detail.user.linuxDoId || "-" },
                                { key: "created", label: "注册时间", children: detail.user.createdAt ? dayjs(detail.user.createdAt).format("YYYY-MM-DD HH:mm:ss") : "-" },
                                { key: "lastLogin", label: "最近登录", children: detail.user.lastLoginAt ? dayjs(detail.user.lastLoginAt).format("YYYY-MM-DD HH:mm:ss") : "-" },
                            ]}
                        />
                        <Row gutter={[12, 12]}>
                            <Col span={12}>
                                <Card size="small">
                                    <Statistic title="算力点余额" value={detail.user.credits} precision={2} />
                                </Card>
                            </Col>
                            <Col span={12}>
                                <Card size="small">
                                    <Statistic title="累计消费" value={detail.summary.totalSpent} precision={2} />
                                </Card>
                            </Col>
                            <Col span={12}>
                                <Card size="small">
                                    <Statistic title="计费调用" value={detail.summary.billedRequests} />
                                </Card>
                            </Col>
                            <Col span={12}>
                                <Card size="small">
                                    <Statistic title="API Key" value={detail.activeApiKeyCount} suffix={`/ ${detail.apiKeyCount}`} />
                                </Card>
                            </Col>
                        </Row>
                    </Flex>
                ) : (
                    <Typography.Text type="secondary">加载中…</Typography.Text>
                )}
            </Drawer>

            <Modal title={editingUser?.id ? "编辑用户" : "新增用户"} open={Boolean(editingUser)} width={680} onCancel={() => setEditingUser(null)} onOk={() => void saveUser()} okText="保存" cancelText="取消" destroyOnHidden>
                <Form form={form} layout="vertical" requiredMark={false}>
                    <Typography.Text strong>基础信息</Typography.Text>
                    <Row gutter={14}>
                        <Col span={12}>
                            <Form.Item name="username" label="用户名" rules={[{ required: true, message: "请输入用户名" }]}>
                                <Input />
                            </Form.Item>
                        </Col>
                        <Col span={12}>
                            <Form.Item name="password" label={editingUser?.id ? "新密码" : "密码"} rules={editingUser?.id ? [] : [{ required: true, message: "请输入密码" }]}>
                                <Input.Password autoComplete="new-password" />
                            </Form.Item>
                        </Col>
                        <Col span={12}>
                            <Form.Item name="displayName" label="昵称">
                                <Input />
                            </Form.Item>
                        </Col>
                        <Col span={12}>
                            <Form.Item name="email" label="邮箱">
                                <Input />
                            </Form.Item>
                        </Col>
                        <Col span={12}>
                            <Form.Item name="role" label="角色" rules={[{ required: true, message: "请选择角色" }]}>
                                <Select options={roleOptions} />
                            </Form.Item>
                        </Col>
                        <Col span={12}>
                            <Form.Item name="status" label="状态" rules={[{ required: true, message: "请选择状态" }]}>
                                <Select options={statusOptions} />
                            </Form.Item>
                        </Col>
                        <Col span={12}>
                            <Form.Item name="group" label="账户组" extra="账户归类；用户可在模型广场自由选择调用分组，实际路由和价格按用户所选组结算。">
                                <Select options={groupOptions} />
                            </Form.Item>
                        </Col>
                    </Row>
                    {editingUser?.id ? (
                        <>
                            <Divider style={{ margin: "4px 0 16px" }} />
                            <Typography.Text strong>算力点调整</Typography.Text>
                            <Row gutter={14}>
                                <Col span={12}>
                                    <Form.Item label="算力点">
                                        <Space.Compact style={{ width: "100%" }}>
                                            <Form.Item name="credits" noStyle>
                                                <InputNumber min={0} step={0.01} precision={2} style={{ width: "100%" }} />
                                            </Form.Item>
                                            <Button onClick={() => void saveCredits()}>调整</Button>
                                        </Space.Compact>
                                    </Form.Item>
                                </Col>
                            </Row>
                        </>
                    ) : null}
                </Form>
            </Modal>

            <Modal
                title="删除用户"
                open={Boolean(deletingUser)}
                onCancel={() => setDeletingUser(null)}
                onOk={async () => {
                    if (!deletingUser) return;
                    await deleteUser(deletingUser.id);
                    setDeletingUser(null);
                }}
                okText="删除"
                okButtonProps={{ danger: true }}
                cancelText="取消"
            >
                确定删除「{deletingUser?.displayName || deletingUser?.username}」吗？删除后该账号将无法继续登录。
            </Modal>
        </main>
    );
}
