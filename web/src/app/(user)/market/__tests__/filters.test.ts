import assert from "node:assert/strict";
import test from "node:test";
import { buildMarketListings, buildMarketModels, filterMarketListings, marketFacetEnabled, marketPlatform } from "../../../../constant/model-market";
import type { AdminPricingSetting, AdminPublicModelChannelInfo } from "../../../../services/api/admin";

const pricing: AdminPricingSetting = {
    currency: "CNY",
    creditRate: 0.01,
    groups: [
        { id: "default", name: "标准线路", ratio: 1 },
        { id: "budget", name: "轻量线路", ratio: 0.5 },
        { id: "premium", name: "高阶线路", ratio: 2 },
    ],
};

const channel: AdminPublicModelChannelInfo = {
    id: "standard",
    protocol: "openai",
    name: "标准图像渠道",
    baseUrl: "",
    models: ["image-model"],
    weight: 1,
    timeout: 60,
    enabled: true,
    remark: "",
};

test("market plaza groups model rows and sorts cards by multiplier", () => {
    const models = buildMarketModels(
        [{ model: "image-model", vendor: "OpenAI", tags: ["fast"], billingMode: "image", price: 0.02, credits: 0 }],
        pricing,
        [],
        [channel, { ...channel, id: "budget", groups: ["budget"] }],
    );
    const listings = buildMarketListings(models);
    assert.deepEqual(listings.map(({ group }) => group.id), ["budget", "default", "premium"]);
    assert.equal(listings[0].group.price, 0.01);
    assert.equal(marketPlatform(listings[0].model), "OpenAI");
});

test("market plaza facets stay compatible with other selected dimensions", () => {
    const models = buildMarketModels(
        [{ model: "image-model", vendor: "OpenAI", tags: ["fast"], billingMode: "image", price: 0.02, credits: 0 }],
        pricing,
        [],
        [channel, { ...channel, id: "budget", groups: ["budget"] }],
    );
    const listings = buildMarketListings(models);
    const filters = { platform: "OpenAI", groupId: "all", ratio: 0.5, billingMode: "image" as const, keyword: "FAST" };
    assert.deepEqual(filterMarketListings(listings, filters).map(({ group }) => group.id), ["budget"]);
    assert.equal(marketFacetEnabled(listings, filters, "groupId", "budget"), true);
    assert.equal(marketFacetEnabled(listings, filters, "groupId", "premium"), false);
    assert.equal(marketFacetEnabled(listings, filters, "platform", "Google"), false);
});

test("resolution prices inherit their model billing unit when unspecified", () => {
    const [model] = buildMarketModels(
        [
            { model: "qwen-image-edit", billingMode: "image", price: 0.05, credits: 0 },
            { model: "qwen-image-edit", resolution: "1024x1024", price: 0.07, credits: 0 },
        ],
        pricing,
        [],
        [],
    );
    assert.equal(model.resolutions[0].billingMode, "image");
});

test("unlabelled model vendors use a stable fallback platform", () => {
    const [model] = buildMarketModels([{ model: "image-model", credits: 0 }], pricing, [], []);
    assert.equal(marketPlatform(model), "未标注厂商");
});
