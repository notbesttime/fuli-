// 模型厂商图标映射。返回 SVG 组件或 null（无图标时回退文字标签）。
import type { ReactNode } from "react";

const iconStyle = { width: 14, height: 14, display: "inline-block", verticalAlign: "-2px", marginRight: 4 } as const;

const vendorIcons: Record<string, ReactNode> = {
    "Qwen": (
        <svg viewBox="0 0 24 24" style={iconStyle} aria-hidden>
            <circle cx="12" cy="12" r="10" fill="#7B61FF" />
            <text x="12" y="16" textAnchor="middle" fontSize="11" fill="#fff" fontWeight="bold">Q</text>
        </svg>
    ),
    "MiniMax": (
        <svg viewBox="0 0 24 24" style={iconStyle} aria-hidden>
            <circle cx="12" cy="12" r="10" fill="#FF6B35" />
            <text x="12" y="16" textAnchor="middle" fontSize="11" fill="#fff" fontWeight="bold">M</text>
        </svg>
    ),
    "硅基流动": (
        <svg viewBox="0 0 24 24" style={iconStyle} aria-hidden>
            <circle cx="12" cy="12" r="10" fill="#2D7DD2" />
            <text x="12" y="16" textAnchor="middle" fontSize="11" fill="#fff" fontWeight="bold">S</text>
        </svg>
    ),
    "AWA": (
        <svg viewBox="0 0 24 24" style={iconStyle} aria-hidden>
            <circle cx="12" cy="12" r="10" fill="#10B981" />
            <text x="12" y="16" textAnchor="middle" fontSize="11" fill="#fff" fontWeight="bold">A</text>
        </svg>
    ),
};

export function VendorIcon({ vendor }: { vendor: string }) {
    const key = Object.keys(vendorIcons).find((k) => vendor.toLowerCase().includes(k.toLowerCase()));
    if (!key) return null;
    return vendorIcons[key];
}
