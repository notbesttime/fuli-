"use client";

import { useState } from "react";
import { Button, DatePicker, Empty, Form, Input, Modal, Select, Switch, Tag, Typography } from "antd";
import dayjs, { type Dayjs } from "dayjs";
import { Pencil, Pin, Plus, Trash2 } from "lucide-react";

import type { AdminAnnouncement } from "@/services/api/admin";

type AnnouncementFields = Omit<AdminAnnouncement, "id" | "publishDate"> & { publishDate?: Dayjs | null };
type AnnouncementsEditorProps = { value: AdminAnnouncement[]; onChange: (items: AdminAnnouncement[]) => void };
const typeOptions = [{ value: "info", label: "通知" }, { value: "success", label: "更新" }, { value: "warning", label: "提醒" }];
const typeLabels: Record<AdminAnnouncement["type"], string> = { info: "通知", success: "更新", warning: "提醒" };

export function AnnouncementsEditor({ value, onChange }: AnnouncementsEditorProps) {
    const [form] = Form.useForm<AnnouncementFields>();
    const [editing, setEditing] = useState<{ index: number | null; item: AdminAnnouncement } | null>(null);

    const openEditor = (index: number | null) => {
        const item: AdminAnnouncement = index === null ? { id: crypto.randomUUID(), title: "", content: "", type: "info", publishDate: "", enabled: false, pinned: false } : value[index];
        form.resetFields();
        form.setFieldsValue({ ...item, publishDate: item.publishDate ? dayjs(item.publishDate) : null });
        setEditing({ index, item });
    };
    const updateItem = (index: number, patch: Partial<AdminAnnouncement>) => onChange(value.map((item, position) => position === index ? { ...item, ...patch } : item));
    const applyDraft = (fields: AnnouncementFields) => {
        if (!editing) return;
        const item: AdminAnnouncement = { ...editing.item, ...fields, title: fields.title.trim(), content: fields.content.trim(), publishDate: fields.publishDate?.toISOString() || "" };
        onChange(editing.index === null ? [...value, item] : value.map((current, index) => index === editing.index ? item : current));
        setEditing(null);
    };

    return (
        <div className="space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
                <Typography.Text type="secondary">公告会显示在站点横幅与用户概览。更改后请保存页面设置生效，最多 100 条。</Typography.Text>
                <Button icon={<Plus size={14} />} disabled={value.length >= 100} onClick={() => openEditor(null)}>新增公告</Button>
            </div>
            {value.length === 0 ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无公告，点击“新增公告”开始编写" /> : (
                <div className="space-y-3">
                    {value.map((item, index) => (
                        <article key={item.id} className="rounded-lg border border-[var(--ant-color-border-secondary)] p-4">
                            <div className="flex flex-wrap items-start justify-between gap-3">
                                <div className="min-w-0 flex-1">
                                    <div className="flex flex-wrap items-center gap-2">
                                        <span className="break-all font-medium">{item.title || "未填写标题"}</span>
                                        <Tag color={item.type}>{typeLabels[item.type]}</Tag>
                                        {!item.enabled && <Tag>草稿</Tag>}
                                        {item.enabled && item.publishDate && dayjs(item.publishDate).isAfter(dayjs()) && <Tag color="processing">待发布</Tag>}
                                        {item.pinned && <span className="flex items-center gap-1 text-xs text-[var(--ant-color-text-secondary)]"><Pin size={12} aria-hidden="true" />置顶</span>}
                                    </div>
                                    <p className="mt-2 line-clamp-2 whitespace-pre-wrap break-all text-sm text-[var(--ant-color-text-secondary)]">{item.content || "未填写内容"}</p>
                                    <p className="mt-2 text-xs text-[var(--ant-color-text-tertiary)]">{item.publishDate ? "发布时间：" + dayjs(item.publishDate).format("YYYY-MM-DD HH:mm:ss") : "发布时间：立即发布"}</p>
                                </div>
                                <div className="flex shrink-0 gap-2">
                                    <Button size="small" icon={<Pencil size={13} />} onClick={() => openEditor(index)}>编辑</Button>
                                    <Button size="small" danger icon={<Trash2 size={13} />} onClick={() => onChange(value.filter((_, position) => position !== index))}>删除</Button>
                                </div>
                            </div>
                            <div className="mt-4 flex flex-wrap gap-x-6 gap-y-3">
                                <label className="flex items-center gap-2 text-sm"><Switch size="small" checked={item.enabled} onChange={(enabled) => updateItem(index, { enabled })} aria-label={"启用公告：" + (item.title || "未填写标题")} />启用</label>
                                <label className="flex items-center gap-2 text-sm"><Switch size="small" checked={item.pinned} onChange={(pinned) => updateItem(index, { pinned })} aria-label={"置顶公告：" + (item.title || "未填写标题")} />置顶</label>
                            </div>
                        </article>
                    ))}
                </div>
            )}
            <Modal title={editing?.index === null ? "新增公告" : "编辑公告"} open={Boolean(editing)} onCancel={() => setEditing(null)} onOk={() => form.submit()} okText="应用到设置" cancelText="取消" width={640} forceRender>
                <Form form={form} layout="vertical" onFinish={applyDraft}>
                    <Form.Item name="title" label="公告标题" rules={[{ required: true, whitespace: true, message: "请输入公告标题" }, { validator: (_, text: string) => Array.from(text || "").length <= 200 ? Promise.resolve() : Promise.reject(new Error("公告标题不能超过 200 字")) }]}><Input placeholder="请输入公告标题" /></Form.Item>
                    <Form.Item name="content" label="公告内容" extra="使用纯文本展示，支持换行。" rules={[{ required: true, whitespace: true, message: "请输入公告内容" }, { validator: (_, text: string) => Array.from(text || "").length <= 20000 ? Promise.resolve() : Promise.reject(new Error("公告内容不能超过 20000 字")) }]}><Input.TextArea rows={7} placeholder="请输入公告正文" /></Form.Item>
                    <div className="grid gap-x-4 sm:grid-cols-2">
                        <Form.Item name="type" label="公告类型" rules={[{ required: true, message: "请选择公告类型" }]}><Select options={typeOptions} /></Form.Item>
                        <Form.Item name="publishDate" label="发布时间（可选）" extra="留空立即发布；按浏览器本地时间选择，保存时转换为 UTC。"><DatePicker showTime format="YYYY-MM-DD HH:mm:ss" placeholder="立即发布" allowClear style={{ width: "100%" }} /></Form.Item>
                    </div>
                    <div className="flex gap-8">
                        <Form.Item name="enabled" label="启用公告" valuePropName="checked"><Switch /></Form.Item>
                        <Form.Item name="pinned" label="置顶公告" valuePropName="checked"><Switch /></Form.Item>
                    </div>
                    <Typography.Text type="secondary">仅已启用且到达发布时间的公告对用户可见；未启用的公告作为草稿保留。</Typography.Text>
                </Form>
            </Modal>
        </div>
    );
}
