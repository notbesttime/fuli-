"use client";

import { AuditOutlined, FileTextOutlined, GiftOutlined, HomeOutlined, LogoutOutlined, PictureOutlined, SettingOutlined, ToolOutlined, TransactionOutlined, UserOutlined } from "@ant-design/icons";
import { Button, Flex, Layout, Menu, Typography, theme } from "antd";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { useEffect } from "react";

import { UserStatusActions } from "@/components/layout/user-status-actions";
import { adminLayoutStyle } from "@/lib/app-theme";
import { useUserStore } from "@/stores/use-user-store";

const adminMenus = [
    { key: "/weiyu/users", icon: <UserOutlined />, label: "用户管理" },
    { key: "/weiyu/credit-logs", icon: <TransactionOutlined />, label: "算力点日志" },
    { key: "/weiyu/redeem", icon: <GiftOutlined />, label: "兑换码管理" },
    { key: "/weiyu/ai-logs", icon: <AuditOutlined />, label: "AI 日志" },
    { key: "/weiyu/prompts", icon: <FileTextOutlined />, label: "提示词管理" },
    { key: "/weiyu/skills", icon: <ToolOutlined />, label: "Skill 管理" },
    { key: "/weiyu/assets", icon: <PictureOutlined />, label: "素材库" },
    { key: "/weiyu/settings", icon: <SettingOutlined />, label: "系统设置" },
];

export default function AdminLayout({ children }: { children: ReactNode }) {
    const { token: antToken } = theme.useToken();
    const router = useRouter();
    const pathname = usePathname();
    const token = useUserStore((state) => state.token);
    const user = useUserStore((state) => state.user);
    const isReady = useUserStore((state) => state.isReady);
    const logout = useUserStore((state) => state.clearSession);
    const activeKey = pathname.startsWith("/weiyu/settings")
        ? "/weiyu/settings"
        : pathname.startsWith("/weiyu/assets")
          ? "/weiyu/assets"
          : pathname.startsWith("/weiyu/skills")
            ? "/weiyu/skills"
            : pathname.startsWith("/weiyu/prompts")
              ? "/weiyu/prompts"
              : pathname.startsWith("/weiyu/ai-logs")
                ? "/weiyu/ai-logs"
                : pathname.startsWith("/weiyu/credit-logs")
                  ? "/weiyu/credit-logs"
                  : pathname.startsWith("/weiyu/redeem")
                    ? "/weiyu/redeem"
                    : pathname.startsWith("/weiyu/users")
                      ? "/weiyu/users"
                      : "";
    const pageTitle = pathname.startsWith("/weiyu/settings") ? "系统设置" : pathname.startsWith("/weiyu/assets") ? "素材库管理" : pathname.startsWith("/weiyu/skills") ? "Skill 管理" : pathname.startsWith("/weiyu/prompts") ? "提示词管理" : pathname.startsWith("/weiyu/ai-logs") ? "AI 日志" : pathname.startsWith("/weiyu/credit-logs") ? "算力点日志" : pathname.startsWith("/weiyu/redeem") ? "兑换码管理" : "用户管理";

    useEffect(() => {
        if (!isReady) return;
        if (!token) {
            router.replace("/login?redirect=/admin");
            return;
        }
        if (user?.role !== "admin") {
            router.replace("/");
        }
    }, [isReady, router, token, user?.role]);

    if (!isReady || !token || user?.role !== "admin") {
        return (
            <div style={{ display: "flex", minHeight: "100vh", alignItems: "center", justifyContent: "center", background: antToken.colorBgLayout }}>
                <span />
            </div>
        );
    }

    return (
        <Layout hasSider style={{ height: "100vh", overflow: "hidden", background: antToken.colorBgLayout }}>
            <Layout.Sider width={adminLayoutStyle.siderWidth} style={{ height: "100vh", overflow: "hidden", background: antToken.colorBgContainer, borderRight: `1px solid ${antToken.colorBorder}` }}>
                <Flex align="center" gap={12} style={{ height: adminLayoutStyle.brandHeight, padding: "0 20px", borderBottom: `1px solid ${antToken.colorBorderSecondary}` }}>
                    <span aria-hidden style={{ display: "inline-block", width: 30, height: 30, background: antToken.colorText, WebkitMask: "url(/logo.svg) center / contain no-repeat", mask: "url(/logo.svg) center / contain no-repeat" }} />
                    <Typography.Text strong style={{ fontSize: 18, letterSpacing: 0 }}>
                        福鲤绘
                    </Typography.Text>
                </Flex>
                <Menu
                    mode="inline"
                    selectedKeys={[activeKey]}
                    style={adminLayoutStyle.menu}
                    items={adminMenus.map((item) => ({
                        ...item,
                        label: (
                            <Link href={item.key} style={{ color: "inherit" }}>
                                {item.label}
                            </Link>
                        ),
                        style: adminLayoutStyle.menuItem,
                    }))}
                />
                <Flex vertical gap={8} style={{ position: "absolute", bottom: 0, insetInline: 0, padding: 12, borderTop: `1px solid ${antToken.colorBorder}`, background: antToken.colorBgContainer }}>
                    <Button block icon={<HomeOutlined />} href="/canvas" target="_blank" rel="noreferrer">
                        前往画布
                    </Button>
                    <Button block icon={<LogoutOutlined />} onClick={logout}>
                        退出登录
                    </Button>
                </Flex>
            </Layout.Sider>
            <Layout style={{ background: antToken.colorBgLayout }}>
                <Layout.Header
                    style={{ display: "flex", alignItems: "center", justifyContent: "space-between", height: adminLayoutStyle.headerHeight, padding: "0 24px", background: antToken.colorBgContainer, borderBottom: `1px solid ${antToken.colorBorder}` }}
                >
                    <Typography.Title level={5} style={{ margin: 0 }}>
                        {pageTitle}
                    </Typography.Title>
                    <Flex align="center" gap={4}>
                        <UserStatusActions showConfig={false} />
                    </Flex>
                </Layout.Header>
                <Layout.Content style={{ minHeight: 0, overflow: "auto" }}>{children}</Layout.Content>
            </Layout>
        </Layout>
    );
}
