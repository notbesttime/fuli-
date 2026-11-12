"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Carousel, type GetRef, Modal, Tag, theme } from "antd";
import dayjs from "dayjs";
import { Megaphone, Pin, X } from "lucide-react";

import { useConfigStore } from "@/stores/use-config-store";

const DISMISSED_KEY = "infinite-canvas:announcement-dismissed";
const typeLabels = { info: "通知", success: "更新", warning: "提醒" };

export function AnnouncementBanner() {
    const publicSettings = useConfigStore((state) => state.publicSettings);
    const announcements = useMemo(() => [...(publicSettings?.announcements || [])].sort((a, b) => Number(b.pinned) - Number(a.pinned) || dayjs(b.publishDate || 0).valueOf() - dayjs(a.publishDate || 0).valueOf()), [publicSettings?.announcements]);
    const { token } = theme.useToken();
    const [visible, setVisible] = useState(false);
    const [signature, setSignature] = useState("");
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [slide, setSlide] = useState({ index: 0, direction: "right" });
    const [paused, setPaused] = useState(false);
    const carouselRef = useRef<GetRef<typeof Carousel>>(null);
    const selected = announcements.find((item) => item.id === selectedId);
    const typeColors = { info: token.colorInfo, success: token.colorSuccess, warning: token.colorWarning };

    useEffect(() => {
        let active = true;
        setVisible(false);
        setSignature("");
        setSelectedId(null);
        setSlide({ index: 0, direction: "right" });
        if (!announcements.length) return;
        void (async () => {
            let nextSignature = "";
            let shouldShow = true;
            try {
                const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(announcements)));
                nextSignature = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
                shouldShow = localStorage.getItem(DISMISSED_KEY) !== nextSignature;
            } catch {
                // 存储或 Web Crypto 不可用时，仍可展示并在本次页面关闭公告。
            }
            if (active) {
                setSignature(nextSignature);
                setVisible(shouldShow);
            }
        })();
        return () => { active = false; };
    }, [announcements]);

    if (!visible || !announcements.length) return null;

    return (
        <section
            aria-label="站点公告"
            className="relative min-h-12 w-full shrink-0 text-foreground"
            style={{ background: token.colorInfoBg }}
            onMouseEnter={() => setPaused(true)}
            onMouseLeave={() => setPaused(false)}
            onFocus={() => setPaused(true)}
            onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setPaused(false); }}
        >
            <Carousel
                ref={carouselRef}
                autoplay={announcements.length > 1 && !paused && !selected}
                autoplaySpeed={5000}
                effect="fade"
                speed={0}
                beforeChange={(_, next) => setSlide((current) => current.index === next ? current : { index: next, direction: "right" })}
                adaptiveHeight
                dots={false}
                rootClassName="isolate"
            >
                {announcements.map((item) => (
                    <div key={item.id}>
                        <button type="button" onClick={() => setSelectedId(item.id)} className={"flex min-h-12 w-full cursor-pointer items-center justify-center gap-2 px-12 py-2 text-center text-sm duration-300 in-[.slick-active]:animate-in in-[.slick-active]:fade-in sm:text-base " + (slide.direction === "left" ? "in-[.slick-active]:slide-in-from-left-2" : "in-[.slick-active]:slide-in-from-right-2")}>
                            <Megaphone className="size-4 shrink-0" style={{ color: typeColors[item.type] }} aria-hidden="true" />
                            {item.pinned && <Pin className="size-3 shrink-0" aria-label="置顶公告" />}
                            <span className="min-w-0 truncate font-medium leading-[1.6]">{item.title}<span className="ml-2 font-normal text-muted-foreground">{item.content}</span></span>
                            <span className="hidden shrink-0 text-xs text-muted-foreground sm:inline">查看详情</span>
                        </button>
                    </div>
                ))}
            </Carousel>
            {announcements.length > 1 && (
                <div aria-label="选择公告" className="group/indicators absolute bottom-px left-1/2 flex max-w-40 -translate-x-1/2 overflow-x-auto">
                    {announcements.map((item, index) => (
                        <button
                            key={item.id}
                            type="button"
                            aria-label={"显示第 " + (index + 1) + " 条公告"}
                            aria-current={slide.index === index ? true : undefined}
                            className={"group/item flex h-2.5 shrink cursor-pointer items-end justify-center rounded-sm px-1 pb-0.5 transition-[width] duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring " + (slide.index === index ? "w-9" : "w-5")}
                            onClick={() => {
                                if (index === slide.index) return;
                                setSlide({ index, direction: index < slide.index ? "left" : "right" });
                                carouselRef.current?.goTo(index);
                            }}
                        >
                            <span className={"h-0.5 w-full rounded-full transition-[height,background-color] duration-150 group-hover/indicators:h-1.5 " + (slide.index === index ? "bg-foreground" : "bg-foreground/20 group-hover/item:bg-foreground/50")} />
                        </button>
                    ))}
                </div>
            )}
            <button
                type="button"
                aria-label="关闭公告"
                className="absolute right-2 top-1/2 -translate-y-1/2 cursor-pointer rounded-md p-1.5 hover:bg-foreground/10 sm:right-4"
                onClick={() => {
                    setVisible(false);
                    try { if (signature) localStorage.setItem(DISMISSED_KEY, signature); } catch {}
                }}
            >
                <X className="size-4" aria-hidden="true" />
            </button>
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
