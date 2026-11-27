// 图像尺寸规则：比例（如 16:9）与分辨率档（1K/2K/4K）分开选择，像素尺寸由两者推导。
type AspectIcon = "square" | "landscape" | "portrait" | "auto";

export type ImageAspectRatio = {
    value: string;
    label: string;
    width: number;
    height: number;
    icon: AspectIcon;
};

export const imageAspectRatios: ImageAspectRatio[] = [
    { value: "1:1", label: "1:1", width: 1, height: 1, icon: "square" },
    { value: "3:2", label: "3:2", width: 3, height: 2, icon: "landscape" },
    { value: "2:3", label: "2:3", width: 2, height: 3, icon: "portrait" },
    { value: "4:3", label: "4:3", width: 4, height: 3, icon: "landscape" },
    { value: "3:4", label: "3:4", width: 3, height: 4, icon: "portrait" },
    { value: "16:9", label: "16:9", width: 16, height: 9, icon: "landscape" },
    { value: "9:16", label: "9:16", width: 9, height: 16, icon: "portrait" },
    { value: "21:9", label: "21:9", width: 21, height: 9, icon: "landscape" },
];

export type ImageResolutionTier = {
    value: string;
    label: string;
    longSide: number;
    tier: 1 | 2 | 4;
};

export const imageResolutionTiers: ImageResolutionTier[] = [
    { value: "1k", label: "1K", longSide: 1024, tier: 1 },
    { value: "2k", label: "2K", longSide: 2048, tier: 2 },
    { value: "4k", label: "4K", longSide: 3840, tier: 4 },
];

function alignToStep(value: number, step = 16) {
    return Math.max(step, Math.round(value / step) * step);
}

// 长边对齐到档位像素，短边按比例换算并补齐到 16 的倍数。
export function sizeForRatioAndTier(ratio: string, tier: string) {
    const preset = imageResolutionTiers.find((item) => item.value === tier);
    const parts = ratio.split(":");
    const rw = Number(parts[0]);
    const rh = Number(parts[1]);
    if (!preset || !rw || !rh) return "";
    if (rw === rh) return `${preset.longSide}x${preset.longSide}`;
    if (rw > rh) return `${preset.longSide}x${alignToStep((preset.longSide * rh) / rw)}`;
    return `${alignToStep((preset.longSide * rw) / rh)}x${preset.longSide}`;
}

export function ratioForSize(size: string) {
    const match = /^(\d+)x(\d+)$/.exec((size || "").trim());
    if (!match) return "1:1";
    let a = Number(match[1]);
    let b = Number(match[2]);
    const gcd = (x: number, y: number): number => (y ? gcd(y, x % y) : x);
    const d = gcd(a, b) || 1;
    a /= d;
    b /= d;
    const exact = imageAspectRatios.find((item) => item.width === a && item.height === b);
    if (exact) return exact.value;
    // 非标准比例取最接近的一个
    const target = a / b;
    return imageAspectRatios.reduce((best, item) => (Math.abs(item.width / item.height - target) < Math.abs(best.width / best.height - target) ? item : best), imageAspectRatios[0]).value;
}

// 4K 档的面积上限：实测 3840×2160（8.29M）可用，方形 3840×3840（14.7M）420 秒超时，取 8.5M 作为安全上限。
export const MAX_4K_PIXELS = 8500000;

export function isSizeWithinPixelLimit(size: string) {
    const match = /^(\d+)x(\d+)$/.exec((size || "").trim());
    if (!match) return true;
    return Number(match[1]) * Number(match[2]) <= MAX_4K_PIXELS;
}

export function tierForSize(size: string) {
    const match = /^(\d+)x(\d+)$/.exec((size || "").trim());
    if (!match) return "1k";
    const long = Math.max(Number(match[1]), Number(match[2]));
    if (long >= 3000) return "4k";
    if (long >= 1600) return "2k";
    return "1k";
}

// 模型支持的档位上限：带 -4k 的模型支持 4K；硅基 Qwen-Image 系列约 200 万像素上限，只能用 1K；其余到 2K。
export function maxSizeTierForModel(model: string) {
    const value = (model || "").trim().toLowerCase();
    if (!value) return 2;
    if (value.includes("-4k")) return 4;
    if (value.includes("qwen-image")) return 1;
    return 2;
}

export function isSizeSupportedByModel(model: string, size: string) {
    const tier = imageResolutionTiers.find((item) => item.value === tierForSize(size))?.tier || 1;
    if (tier > maxSizeTierForModel(model)) return false;
    return tier < 4 || isSizeWithinPixelLimit(size);
}

export function imageSizeLimitLabel(model: string) {
    const tier = maxSizeTierForModel(model);
    if (tier >= 4) return "支持 4K";
    if (tier === 1) return "仅基础尺寸";
    return "最高 2K";
}

export function imageSizeLabel(size: string) {
    const value = (size || "").trim();
    const match = /^(\d+)x(\d+)$/.exec(value);
    if (!match) return value || "auto";
    return `${ratioForSize(value)} · ${tierForSize(value).toUpperCase()} (${value})`;
}

// 兼容旧调用：给出当前模型的可用尺寸列表。
export function imageSizeOptionsForModel(model: string) {
    const maxTier = Math.max(1, maxSizeTierForModel(model));
    return imageAspectRatios.flatMap((ratio) =>
        imageResolutionTiers
            .filter((tier) => tier.tier <= maxTier)
            .map((tier) => ({ value: sizeForRatioAndTier(ratio.value, tier.value), label: `${ratio.label} · ${tier.label}` }))
            .filter((item) => isSizeWithinPixelLimit(item.value)),
    );
}

export const imageSizeOptions = imageSizeOptionsForModel("-4k");
