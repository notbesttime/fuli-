// 思考强度：不同厂商参数不同，按模型能力注入对应字段。
export type ReasoningLevel = "off" | "low" | "medium" | "high";

export const reasoningLevelOptions: Array<{ value: ReasoningLevel; label: string }> = [
    { value: "off", label: "关闭" },
    { value: "low", label: "低" },
    { value: "medium", label: "中" },
    { value: "high", label: "高" },
];

// graded=可分档（enable_thinking + thinking_budget），toggle=仅开关（thinking.type），fixed=模型固定开启，none=不支持。
export function reasoningSupportForModel(model: string): "graded" | "toggle" | "fixed" | "none" {
    const value = (model || "").trim().toLowerCase();
    if (!value) return "none";
    if (/deepseek-r1|qwen3-vl.*thinking|qwen3-omni.*thinking/.test(value)) return "fixed";
    if (/qwen3\.5|qwen3-|qwen3\//.test(value)) return "graded";
    if (/deepseek-v3\.2|glm-4\.5|zai-org\/glm/.test(value)) return "toggle";
    return "none";
}

const THINKING_BUDGET: Record<string, number> = { low: 512, medium: 2048, high: 8192 };

// 把思考强度翻译成上游参数；返回是否实际注入了参数。
export function applyReasoningParams(body: Record<string, unknown>, model: string, level: ReasoningLevel): boolean {
    const support = reasoningSupportForModel(model);
    if (support === "none" || support === "fixed" || level === undefined) return false;
    const value = (model || "").trim().toLowerCase();
    if (support === "graded") {
        body.enable_thinking = level !== "off";
        if (level !== "off") body.thinking_budget = THINKING_BUDGET[level] || THINKING_BUDGET.medium;
        return true;
    }
    body.thinking = { type: level === "off" ? "disabled" : "enabled" };
    return true;
}

export function reasoningLevelLabel(level: ReasoningLevel) {
    return reasoningLevelOptions.find((item) => item.value === level)?.label || "关闭";
}
