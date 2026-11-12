import { BarChart3, FileText, ImagePlus, Images, LayoutGrid, Maximize2, Music2, Video, Wallet } from "lucide-react";

const allNavigationTools = [
    {
        slug: "canvas",
        label: "我的画布",
        icon: Maximize2,
    },
    {
        slug: "dashboard",
        label: "控制台",
        icon: BarChart3,
    },
    {
        slug: "credits",
        label: "算力",
        icon: Wallet,
    },
    {
        slug: "image",
        label: "生图工作台",
        icon: ImagePlus,
    },
    {
        slug: "video",
        label: "视频创作台",
        icon: Video,
    },
    {
        slug: "music",
        label: "音乐创作台",
        icon: Music2,
    },
    {
        slug: "market",
        label: "模型广场",
        icon: LayoutGrid,
    },
    {
        slug: "prompts",
        label: "提示词库",
        icon: FileText,
    },
    {
        slug: "assets",
        label: "我的素材",
        icon: Images,
    },
] as const;

// 暂时隐藏视频和音乐导航入口，后续接入自有服务后恢复。
export const navigationTools = allNavigationTools.filter((tool) => tool.slug !== "video" && tool.slug !== "music");

// 控制台和算力固定在导航栏右侧，与账户操作相邻。
export const accountNavigationTools = navigationTools.filter((tool) => tool.slug === "dashboard" || tool.slug === "credits");

// 导航栏左侧只展示创作类入口，避免与右侧的分组重复。
export const primaryNavigationTools = navigationTools.filter((tool) => !accountNavigationTools.some((item) => item.slug === tool.slug));

export type NavigationToolSlug = (typeof allNavigationTools)[number]["slug"];
