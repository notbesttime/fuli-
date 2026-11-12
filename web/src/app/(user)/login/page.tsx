"use client";

import { LockOutlined, MailOutlined, UserOutlined } from "@ant-design/icons";
import { App, Button, Form, Input, Segmented, Space } from "antd";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";

import { fetchCurrentUser, requestEmailCode, resetPassword } from "@/services/api/auth";
import { useConfigStore } from "@/stores/use-config-store";
import { useUserStore } from "@/stores/use-user-store";

type LoginFormValues = {
    username: string;
    password: string;
    confirmPassword?: string;
    email?: string;
    code?: string;
};

type AuthMode = "login" | "register" | "recover";

// 仅放行站内相对路径，拦截开放重定向。浏览器会忽略 URL 中的 Tab/换行/回车，并把
// //host 或 /\host 解析为协议相对的跨站地址，因此先剥离控制字符，再拒绝 // 与 /\ 前缀。
function safeRedirect(value: string | null): string {
    const cleaned = (value ?? "").replace(/[\t\n\r]/g, "");
    if (!cleaned.startsWith("/") || cleaned.startsWith("//") || cleaned.startsWith("/\\")) {
        return "/";
    }
    return cleaned;
}

export default function LoginPage() {
    return (
        <Suspense fallback={null}>
            <LoginContent />
        </Suspense>
    );
}

function LoginContent() {
    const { message } = App.useApp();
    const router = useRouter();
    const searchParams = useSearchParams();
    const login = useUserStore((state) => state.login);
    const register = useUserStore((state) => state.register);
    const setSession = useUserStore((state) => state.setSession);
    const isLoading = useUserStore((state) => state.isLoading);
    const linuxDoEnabled = useConfigStore((state) => state.publicSettings?.auth?.linuxDo?.enabled === true);
    const allowRegister = useConfigStore((state) => state.publicSettings?.auth?.allowRegister !== false);
    const emailVerification = useConfigStore((state) => state.publicSettings?.auth?.emailVerification === true);
    const [mode, setMode] = useState<AuthMode>("login");
    const [cooldown, setCooldown] = useState(0);
    const [form] = Form.useForm<LoginFormValues>();
    const redirect = safeRedirect(searchParams.get("redirect"));

    useEffect(() => {
        const token = searchParams.get("token");
        const error = searchParams.get("error");
        if (error) message.error(error);
        if (!token) return;
        void fetchCurrentUser(token).then((user) => {
            setSession(token, user);
            message.success("登录成功");
            router.replace(redirect);
            router.refresh();
        });
    }, [message, redirect, router, searchParams, setSession]);

    useEffect(() => {
        if (!allowRegister && mode === "register") setMode("login");
    }, [allowRegister, mode]);

    useEffect(() => {
        if (cooldown <= 0) return;
        const timer = setInterval(() => setCooldown((value) => value - 1), 1000);
        return () => clearInterval(timer);
    }, [cooldown]);

    useEffect(() => {
        form.setFieldValue("code", undefined);
        setCooldown(0);
    }, [mode, form]);

    const requestCode = async () => {
        const email = (form.getFieldValue("email") ?? "").trim();
        if (!email) {
            message.error("请先填写邮箱");
            return;
        }
        try {
            await requestEmailCode({
                email,
                purpose: mode === "recover" ? "recover" : "register",
            });
            setCooldown(60);
            message.success("验证码已发送，请查收（含垃圾箱）");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "验证码发送失败");
        }
    };

    const submit = async (values: LoginFormValues) => {
        try {
            if (mode === "recover") {
                await resetPassword({
                    email: (values.email ?? "").trim(),
                    code: values.code ?? "",
                    newPassword: values.password,
                });
                message.success("密码已重置，请使用新密码登录");
                setMode("login");
                form.setFieldsValue({ password: undefined, code: undefined });
                return;
            }
            if (mode === "register" && !allowRegister) {
                message.error("当前未开放注册");
                return;
            }
            if (mode === "register" && values.password !== values.confirmPassword) {
                message.error("两次输入的密码不一致");
                return;
            }
            const action = mode === "register" ? register : login;
            const user = await action({
                username: values.username,
                password: values.password,
                ...(mode === "register" && emailVerification
                    ? { email: (values.email ?? "").trim(), code: values.code ?? "" }
                    : {}),
            });
            message.success(mode === "register" ? "注册成功" : "登录成功");
            router.replace(redirect);
            router.refresh();
            if (user.role !== "admin") router.replace("/");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "登录失败");
        }
    };

    const needEmail = mode === "recover" || (mode === "register" && emailVerification);
    const fieldLabel = (text: string) => <span className="font-medium text-stone-800 dark:text-stone-200">{text}</span>;

    return (
        <main className="flex h-full min-h-0 items-center justify-center overflow-y-auto bg-background bg-[radial-gradient(#e5e7eb_1px,transparent_1px)] px-6 py-10 [background-size:16px_16px] dark:bg-[radial-gradient(rgba(245,245,244,.16)_1px,transparent_1px)]">
            <section className="w-full max-w-[420px]">
                <div className="mb-7 text-center">
                    <span
                        className="mx-auto mb-4 block size-12 bg-stone-950 dark:bg-stone-100"
                        style={{
                            mask: "url(/logo.svg) center / contain no-repeat",
                            WebkitMask: "url(/logo.svg) center / contain no-repeat",
                        }}
                        aria-label="福鲤绘"
                    />
                    <h1 className="text-3xl font-semibold tracking-normal text-stone-950 dark:text-stone-100">
                        {mode === "recover" ? "找回密码" : "账号登录"}
                    </h1>
                    <p className="mt-3 text-base leading-7 text-stone-500 dark:text-stone-400">
                        {mode === "recover" ? "通过绑定邮箱的验证码重置密码。" : "支持账号密码和 Linux.do 登录。"}
                    </p>
                </div>

                <Form<LoginFormValues> form={form} layout="vertical" size="large" requiredMark={false} onFinish={submit} initialValues={{}}>
                    <Form.Item>
                        <Segmented
                            block
                            value={mode === "recover" ? "login" : mode}
                            onChange={(value) => setMode(value as AuthMode)}
                            options={allowRegister ? [{ label: "登录", value: "login" }, { label: "注册", value: "register" }] : [{ label: "登录", value: "login" }]}
                        />
                    </Form.Item>
                    {mode !== "recover" ? (
                        <Form.Item name="username" label={fieldLabel("用户名或邮箱")} rules={[{ required: true, message: "请输入用户名或邮箱" }]}>
                            <Input prefix={<UserOutlined />} autoComplete="username" placeholder="请输入用户名或邮箱" />
                        </Form.Item>
                    ) : null}
                    {needEmail ? (
                        <>
                            <Form.Item name="email" label={fieldLabel("邮箱")} rules={[{ required: true, message: "请输入邮箱" }, { type: "email", message: "邮箱格式不正确" }]}>
                                <Input prefix={<MailOutlined />} autoComplete="email" />
                            </Form.Item>
                            <Form.Item label={fieldLabel("验证码")} required>
                                <Space.Compact style={{ width: "100%" }}>
                                    <Form.Item name="code" noStyle rules={[{ required: true, message: "请输入验证码" }]}>
                                        <Input maxLength={6} inputMode="numeric" autoComplete="one-time-code" />
                                    </Form.Item>
                                    <Button onClick={requestCode} disabled={cooldown > 0}>
                                        {cooldown > 0 ? `${cooldown}s 后重发` : "获取验证码"}
                                    </Button>
                                </Space.Compact>
                            </Form.Item>
                        </>
                    ) : null}
                    <Form.Item name="password" label={fieldLabel(mode === "recover" ? "新密码" : "密码")} rules={[{ required: true, message: "请输入密码" }]}>
                        <Input.Password prefix={<LockOutlined />} autoComplete={mode === "login" ? "current-password" : "new-password"} />
                    </Form.Item>
                    {mode === "register" ? (
                        <Form.Item name="confirmPassword" label={fieldLabel("确认密码")} rules={[{ required: true, message: "请再次输入密码" }]}>
                            <Input.Password prefix={<LockOutlined />} autoComplete="new-password" />
                        </Form.Item>
                    ) : null}
                    <Space orientation="vertical" size={12} style={{ width: "100%" }}>
                        <Button block type="primary" htmlType="submit" loading={isLoading}>
                            {mode === "register" ? "注册" : mode === "recover" ? "重置密码" : "登录"}
                        </Button>
                        {mode !== "recover" ? (
                            <Button block type="text" onClick={() => setMode("recover")}>
                                忘记密码？通过绑定邮箱找回
                            </Button>
                        ) : null}
                        {linuxDoEnabled ? (
                            <Button block href={`/api/auth/linux-do/authorize?redirect=${encodeURIComponent(redirect)}`} icon={<img src="/icons/linuxdo.svg" alt="" width={18} height={18} />}>
                                使用 Linux.do 登录
                            </Button>
                        ) : null}
                    </Space>
                </Form>
            </section>
        </main>
    );
}
