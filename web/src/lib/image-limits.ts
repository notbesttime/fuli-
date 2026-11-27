// 图像尺寸档位与模型限制：供设置面板、生成请求和模型广场共用。
type AspectIcon = "square" | "landscape" | "portrait" | "auto";

export type ImageAspectPreset = {
    value: string;
    label: string;
    size?: string;
    width: number;
    height: number;
    icon: AspectIcon;
    tier: 0 | 1 | 2 | 4;
};

export const imageAspectPresets: ImageAspectPreset[] = [
    { value: "1:1", label: "1:1", width: 1024, height: 1024, icon: "square", tier: 1 },
    { value: "3:2", label: "3:2", width: 1536, height: 1024, icon: "landscape", tier: 1 },
    { value: "2:3", label: "2:3", width: 1024, height: 1536, icon: "portrait", tier: 1 },
    { value: "4:3", label: "4:3", width: 1024, height: 768, icon: "landscape", tier: 1 },
    { value: "3:4", label: "3:4", width: 768, height: 1024, icon: "portrait", tier: 1 },
    { value: "16:9", label: "16:9", width: 1920, height: 1080, icon: "landscape", tier: 1 },
    { value: "9:16", label: "9:16", width: 1080, height: 1920, icon: "portrait", tier: 1 },
    { value: "21:9", label: "21:9", width: 1568, height: 672, icon: "landscape", tier: 1 },
    { value: "1:1-2k", label: "1:1 (2K)", size: "2048x2048", width: 2048, height: 2048, icon: "square", tier: 2 },
    { value: "3:2-2k", label: "3:2 (2K)", size: "2048x1360", width: 2048, height: 1360, icon: "landscape", tier: 2 },
    { value: "2:3-2k", label: "2:3 (2K)", size: "1360x2048", width: 1360, height: 2048, icon: "portrait", tier: 2 },
    { value: "4:3-2k", label: "4:3 (2K)", size: "2048x1536", width: 2048, height: 1536, icon: "landscape", tier: 2 },
    { value: "3:4-2k", label: "3:4 (2K)", size: "1536x2048", width: 1536, height: 2048, icon: "portrait", tier: 2 },
    { value: "16:9-2k", label: "16:9 (2K)", size: "2048x1152", width: 2048, height: 1152, icon: "landscape", tier: 2 },
    { value: "9:16-2k", label: "9:16 (2K)", size: "1152x2048", width: 1152, height: 2048, icon: "portrait", tier: 2 },
    { value: "21:9-2k", label: "21:9 (2K)", size: "2048x880", width: 2048, height: 880, icon: "landscape", tier: 2 },
    { value: "1:1-4k", label: "1:1 (4K)", size: "3840x3840", width: 3840, height: 3840, icon: "square", tier: 4 },
    { value: "3:2-4k", label: "3:2 (4K)", size: "3840x2560", width: 3840, height: 2560, icon: "landscape", tier: 4 },
    { value: "2:3-4k", label: "2:3 (4K)", size: "2560x3840", width: 2560, height: 3840, icon: "portrait", tier: 4 },
    { value: "4:3-4k", label: "4:3 (4K)", size: "3840x2880", width: 3840, height: 2880, icon: "landscape", tier: 4 },
    { value: "3:4-4k", label: "3:4 (4K)", size: "2880x3840", width: 2880, height: 3840, icon: "portrait", tier: 4 },
    { value: "16:9-4k", label: "16:9 (4K)", size: "3840x2160", width: 3840, height: 2160, icon: "landscape", tier: 4 },
    { value: "9:16-4k", label: "9:16 (4K)", size: "2160x3840", width: 2160, height: 3840, icon: "portrait", tier: 4 },
    { value: "21:9-4k", label: "21:9 (4K)", size: "3840x1648", width: 3840, height: 1648, icon: "landscape", tier: 4 },
    { value: "auto", label: "auto", width: 0, height: 0, icon: "auto", tier: 0 },
];

export const imageSizeOptions = imageAspectPresets.map((item) => ({
    value: item.size || item.value,
    label: item.label,
}));

const sizeTierByValue = new Map(imageAspectPresets.map((item) => [item.size || item.value, item.tier]));

// 尺寸档位：0=auto，1=基础，2=2K，4=4K。用于按模型能力禁用不支持的档位。
export function imageSizeTier(size: string) {
    const key = size.trim();
    if (sizeTierByValue.has(key)) return sizeTierByValue.get(key) || 0;
    const match = /^(\d+)x(\d+)$/.exec(key);
    if (!match) return 1;
    const pixels = Number(match[1]) * Number(match[2]);
    if (pixels > 6000000) return 4;
    if (pixels > 2200000) return 2;
    return 1;
}

// 模型支持的尺寸档位上限：带 -4k 的模型支持 4K；硅基 Qwen-Image 系列约 200 万像素上限，只能用基础尺寸；其余按 2K 上限。
export function maxSizeTierForModel(model: string) {
    const value = (model || "").trim().toLowerCase();
    if (!value) return 2;
    if (value.includes("-4k")) return 4;
    if (value.includes("qwen-image")) return 1;
    return 2;
}

export function isSizeSupportedByModel(model: string, size: string) {
    const tier = imageSizeTier(size);
    if (tier === 0) return true;
    return tier <= maxSizeTierForModel(model);
}

export function imageSizeOptionsForModel(model: string) {
    return imageAspectPresets
        .filter((item) => item.tier <= Math.max(1, maxSizeTierForModel(model)))
        .map((item) => ({ value: item.size || item.value, label: item.label }));
}

export function imageSizeLabel(size: string) {
    return imageAspectPresets.find((item) => (item.size || item.value) === size || item.value === size)?.label || size;
}

export function imageSizeLimitLabel(model: string) {
    const tier = maxSizeTierForModel(model);
    if (tier >= 4) return "支持 4K";
    if (tier === 1) return "仅基础尺寸";
    return "最大 2K";
}
