"use client";

import { CopyOutlined, DownloadOutlined, PlusOutlined } from "@ant-design/icons";
import { ProTable, type ProColumns } from "@ant-design/pro-components";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, App, Button, Card, Col, DatePicker, Form, Input, InputNumber, Modal, Row, Select, Space, Tag, theme, Typography } from "antd";
import dayjs, { type Dayjs } from "dayjs";
import { saveAs } from "file-saver";
import { useCallback, useEffect, useState } from "react";

import { useCopyText } from "@/hooks/use-copy-text";
import { createAdminRedeemCodes, fetchAdminRedeemCodes, voidAdminRedeemCode, type CreateRedeemCodesPayload, type RedeemCode } from "@/services/api/redeem";
import { useUserStore } from "@/stores/use-user-store";

type GenerateFormValues = { amount: number; count: number; expiresAt?: Dayjs | null; remark?: string };
const statusLabels = { unused: "未使用", used: "已使用", void: "已作废", expired: "已过期" };
const statusColors = { unused: "blue", used: "green", void: "default", expired: "orange" };
const formatDate = (value?: string | null) => value ? dayjs(value).format("YYYY-MM-DD HH:mm:ss") : "-";
const formatAmount = (value: number) => new Intl.NumberFormat("zh-CN", { style: "currency", currency: "CNY", maximumFractionDigits: 6 }).format(value);

export default function AdminRedeemPage() {
    const { token: antToken } = theme.useToken();
    const { message } = App.useApp();
    const copyText = useCopyText();
    const token = useUserStore((state) => state.token);
    const clearSession = useUserStore((state) => state.clearSession);
    const queryClient = useQueryClient();
    const [keywordText, setKeywordText] = useState("");
    const [keyword, setKeyword] = useState("");
    const [status, setStatus] = useState<RedeemCode["status"] | undefined>();
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(20);
    const [creating, setCreating] = useState(false);
    const [voiding, setVoiding] = useState<RedeemCode | null>(null);
    const [generated, setGenerated] = useState<RedeemCode[]>([]);
    const [showGenerated, setShowGenerated] = useState(false);
    const [form] = Form.useForm<GenerateFormValues>();
    const generatedText = generated.map((item) => item.code).join("\n");
    const generatedBatch = generated[0]?.batch || "";
    const handleError = useCallback((error: Error) => {
        if (error.message.includes("登录")) clearSession();
        message.error(error.message || "操作失败");
    }, [clearSession, message]);
    const codesQuery = useQuery({
        queryKey: ["admin-redeem-codes", token, keyword, status, page, pageSize],
        queryFn: () => fetchAdminRedeemCodes(token, { keyword, type: status, page, pageSize }),
        enabled: !!token,
        retry: false,
    });
    useEffect(() => {
        if (codesQuery.error) handleError(codesQuery.error);
    }, [codesQuery.error, handleError]);
    const refreshCodes = () => queryClient.invalidateQueries({ queryKey: ["admin-redeem-codes"] });
    const generateMutation = useMutation({
        mutationFn: (payload: CreateRedeemCodesPayload) => createAdminRedeemCodes(token, payload),
        onSuccess: (data) => {
            setGenerated(data.items);
            setShowGenerated(true);
            setCreating(false);
            refreshCodes();
            message.success(`已生成 ${data.items.length} 张兑换码`);
        },
        onError: handleError,
    });
    const voidMutation = useMutation({
        mutationFn: (id: string) => voidAdminRedeemCode(token, id),
        onSuccess: () => {
            setVoiding(null);
            refreshCodes();
            message.success("兑换码已作废");
        },
        onError: handleError,
    });
    const generateCodes = async () => {
        const value = await form.validateFields();
        generateMutation.mutate({
            amount: value.amount,
            count: value.count,
            ...(value.expiresAt ? { expiresAt: value.expiresAt.toISOString() } : {}),
            remark: value.remark?.trim() || "",
        });
    };
    const exportGenerated = () => {
        saveAs(new Blob([generatedText + "\n"], { type: "text/plain;charset=utf-8" }), `redeem-${generatedBatch}.txt`);
        message.success(`已导出本批全部 ${generated.length} 张兑换码`);
    };
    const columns: ProColumns<RedeemCode>[] = [
        { title: "兑换码", dataIndex: "code", width: 260, render: (_, item) => <Space><Typography.Text code ellipsis={{ tooltip: item.code }} style={{ maxWidth: 205 }}>{item.code}</Typography.Text><Button type="text" size="small" icon={<CopyOutlined />} aria-label="复制兑换码" onClick={() => copyText(item.code, "兑换码已复制")} /></Space> },
        { title: "面额 / 算力点", dataIndex: "amount", width: 150, render: (_, item) => <Space orientation="vertical" size={0}><Typography.Text>{formatAmount(item.amount)}</Typography.Text><Typography.Text type="secondary">{item.credits} 算力点</Typography.Text></Space> },
        { title: "状态", dataIndex: "status", width: 100, render: (_, item) => <Tag color={statusColors[item.status]}>{statusLabels[item.status]}</Tag> },
        { title: "批次", dataIndex: "batch", width: 230, render: (_, item) => <Typography.Text copyable ellipsis={{ tooltip: item.batch }} style={{ maxWidth: 210 }}>{item.batch}</Typography.Text> },
        { title: "使用用户", dataIndex: "usedBy", width: 200, render: (_, item) => item.usedBy ? <Space orientation="vertical" size={0}><Typography.Text>{item.userDisplayName || "-"}</Typography.Text><Typography.Text type="secondary" copyable ellipsis={{ tooltip: item.usedBy }} style={{ maxWidth: 180 }}>{item.usedBy}</Typography.Text></Space> : "-" },
        { title: "使用时间", dataIndex: "usedAt", width: 180, render: (_, item) => formatDate(item.usedAt) },
        { title: "到期时间", dataIndex: "expiresAt", width: 180, render: (_, item) => item.expiresAt ? formatDate(item.expiresAt) : "永不过期" },
        { title: "创建时间", dataIndex: "createdAt", width: 180, render: (_, item) => formatDate(item.createdAt) },
        { title: "备注", dataIndex: "remark", width: 180, ellipsis: true, render: (_, item) => item.remark || "-" },
        { title: "操作", key: "actions", width: 88, fixed: "right", render: (_, item) => item.status === "unused" ? <Button danger type="text" size="small" onClick={() => setVoiding(item)}>作废</Button> : "-" },
    ];

    return (
        <main style={{ padding: 24 }}>
            <Space orientation="vertical" size={16} style={{ width: "100%" }}>
                <Alert type="info" showIcon title="兑换码按生成时的兑换比例锁定算力点；后续修改比例不会影响已生成的兑换码。未设置到期时间的兑换码永不过期。" />
                <Card variant="borderless">
                    <Form layout="vertical" onFinish={() => { setKeyword(keywordText.trim()); setPage(1); }}>
                        <Row gutter={16} align="bottom">
                            <Col flex="360px"><Form.Item label="搜索"><Input placeholder="搜索兑换码、批次、用户或备注" value={keywordText} onChange={(event) => setKeywordText(event.target.value)} allowClear /></Form.Item></Col>
                            <Col flex="180px"><Form.Item label="状态"><Select<RedeemCode["status"]> placeholder="全部状态" allowClear value={status} options={Object.entries(statusLabels).map(([value, label]) => ({ value, label }))} onChange={(value) => { setStatus(value); setPage(1); }} /></Form.Item></Col>
                            <Col><Form.Item><Space><Button type="primary" htmlType="submit" loading={codesQuery.isFetching}>搜索</Button><Button onClick={() => { setKeywordText(""); setKeyword(""); setStatus(undefined); setPage(1); }}>重置</Button></Space></Form.Item></Col>
                        </Row>
                    </Form>
                </Card>
                <Card variant="borderless" styles={{ body: { padding: 0 } }}>
                    <ProTable<RedeemCode>
                        rowKey="id"
                        search={false}
                        options={{ reload: () => refreshCodes() }}
                        headerTitle="兑换码管理"
                        toolBarRender={() => [
                            generated.length > 0 ? <Button key="batch" onClick={() => setShowGenerated(true)}>查看本次生成（{generated.length} 张）</Button> : null,
                            <Button key="generate" type="primary" icon={<PlusOutlined />} onClick={() => { form.resetFields(); setCreating(true); }}>批量生成</Button>,
                        ]}
                        columns={columns}
                        dataSource={codesQuery.data?.items || []}
                        loading={codesQuery.isFetching}
                        scroll={{ x: 1900 }}
                        pagination={{ current: page, pageSize, total: codesQuery.data?.total || 0, showSizeChanger: true, showTotal: (total) => `共 ${total} 张`, onChange: (nextPage, nextSize) => { setPage(nextSize === pageSize ? nextPage : 1); setPageSize(nextSize); } }}
                        tableStyle={{ background: antToken.colorBgContainer }}
                        locale={{ emptyText: codesQuery.isError ? "加载失败，请点击刷新重试" : "暂无兑换码" }}
                    />
                </Card>
            </Space>
            <Modal title="批量生成兑换码" open={creating} onCancel={() => setCreating(false)} onOk={generateCodes} okText="生成" cancelText="取消" confirmLoading={generateMutation.isPending} closable={!generateMutation.isPending} maskClosable={!generateMutation.isPending} cancelButtonProps={{ disabled: generateMutation.isPending }}>
                <Form form={form} layout="vertical" initialValues={{ amount: 0.1, count: 1 }} disabled={generateMutation.isPending}>
                    <Form.Item label="每张面额（人民币元）" required extra="支持自定义面额，最多两位小数。">
                        <Space orientation="vertical" size={8} style={{ width: "100%" }}>
                            <Form.Item name="amount" noStyle rules={[{ required: true, message: "请输入面额" }, { type: "number", min: 0.01, max: 1000000, message: "面额须为 0.01–1000000 元" }]}><InputNumber prefix="￥" min={0.01} max={1000000} precision={2} step={0.1} style={{ width: "100%" }} placeholder="可输入自定义面额" /></Form.Item>
                            <Space wrap size={4}>{[0.1, 1, 5, 10, 20, 30].map((amount) => <Button key={amount} size="small" onClick={() => form.setFieldValue("amount", amount)}>{amount} 元</Button>)}</Space>
                        </Space>
                    </Form.Item>
                    <Form.Item name="count" label="生成数量" rules={[{ required: true, message: "请输入数量" }, { type: "integer", min: 1, max: 500, message: "数量须为 1–500 的整数" }]}><InputNumber min={1} max={500} precision={0} style={{ width: "100%" }} /></Form.Item>
                    <Form.Item name="expiresAt" label="到期时间（可选）" extra="留空永不过期。按浏览器本地时间选择，提交时转换为 ISO 时间。" rules={[{ validator: (_, value?: Dayjs) => !value || (value.isValid() && value.isAfter(dayjs())) ? Promise.resolve() : Promise.reject(new Error("请选择未来的到期时间")) }]}><DatePicker showTime format="YYYY-MM-DD HH:mm:ss" placeholder="永不过期" style={{ width: "100%" }} allowClear /></Form.Item>
                    <Form.Item name="remark" label="备注（可选）"><Input.TextArea rows={2} maxLength={1000} showCount placeholder="例如：商店发货批次" /></Form.Item>
                    <Typography.Text type="secondary">生成后展示每张实际算力点。请及时复制或导出本批完整兑换码；下一批生成会替换本页保存的生成结果。</Typography.Text>
                </Form>
            </Modal>
            <Modal title="本次生成结果" open={showGenerated} onCancel={() => setShowGenerated(false)} width={680} footer={<Space><Button onClick={() => setShowGenerated(false)}>关闭</Button><Button icon={<CopyOutlined />} disabled={!generated.length} onClick={() => copyText(generatedText, `已复制本批全部 ${generated.length} 张兑换码`)}>复制本批全部</Button><Button type="primary" icon={<DownloadOutlined />} disabled={!generated.length} onClick={exportGenerated}>导出本批纯文本</Button></Space>}>
                <Space orientation="vertical" size={12} style={{ width: "100%" }}>
                    <Alert type="success" showIcon title={`生成成功，共 ${generated.length} 张`} description="以下为本次生成接口返回的完整批次，不是列表当前页。纯文本每行一个兑换码，可直接用于商店发货，请妥善保管。" />
                    <Typography.Text>批次：<Typography.Text copyable>{generatedBatch}</Typography.Text></Typography.Text>
                    {generated[0] && <Typography.Text>每张 {formatAmount(generated[0].amount)} / {generated[0].credits} 算力点；到期时间：{generated[0].expiresAt ? formatDate(generated[0].expiresAt) : "永不过期"}</Typography.Text>}
                    <Input.TextArea aria-label="本批完整兑换码" readOnly value={generatedText} rows={12} style={{ fontFamily: "monospace" }} />
                    <Typography.Text type="secondary">请及时保存。关闭弹窗后可从“查看本次生成”重新打开；刷新或离开页面会清除本次生成结果。</Typography.Text>
                </Space>
            </Modal>
            <Modal title="确认作废兑换码" open={!!voiding} onCancel={() => setVoiding(null)} onOk={() => voiding && voidMutation.mutate(voiding.id)} okText="确认作废" cancelText="取消" okButtonProps={{ danger: true }} confirmLoading={voidMutation.isPending} closable={!voidMutation.isPending} maskClosable={!voidMutation.isPending} cancelButtonProps={{ disabled: voidMutation.isPending }}>
                <Typography.Paragraph>作废后无法兑换且不可恢复，仅未使用的兑换码可以作废。</Typography.Paragraph>
                <Typography.Text code>{voiding?.code}</Typography.Text>
            </Modal>
        </main>
    );
}
