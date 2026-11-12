"use client";

/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com

Adapted from new-api-hcnsec@52683df93460569c6aead266aa5d96c3f44d3912
web/src/features/dashboard/components/overview/announcements-panel.tsx
and announcement-detail-dialog.tsx.
Changes: public settings store, Ant Design, pinned titles and plain-text details.
*/

import { useMemo, useState } from "react";
import { Empty, Modal, Skeleton, Tag, theme } from "antd";
import dayjs from "dayjs";
import { Megaphone, Pin } from "lucide-react";

import type { AdminAnnouncement } from "@/services/api/admin";
import { useConfigStore } from "@/stores/use-config-store";

const typeLabels: Record<AdminAnnouncement["type"], string> = { info: "通知", success: "更新", warning: "提醒" };

export function AnnouncementsPanel() {
    const publicSettings = useConfigStore((state) => state.publicSettings);
    const loading = useConfigStore((state) => state.isPublicSettingsLoading);
    const { token } = theme.useToken();
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const announcements = useMemo(() => [...(publicSettings?.announcements || [])].sort((a, b) => Number(b.pinned) - Number(a.pinned) || dayjs(b.publishDate || 0).valueOf() - dayjs(a.publishDate || 0).valueOf()), [publicSettings?.announcements]);
    const selected = announcements.find((item) => item.id === selectedId);
    const typeColors = { info: token.colorInfo, success: token.colorSuccess, warning: token.colorWarning };

    return (
        <section className="min-w-0 overflow-hidden rounded-2xl border bg-card" aria-label="系统公告" aria-busy={loading}>
            <header className="border-b p-5">
                <h2 className="flex items-center gap-2 text-sm font-semibold">
                    <span className="flex size-7 items-center justify-center rounded-lg" style={{ color: token.colorWarning, background: token.colorWarningBg }}><Megaphone size={16} aria-hidden="true" /></span>
                    系统公告
                    {announcements.length > 0 && <span className="ml-auto text-xs font-normal text-muted-foreground">{announcements.length} 条</span>}
                </h2>
                <p className="mt-2 text-xs text-muted-foreground">平台最新动态与服务通知</p>
            </header>
            {loading && !publicSettings ? (
                <div className="p-5" role="status" aria-label="正在加载公告"><Skeleton active paragraph={{ rows: 4 }} /></div>
            ) : announcements.length === 0 ? (
                <div className="flex min-h-48 items-center justify-center p-5"><Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无系统公告" /></div>
            ) : (
                <div className="max-h-80 overflow-y-auto overscroll-contain">
                    {announcements.map((item) => (
                        <button key={item.id} type="button" onClick={() => setSelectedId(item.id)} className="group w-full cursor-pointer border-b px-4 py-3 text-left transition-colors last:border-b-0 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:px-5 sm:py-3.5">
                            <div className="flex items-start gap-2.5">
                                <span className="mt-1.5 size-2 shrink-0 rounded-full" style={{ background: typeColors[item.type] }} aria-hidden="true" />
                                <div className="min-w-0 flex-1 space-y-1.5">
                                    <div className="flex items-center gap-1.5">
                                        {item.pinned && <Pin size={12} className="shrink-0 text-muted-foreground" aria-label="置顶公告" />}
                                        <p className="line-clamp-1 break-all text-sm font-medium">{item.title}</p>
                                    </div>
                                    <p className="line-clamp-2 break-all text-xs leading-5 text-muted-foreground">{item.content}</p>
                                    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                                        <Tag color={item.type} className="m-0!">{typeLabels[item.type]}</Tag>
                                        {item.publishDate && <time dateTime={item.publishDate}>{dayjs(item.publishDate).format("YYYY-MM-DD HH:mm")}</time>}
                                        <span className="ml-auto opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">查看详情</span>
                                    </div>
                                </div>
                            </div>
                        </button>
                    ))}
                </div>
            )}
            <Modal title={selected?.title || "公告详情"} open={Boolean(selected)} onCancel={() => setSelectedId(null)} footer={null} width={600} destroyOnHidden>
                {selected && <div className="space-y-4">
                    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        <Tag color={selected.type}>{typeLabels[selected.type]}</Tag>
                        {selected.pinned && <span className="flex items-center gap-1"><Pin size={12} aria-hidden="true" />置顶</span>}
                        {selected.publishDate && <time dateTime={selected.publishDate}>{dayjs(selected.publishDate).format("YYYY-MM-DD HH:mm")}</time>}
                    </div>
                    <div className="max-h-[60vh] overflow-y-auto whitespace-pre-wrap break-words text-sm leading-7">{selected.content}</div>
                </div>}
            </Modal>
        </section>
    );
}
