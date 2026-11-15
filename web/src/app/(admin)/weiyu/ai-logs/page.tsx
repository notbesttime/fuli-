"use client";

import { DeleteOutlined, DownloadOutlined, EyeOutlined, ReloadOutlined, SearchOutlined } from "@ant-design/icons";
import { App, Button, Card, DatePicker, Flex, Input, InputNumber, Modal, Select, Space, Switch, Table, Tabs, Tag, Typography } from "antd";
import dayjs from "dayjs";
import { useMemo, useState } from "react";

import type { AdminAICallLog } from "@/services/api/admin";

import { AILogUsageOverview } from "./components/usage-overview";
import { useAdminAILogs } from "./use-admin-ai-logs";

export default function AdminAICallLogsPage() {
    const { modal } = App.useApp();
    const logs = useAdminAILogs();
    const [tab, setTab] = useState("usage");
    const [clearDays, setClearDays] = useState(7);
    const [detail, setDetail] = useState<{ title: string; value: string } | null>(null);

    const modelOptions = useMemo(() => (logs.stats?.models || []).map((item) => ({ label: item, value: item })), [logs.stats?.models]);
    const channelOptions = useMemo(() => (logs.stats?.channels || []).map((item) => ({ label: item, value: item })), [logs.stats?.channels]);

    const columns = useMemo(
        () => [
            { title: "时间", dataIndex: "createdAt", width: 170, render: (value: string) => formatTime(value) },
            { title: "用户", dataIndex: "userDisplayName", width: 150, render: (_: string, item: AdminAICallLog) => item.userDisplayName || item.userId || "-" },
            { title: "接口", dataIndex: "endpoint", width: 170, ellipsis: true },
            { title: "模型", dataIndex: "model", width: 180, ellipsis: true },
            { title: "渠道", dataIndex: "channelName", width: 150, ellipsis: true, render: (_: string, item: AdminAICallLog) => item.channelName || item.channelId || "-" },
            { title: "状态", dataIndex: "status", width: 90, render: (status: number, item: AdminAICallLog) => <Tag color={!item.failed && status >= 200 && status < 400 ? "success" : "error"}>{status || "失败"}</Tag> },
            { title: "耗时", dataIndex: "durationMs", width: 110, render: (value: number) => formatDuration(value) },
            { title: "扣点", dataIndex: "credits", width: 80 },
            {
                title: "错误",
                dataIndex: "error",
                width: 200,
                ellipsis: true,
                render: (value: string) => (value ? <Typography.Text type="danger" ellipsis={{ tooltip: value }}>{value}</Typography.Text> : "-"),
            },
            {
                title: "操作",
                key: "actions",
                width: 180,
                fixed: "right" as const,
                render: (_: unknown, item: AdminAICallLog) => (
                    <Space size={6}>
                        <Button size="small" icon={<EyeOutlined />} onClick={() => setDetail({ title: "请求详情", value: item.requestBody })}>
                            请求详情
                        </Button>
                        <Button size="small" icon={<EyeOutlined />} onClick={() => setDetail({ title: "返回详情", value: item.responseBody || item.error })}>
                            返回详情
                        </Button>
                    </Space>
                ),
            },
        ],
        [],
    );

    const confirmClear = () => {
        modal.confirm({
            title: "清理旧调用日志",
            content: `将删除 ${clearDays} 天前的日志文件，且不可恢复，确认继续？`,
            okButtonProps: { danger: true },
            okText: "确认清理",
            cancelText: "取消",
            onOk: async () => {
                await logs.clearOldLogs(clearDays).catch(() => undefined);
            },
        });
    };

    return (
        <main className="p-3 md:p-6">
            <Flex vertical gap={16} className="w-full">
                <Card variant="borderless">
                    <div className="flex flex-wrap items-center gap-3">
                        <Input
                            className="min-w-[220px] flex-1 lg:max-w-[320px]"
                            value={logs.filters.keyword}
                            placeholder="搜索用户、模型、渠道、接口或错误"
                            prefix={<SearchOutlined />}
                            allowClear
                            onChange={(event) => logs.setFilter({ keyword: event.target.value })}
                            onPressEnter={() => logs.search()}
                        />
                        <Select
                            className="!w-[200px]"
                            value={logs.filters.model || undefined}
                            placeholder="全部模型"
                            allowClear
                            showSearch
                            options={modelOptions}
                            onChange={(value) => logs.setFilter({ model: value || "" })}
                        />
                        <Select
                            className="!w-[180px]"
                            value={logs.filters.channel || undefined}
                            placeholder="全部渠道"
                            allowClear
                            showSearch
                            options={channelOptions}
                            onChange={(value) => logs.setFilter({ channel: value || "" })}
                        />
                        <Select
                            className="!w-[130px]"
                            value={logs.filters.result || undefined}
                            placeholder="全部结果"
                            allowClear
                            options={[{ label: "仅成功", value: "success" }, { label: "仅失败", value: "failed" }]}
                            onChange={(value) => logs.setFilter({ result: value || "" })}
                        />
                        <DatePicker.RangePicker
                            value={logs.range.startDate && logs.range.endDate ? [dayjs(logs.range.startDate), dayjs(logs.range.endDate)] : null}
                            placeholder={["开始日期", "结束日期"]}
                            onChange={(values) => logs.setDateRange({ startDate: values?.[0]?.format("YYYY-MM-DD") || "", endDate: values?.[1]?.format("YYYY-MM-DD") || "" })}
                        />
                        <Button icon={<ReloadOutlined />} onClick={logs.resetFilters}>
                            重置
                        </Button>
                        <Button type="primary" icon={<DownloadOutlined />} loading={logs.exporting} onClick={() => void logs.exportCsv().catch(() => undefined)}>
                            导出 CSV
                        </Button>
                    </div>
                </Card>
                <Card variant="borderless">
                    <Tabs
                        activeKey={tab}
                        onChange={setTab}
                        items={[
                            { key: "usage", label: "用量统计", children: <AILogUsageOverview stats={logs.stats} loading={logs.statsLoading} /> },
                            {
                                key: "detail",
                                label: `调用明细${logs.total ? ` (${logs.total})` : ""}`,
                                children: (
                                    <Flex vertical gap={12}>
                                        <div className="flex flex-wrap items-center gap-3">
                                            <div className="flex h-8 items-center gap-2 rounded-md border border-stone-200 px-3 dark:border-stone-800">
                                                <Typography.Text className="whitespace-nowrap text-sm">本地直连日志</Typography.Text>
                                                <Switch
                                                    size="small"
                                                    checked={logs.localDirectReportEnabled}
                                                    loading={logs.savingLocalDirectReport}
                                                    onChange={(checked) => void logs.setLocalDirectReport(checked).catch(() => undefined)}
                                                />
                                            </div>
                                            <div className="flex h-8 items-center gap-2">
                                                <Typography.Text className="whitespace-nowrap text-sm">清理超过</Typography.Text>
                                                <InputNumber min={1} value={clearDays} className="!w-24" onChange={(value) => setClearDays(Number(value) || 7)} />
                                                <Typography.Text type="secondary" className="shrink-0">天前</Typography.Text>
                                            </div>
                                            <Button danger icon={<DeleteOutlined />} loading={logs.clearing} onClick={confirmClear} className="ml-0 lg:ml-auto">
                                                清理旧日志
                                            </Button>
                                        </div>
                                        <Table
                                            rowKey="id"
                                            size="small"
                                            loading={logs.listLoading}
                                            columns={columns}
                                            dataSource={logs.items}
                                            scroll={{ x: 1400 }}
                                            pagination={{
                                                current: logs.page,
                                                pageSize: logs.pageSize,
                                                total: logs.total,
                                                showSizeChanger: true,
                                                showTotal: (total) => `共 ${total} 条`,
                                                onChange: (nextPage, nextPageSize) => {
                                                    if (nextPageSize !== logs.pageSize) logs.changePageSize(nextPageSize);
                                                    else logs.changePage(nextPage);
                                                },
                                            }}
                                        />
                                    </Flex>
                                ),
                            },
                        ]}
                    />
                </Card>
            </Flex>
            <Modal title={detail?.title || "AI 调用详情"} open={Boolean(detail)} width="min(1100px, 92vw)" footer={null} onCancel={() => setDetail(null)} destroyOnHidden>
                <LogBlock value={detail?.value || ""} />
            </Modal>
        </main>
    );
}

function LogBlock({ value }: { value: string }) {
    return (
        <pre className="max-h-[72vh] whitespace-pre-wrap break-words overflow-auto rounded-lg border border-stone-200 bg-stone-50 p-3 text-xs leading-5 text-stone-700 dark:border-stone-800 dark:bg-stone-950 dark:text-stone-200">
            {value || "-"}
        </pre>
    );
}

function formatTime(value: string) {
    if (!value) return "-";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function formatDuration(value: number) {
    if (!Number.isFinite(value) || value <= 0) return "-";
    return value >= 1000 ? `${(value / 1000).toFixed(2)}s` : `${value}ms`;
}