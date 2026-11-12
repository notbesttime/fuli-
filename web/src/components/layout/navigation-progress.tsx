"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";

type Listener = (active: boolean) => void;
const listeners = new Set<Listener>();
let activeState = false;

function setActive(value: boolean) {
    activeState = value;
    listeners.forEach((listener) => listener(value));
}

/** 开始一条“加载中”进度条；数据加载完成后调用 doneNavigationProgress。 */
export function startNavigationProgress() {
    setActive(true);
}

/** 把进度条补到 100% 后淡出。 */
export function doneNavigationProgress() {
    setActive(false);
}

/** 兼容旧调用：active=true 开始，false 完成。 */
export function emitNavigationProgress(active: boolean) {
    setActive(active);
}

export function NavigationProgress() {
    const pathname = usePathname();
    const [visible, setVisible] = useState(activeState);
    const [progress, setProgress] = useState(activeState ? 8 : 0);
    const trickleRef = useRef<number | null>(null);
    const hideRef = useRef<number | null>(null);
    const startAtRef = useRef(0);

    useEffect(() => {
        const clearTimers = () => {
            if (trickleRef.current) { window.clearInterval(trickleRef.current); trickleRef.current = null; }
            if (hideRef.current) { window.clearTimeout(hideRef.current); hideRef.current = null; }
        };
        const begin = () => {
            clearTimers();
            startAtRef.current = Date.now();
            setVisible(true);
            setProgress(8);
            trickleRef.current = window.setInterval(() => {
                setProgress((value) => (value >= 90 ? value : value + Math.max(0.6, (90 - value) * 0.08)));
            }, 180);
        };
        const finish = () => {
            clearTimers();
            setProgress(100);
            const elapsed = Date.now() - startAtRef.current;
            const wait = Math.max(0, 320 - elapsed);
            hideRef.current = window.setTimeout(() => { setVisible(false); setProgress(0); }, wait);
        };
        const listener: Listener = (value) => { if (value) begin(); else finish(); };
        listeners.add(listener);
        if (activeState) begin();

        const handleClick = (event: MouseEvent) => {
            if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
            const target = event.target;
            if (!(target instanceof Element)) return;
            const link = target.closest<HTMLAnchorElement>("a[href]");
            if (!link || link.target === "_blank" || link.hasAttribute("download")) return;
            const url = new URL(link.href, window.location.href);
            if (url.origin !== window.location.origin || url.pathname === window.location.pathname) return;
            startNavigationProgress();
        };
        const handlePopState = () => { startNavigationProgress(); window.setTimeout(doneNavigationProgress, 700); };

        window.addEventListener("click", handleClick, true);
        window.addEventListener("popstate", handlePopState);
        return () => {
            clearTimers();
            listeners.delete(listener);
            window.removeEventListener("click", handleClick, true);
            window.removeEventListener("popstate", handlePopState);
        };
    }, []);

    useEffect(() => {
        doneNavigationProgress();
    }, [pathname]);

    if (!visible) return null;
    return (
        <div className="fuli-navigation-progress" aria-hidden="true">
            <div className="fuli-navigation-progress__bar" style={{ width: `${progress}%` }} />
        </div>
    );
}
