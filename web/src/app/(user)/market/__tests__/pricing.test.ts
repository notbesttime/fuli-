import assert from "node:assert/strict";
import test from "node:test";
import { requestCreditCost, requestUnitPrice } from "../../../../constant/credits";
import { buildMarketModels, formatMarketPrice } from "../../../../constant/model-market";
import type { AdminPricingSetting, AdminPublicModelChannelInfo } from "../../../../services/api/admin";

const pricing: AdminPricingSetting = {
    currency: "CNY",
    creditRate: 0.01,
    groups: [
        { id: "default", name: "标准线路", ratio: 1, desc: "标准渠道" },
        { id: "budget", name: "轻量线路", ratio: 0.5, desc: "能力以轻量渠道为准" },
        { id: "premium", name: "高阶线路", ratio: 2 },
    ],
};

const channel: AdminPublicModelChannelInfo = { id: "standard", protocol: "openai", name: "标准图像渠道", baseUrl: "", models: ["image-model"], weight: 1, timeout: 60, enabled: true, remark: "支持图像编辑" };

test("canvas credit estimates retain sub-cent group pricing", () => {
    assert.equal(requestUnitPrice({ channelMode: "remote", modelCosts: [{ model: "image-model", price: 0.01, credits: 0 }], model: "image-model", ratio: 0.1 }), 0.001);
    assert.equal(requestCreditCost({ channelMode: "remote", modelCosts: [{ model: "image-model", credits: 0.01 }], model: "image-model", ratio: 0.1 }), 0.001);
});

test("low image prices and group multiplication retain four-decimal billing precision", () => {
    const [model] = buildMarketModels([{ model: "image-model", billingMode: "image", price: 0.005, credits: 999 }], pricing, [], [channel, { ...channel, id: "budget", groups: ["budget"] }]);
    assert.equal(model.basePrice, 0.005);
    assert.equal(model.prices[0].price, 0.005);
    assert.equal(model.prices[1].price, 0.0025);
    assert.equal(formatMarketPrice(model.prices[0].price!), "0.005");
    assert.equal(formatMarketPrice(model.prices[1].price!), "0.0025");
    assert.equal(formatMarketPrice(1.2), "1.2");
});

test("resolution and credit-only rates apply the chosen group multiplier", () => {
    const [model] = buildMarketModels(
        [
            { model: "video-model", price: 0.0123, credits: 0, billingMode: "second" },
            { model: "video-model", resolution: "1080p", price: 0.1234, credits: 0, billingMode: "second" },
            { model: "video-model", resolution: "720p", credits: 1.25, billingMode: "second" },
        ],
        pricing,
        [],
        [{ ...channel, models: ["video-model"], groups: ["budget"] }],
    );
    assert.equal(model.prices[1].price, 0.0062);
    assert.equal(model.prices[1].resolutions[0].price, 0.0617);
    assert.equal(model.prices[1].resolutions[1].basePrice, 0.0125);
    assert.equal(model.prices[1].resolutions[1].price, 0.0063);
});

test("only enabled matching channels in a group expose usable prices and names", () => {
    const [model] = buildMarketModels(
        [{ model: "image-model", price: 0.1, credits: 0 }],
        pricing,
        ["image-model"],
        [
            channel,
            { ...channel, id: "budget", name: "轻量图像渠道", groups: ["budget"], remark: "仅支持文生图" },
            { ...channel, id: "disabled", enabled: false, groups: ["premium"] },
            { ...channel, id: "other", models: ["other-model"], groups: ["premium"] },
        ],
    );
    assert.deepEqual(
        model.prices.map((group) => group.id),
        ["default", "budget", "premium"],
    );
    assert.equal(model.prices[0].available, true);
    assert.deepEqual(model.prices[1].channels, [{ id: "budget", name: "轻量图像渠道", remark: "仅支持文生图" }]);
    assert.equal(model.prices[1].desc, "能力以轻量渠道为准");
    assert.equal(model.prices[2].available, false);
    assert.equal(model.prices[2].price, null);
    assert.deepEqual(model.prices[2].channels, []);
});

test("a listed model with no public route has no purchasable group price", () => {
    const [model] = buildMarketModels([{ model: "image-model", resolution: "2k", price: 0.02, credits: 0 }], pricing, ["image-model"], []);
    assert.ok(model.prices.every((group) => !group.available && group.price === null && group.resolutions[0].price === null));
});

test("public workflow summaries bind only the exact workflow and channel group", () => {
    const workflowChannel: AdminPublicModelChannelInfo = {
        ...channel,
        id: "workflow-channel",
        protocol: "comfyui",
        models: [],
        groups: ["premium"],
        enabled: true,
        workflows: [{ provider: "comfyui", kind: "workflow", workflowId: "wf-1", title: "图像工作流", capability: "image", enabled: true }],
    };
    const models = buildMarketModels(
        [],
        pricing,
        ["workflow:system:workflow-channel:workflow:wf-1", "workflow:system:workflow-channel:workflow:missing", "workflow:system:disabled:workflow:wf-1"],
        [workflowChannel, { ...workflowChannel, id: "disabled", enabled: false }],
    );
    assert.equal(models.find((model) => model.model === "workflow:system:workflow-channel:workflow:wf-1")?.prices[2].available, true);
    assert.equal(models.find((model) => model.model === "workflow:system:workflow-channel:workflow:wf-1")?.prices[0].available, false);
    assert.ok(models.find((model) => model.model.endsWith(":missing"))?.prices.every((group) => !group.available));
    assert.ok(models.find((model) => model.model.includes(":disabled:"))?.prices.every((group) => !group.available));
});

