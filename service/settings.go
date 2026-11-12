package service

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"math/rand"
	"net/http"
	"net/url"
	"slices"
	"sort"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/tigerowo/infinite-canvas/model"
	"github.com/tigerowo/infinite-canvas/repository"
)

var adminModelHTTPClient = &http.Client{Timeout: 30 * time.Second}

func PublicSettings() (model.PublicSetting, error) {
	settings, err := repository.GetSettings()
	settings = normalizeSettings(settings)
	settings.Public.ModelChannel.Channels = publicChannelInfos(settings.Private.Channels, settings.Public.ModelChannel.AvailableModels, settings.Public.ModelChannel.AvailableWorkflows)
	if len(settings.Public.ModelChannel.AvailableModels) == 0 {
		settings.Public.ModelChannel.AvailableModels = enabledChannelModels(settings.Private.Channels)
	}
	settings.Public.Announcements = publishedAnnouncements(settings.Public.Announcements, time.Now())
	settings.Public.Auth.EmailVerification = SMTPConfigured()
	return settings.Public, err
}

func UserCanUseRemoteModelChannel(user model.AuthUser) bool {
	if user.Role == model.UserRoleAdmin {
		return true
	}
	settings, err := PublicSettings()
	return err == nil && settings.ModelChannel.AllowUserRemoteChannel != nil && *settings.ModelChannel.AllowUserRemoteChannel
}

func AdminSettings() (model.Settings, error) {
	settings, err := repository.GetSettings()
	return hidePrivateAPIKeys(normalizeSettings(settings)), err
}

func SaveSettings(settings model.Settings) (model.Settings, error) {
	saved, err := repository.GetSettings()
	if err != nil {
		return model.Settings{}, err
	}
	if err := validateAnnouncements(settings.Public.Announcements); err != nil {
		return model.Settings{}, err
	}
	if err := validatePricingGroups(settings.Public.ModelChannel.Pricing.Groups); err != nil {
		return model.Settings{}, err
	}
	if err := validateRechargeSetting(settings.Public.Recharge); err != nil {
		return model.Settings{}, err
	}
	if rate := settings.Public.ModelChannel.Pricing.CreditRate; math.IsNaN(rate) || math.IsInf(rate, 0) || rate < 0 {
		return model.Settings{}, safeMessageError{message: "算力点汇率必须为有效正数"}
	}
	settings.Private = normalizePrivateSetting(settings.Private)
	saved = normalizeSettings(saved)
	keepPrivateAPIKeys(&settings, saved)
	keepPrivateAuthSecrets(&settings, saved)
	keepPrivateStorageSecrets(&settings, saved)
	settings = normalizeSettings(settings)
	for i := range settings.Public.Announcements {
		if settings.Public.Announcements[i].ID == "" {
			settings.Public.Announcements[i].ID = newID("announcement")
		}
	}
	for _, channel := range settings.Private.Channels {
		if _, err := ParameterTranslationModels(channel.ParameterTranslation); err != nil {
			return model.Settings{}, fmt.Errorf("渠道 %s：%w", channel.Name, err)
		}
	}
	if err := validateEnabledStorageProviderTypes(settings.Private.Storage.Providers); err != nil {
		return model.Settings{}, err
	}
	result, err := repository.SaveSettings(settings, now())
	if err == nil {
		RefreshPromptSyncScheduler()
		RefreshStorageCapacityScheduler()
		RefreshAILogCleanupScheduler()
	}
	return hidePrivateAPIKeys(result), err
}

func AdminChannelModels(index *int, channel model.ModelChannel) ([]string, error) {
	resolved, err := resolveAdminChannel(index, channel)
	if err != nil {
		return nil, err
	}
	return fetchAdminChannelModels(resolved)
}

func AdminTestChannelModel(index *int, channel model.ModelChannel, modelName string) (string, error) {
	resolved, err := resolveAdminChannel(index, channel)
	if err != nil {
		return "", err
	}
	translation, err := NewParameterTranslation(resolved, modelName, map[string]any{"prompt": "test", "count": 1})
	if err != nil {
		return "", err
	}
	if translation != nil {
		kind := resolved.ModelCapabilities[modelName]
		if kind == "" {
			kind = "image"
		}
		result, err := translation.Send(context.Background(), kind, false, "")
		if err != nil {
			return "", err
		}
		if len(result.TaskIDs) > 0 {
			return "自定义请求已提交，接口返回任务 ID", nil
		}
		return "自定义请求调用成功", nil
	}
	if adapter, ok := matchModelProtocol(modelConfigTestRules, resolved, modelName); ok {
		return adapter.testModel(resolved, modelName)
	}
	return testAdminChannelModel(resolved, modelName)
}

func normalizeSettings(settings model.Settings) model.Settings {
	settings.Private = normalizePrivateSetting(settings.Private)
	settings.Public = normalizePublicSettingWithChannels(settings.Public, settings.Private.Channels)
	return settings
}

func normalizePublicSetting(setting model.PublicSetting) model.PublicSetting {
	return normalizePublicSettingWithChannels(setting, nil)
}

func DefaultSystemPrompts() model.SystemPromptSetting {
	return model.SystemPromptSetting{
		Image:    "",
		Video:    "",
		Text:     "",
		Workflow: "",
		WorkflowAgent: `你是一个用于创建图片创作工作流的产品设计助理。请根据用户需求输出严格 JSON，不要输出 Markdown。
目标：把用户的自然语言需求整理为一个可复用的图片生成工作流。
要求：
1. 工作流必须面向同类型批量创作，变量字段要少而明确。
2. 变量名使用 snake_case，label 使用中文。
3. promptTemplate 必须使用 {{variable_name}} 引用变量。
4. 如果用户需要"多张、系列、组图、文章配图、海报组、写真组、方案集"，mode 使用 multi_image_series；否则使用 single_image。
5. config 只输出必要配置，apiMode 可为 responses、images 或 chat。
6. variables 支持 text、textarea、number、select、boolean。
7. select 类型的 options 必须是字符串数组。
8. 多图工作流必须输出 seriesConfig，用于先生成多条图片提示词草稿。
9. 输出 JSON 结构：
{
  "name": "工作流名称",
  "category": "分类",
  "description": "一句话描述",
  "mode": "single_image",
  "variables": [
    {"key":"product_name","label":"产品名称","type":"text","required":true,"defaultValue":"","options":[]}
  ],
  "config": {
    "promptTemplate": "生成提示词模板",
    "systemPrompt": "系统提示词，可空",
    "model": "",
    "apiMode": "responses",
    "size": "auto",
    "quality": "auto",
    "count": "1",
    "outputFormat": "png",
    "timeout": 600
  },
  "seriesConfig": {
    "targetCount": "4",
    "promptInstruction": "多图拆分规则，可空",
    "reviewRequired": true,
    "concurrency": "3"
  },
  "warnings": []
}`,
	}
}

const defaultRechargeStoreURL = "https://wzyp.cn/shop/QKH7GGGF"
const defaultRechargeNotice = "小铺购买含平台服务费，直接联系我充值更便宜；大额充值请联系我。"

func validRechargeURL(value string) bool {
	parsed, err := url.Parse(strings.TrimSpace(value))
	return err == nil && (strings.EqualFold(parsed.Scheme, "https") || strings.EqualFold(parsed.Scheme, "http")) && parsed.Hostname() != "" && parsed.User == nil
}

func validateRechargeSetting(setting model.RechargeSetting) error {
	if value := strings.TrimSpace(setting.StoreURL); value != "" && !validRechargeURL(value) {
		return safeMessageError{message: "小铺链接须为有效的 HTTP 或 HTTPS 地址"}
	}
	if setting.LargeAmount != 0 && !validRechargeAmount(setting.LargeAmount) {
		return safeMessageError{message: "大额联系阈值须为 0.01 至 1000000 元，最多两位小数"}
	}
	if len(setting.Tiers) > 50 {
		return safeMessageError{message: "充值档位不能超过 50 个"}
	}
	for _, tier := range setting.Tiers {
		if !validRechargeAmount(tier.Amount) {
			return safeMessageError{message: "充值档位金额须为 0.01 至 1000000 元，最多两位小数"}
		}
		if value := strings.TrimSpace(tier.URL); value != "" && !validRechargeURL(value) {
			return safeMessageError{message: "档位链接须为有效的 HTTP 或 HTTPS 地址"}
		}
	}
	return nil
}

func normalizeRechargeSetting(setting model.RechargeSetting) model.RechargeSetting {
	if setting.Enabled == nil {
		enabled := true
		setting.Enabled = &enabled
	}
	setting.StoreURL = strings.TrimSpace(setting.StoreURL)
	if !validRechargeURL(setting.StoreURL) {
		setting.StoreURL = defaultRechargeStoreURL
	}
	setting.Notice = strings.TrimSpace(setting.Notice)
	if setting.Notice == "" {
		setting.Notice = defaultRechargeNotice
	}
	setting.Contact = strings.TrimSpace(setting.Contact)
	if !validRechargeAmount(setting.LargeAmount) {
		setting.LargeAmount = 100
	}
	if setting.Tiers == nil {
		setting.Tiers = []model.RechargeTier{}
		for _, amount := range []float64{0.1, 1, 5, 10, 20, 30} {
			setting.Tiers = append(setting.Tiers, model.RechargeTier{Amount: amount})
		}
	}
	for i := range setting.Tiers {
		setting.Tiers[i].URL = strings.TrimSpace(setting.Tiers[i].URL)
		if setting.Tiers[i].URL != "" && !validRechargeURL(setting.Tiers[i].URL) {
			setting.Tiers[i].URL = ""
		}
	}
	return setting
}

func normalizePublicSettingWithChannels(setting model.PublicSetting, channels []model.ModelChannel) model.PublicSetting {
	if setting.Announcements == nil {
		setting.Announcements = []model.Announcement{}
	}
	for i := range setting.Announcements {
		notice := &setting.Announcements[i]
		notice.ID = strings.TrimSpace(notice.ID)
		notice.Title = strings.TrimSpace(notice.Title)
		notice.Content = strings.TrimSpace(notice.Content)
		notice.PublishDate = strings.TrimSpace(notice.PublishDate)
	}
	setting.Recharge = normalizeRechargeSetting(setting.Recharge)
	if setting.ModelChannel.AvailableModels == nil {
		setting.ModelChannel.AvailableModels = []string{}
	}
	if setting.ModelChannel.AvailableWorkflows == nil {
		setting.ModelChannel.AvailableWorkflows = []string{}
	}
	if setting.ModelChannel.ModelCosts == nil {
		setting.ModelChannel.ModelCosts = []model.ModelCost{}
	}
	setting.ModelChannel.Pricing = normalizePricingSetting(setting.ModelChannel.Pricing)
	if setting.ModelChannel.Channels == nil {
		setting.ModelChannel.Channels = []model.PublicModelChannelInfo{}
	}
	if strings.TrimSpace(setting.ModelChannel.SystemPrompts.Image) == "" {
		setting.ModelChannel.SystemPrompts.Image = DefaultSystemPrompts().Image
	}
	if strings.TrimSpace(setting.ModelChannel.SystemPrompts.Video) == "" {
		setting.ModelChannel.SystemPrompts.Video = DefaultSystemPrompts().Video
	}
	if strings.TrimSpace(setting.ModelChannel.SystemPrompts.Text) == "" {
		setting.ModelChannel.SystemPrompts.Text = DefaultSystemPrompts().Text
	}
	if strings.TrimSpace(setting.ModelChannel.SystemPrompts.Workflow) == "" {
		setting.ModelChannel.SystemPrompts.Workflow = DefaultSystemPrompts().Workflow
	}
	if strings.TrimSpace(setting.ModelChannel.SystemPrompts.WorkflowAgent) == "" {
		setting.ModelChannel.SystemPrompts.WorkflowAgent = DefaultSystemPrompts().WorkflowAgent
	}
	for i := range setting.ModelChannel.ModelCosts {
		cost := &setting.ModelChannel.ModelCosts[i]
		cost.Model = strings.TrimSpace(cost.Model)
		cost.Resolution = strings.TrimSpace(cost.Resolution)
		cost.Vendor = strings.TrimSpace(cost.Vendor)
		cost.BillingMode = normalizeBillingMode(cost.BillingMode, cost.Model)
		if cost.Credits < 0 {
			cost.Credits = 0
		}
		cost.Credits = normalizeCredits(cost.Credits)
		if cost.Price < 0 {
			cost.Price = 0
		}
		cost.Price = math.Round(cost.Price*10000) / 10000
		if cost.Tags == nil {
			cost.Tags = []string{}
		}
	}
	if setting.ModelChannel.AllowCustomChannel == nil {
		enabled := true
		setting.ModelChannel.AllowCustomChannel = &enabled
	}
	if setting.ModelChannel.AllowUserRemoteChannel == nil {
		enabled := false
		setting.ModelChannel.AllowUserRemoteChannel = &enabled
	}
	if setting.Auth.AllowRegister == nil {
		enabled := true
		setting.Auth.AllowRegister = &enabled
	}
	setting.ModelChannel.AvailableModels = filterEnabledModels(setting.ModelChannel.AvailableModels, enabledChannelModels(channels))
	workflows := []string{}
	for _, channel := range channels {
		if !isWorkflowChannelProtocol(channel.Protocol) {
			continue
		}
		for _, entry := range channel.Workflows {
			if entry.Enabled && entry.Provider == channel.Protocol {
				workflows = append(workflows, workflowBillingName(WorkflowRef{Scope: "system", ChannelID: channel.ID, Kind: entry.Kind, WorkflowID: entry.WorkflowID}))
			}
		}
	}
	setting.ModelChannel.AvailableWorkflows = filterEnabledModels(setting.ModelChannel.AvailableWorkflows, workflows)
	setting.ModelChannel.DefaultTextModel = repairDefaultModel(setting.ModelChannel.DefaultTextModel, setting.ModelChannel.AvailableModels, isTextModelName)
	setting.ModelChannel.DefaultImageModel = repairDefaultModel(setting.ModelChannel.DefaultImageModel, setting.ModelChannel.AvailableModels, isImageModelName)
	setting.ModelChannel.DefaultVideoModel = repairDefaultModel(setting.ModelChannel.DefaultVideoModel, setting.ModelChannel.AvailableModels, isVideoModelName)
	setting.ModelChannel.DefaultModel = repairDefaultModel(setting.ModelChannel.DefaultModel, setting.ModelChannel.AvailableModels, isTextModelName)
	return setting
}

func normalizeBillingMode(mode string, modelName string) string {
	switch strings.ToLower(strings.TrimSpace(mode)) {
	case model.BillingModeImage:
		return model.BillingModeImage
	case model.BillingModeSecond:
		return model.BillingModeSecond
	case model.BillingModeRequest:
		return model.BillingModeRequest
	}
	if strings.HasPrefix(strings.TrimSpace(modelName), "workflow:") {
		return model.BillingModeRequest
	}
	if isVideoModelName(modelName) {
		return model.BillingModeSecond
	}
	return model.BillingModeImage
}

func normalizePricingSetting(setting model.PricingSetting) model.PricingSetting {
	if strings.TrimSpace(setting.Currency) == "" {
		setting.Currency = "CNY"
	}
	setting.CreditRate = math.Round(setting.CreditRate*10000) / 10000
	if setting.CreditRate <= 0 || math.IsNaN(setting.CreditRate) || math.IsInf(setting.CreditRate, 0) {
		setting.CreditRate = 1
	}
	if len(setting.Groups) == 0 {
		setting.Groups = []model.ModelGroup{{ID: "default", Name: "默认分组", Ratio: 1}}
	}
	groups := make([]model.ModelGroup, 0, len(setting.Groups))
	seen := map[string]bool{}
	for _, group := range setting.Groups {
		group.ID = strings.TrimSpace(group.ID)
		group.Name = strings.TrimSpace(group.Name)
		if group.ID == "" || seen[group.ID] {
			continue
		}
		if group.Name == "" {
			group.Name = group.ID
		}
		seen[group.ID] = true
		groups = append(groups, group)
	}
	if len(groups) == 0 {
		groups = append(groups, model.ModelGroup{ID: "default", Name: "默认分组", Ratio: 1})
	}
	setting.Groups = groups
	return setting
}

// findModelCost 按模型和分辨率查找计费配置，分辨率缺省时回退到模型默认配置。
func findModelCost(costs []model.ModelCost, modelName string, resolution string) (model.ModelCost, bool) {
	modelName = strings.TrimSpace(modelName)
	normalized := strings.TrimSuffix(strings.ToLower(strings.TrimSpace(resolution)), "p")
	var fallback model.ModelCost
	hasFallback := false
	for _, item := range costs {
		if item.Model != modelName {
			continue
		}
		if item.Resolution == "" {
			fallback = item
			hasFallback = true
			continue
		}
		if strings.TrimSuffix(strings.ToLower(item.Resolution), "p") == normalized {
			return item, true
		}
	}
	return fallback, hasFallback
}

// ModelCost 返回模型单次调用的算力点消耗。
func ModelCost(modelName string, userGroup string, resolutions ...string) (float64, error) {
	detail, err := ResolveModelUsageCost(modelName, userGroup, resolutions...)
	return detail.Credits, err
}

// ModelUsageCost 模型一次调用的实际计费结果。
type ModelUsageCost struct {
	Credits     float64 `json:"credits"`
	Price       float64 `json:"price"`
	BillingMode string  `json:"billingMode"`
	UnitPrice   float64 `json:"unitPrice"`
}

// ResolveModelUsageCost 按模型计费配置解析单次调用价格。未配置计费时返回 0，不阻断调用。
// userGroup 为空时按默认分组（倍率 1）计算。
func ResolveModelUsageCost(modelName string, userGroup string, resolutions ...string) (ModelUsageCost, error) {
	settings, err := repository.GetSettings()
	if err != nil {
		return ModelUsageCost{}, err
	}
	resolution := ""
	if len(resolutions) > 0 {
		resolution = resolutions[0]
	}
	channel := normalizePublicSetting(settings.Public).ModelChannel
	group := normalizationGroup(userGroup)
	if _, err := configuredGroupRatio(channel.Pricing.Groups, group); err != nil {
		return ModelUsageCost{}, err
	}
	return resolveModelUsageCost(channel, modelName, group, resolution), nil
}

func normalizationGroup(group string) string {
	group = strings.TrimSpace(group)
	if group == "" {
		return model.DefaultUserGroup
	}
	return group
}

func resolveModelUsageCost(channel model.PublicModelChannelSetting, modelName string, userGroup string, resolution string) ModelUsageCost {
	return resolveModelUsageCostWithRatio(channel, modelName, userGroup, resolution, modelGroupRatio(channel.Pricing.Groups, userGroup))
}

func resolveModelUsageCostWithRatio(channel model.PublicModelChannelSetting, modelName string, userGroup string, resolution string, ratio float64) ModelUsageCost {
	cost, ok := findModelCost(channel.ModelCosts, modelName, resolution)
	if !ok {
		return ModelUsageCost{}
	}
	mode := normalizeBillingMode(cost.BillingMode, modelName)
	rate := channel.Pricing.CreditRate
	if rate <= 0 {
		rate = 1
	}
	// 分组倍率来自同一次调用的快照，避免任务运行期间价格发生漂移。
	unit := math.Round(cost.Price*10000) / 10000
	credits := unit / rate
	// 未填写单价但配置了算力点时，按算力点计费，避免模型变成免费。
	if unit <= 0 && cost.Credits > 0 {
		credits = cost.Credits
		unit = math.Round(cost.Credits*rate*10000) / 10000
	}
	unit = math.Round(unit*ratio*10000) / 10000
	credits = unit / rate
	return ModelUsageCost{
		Credits:     normalizeCredits(credits),
		Price:       math.Round(unit*10000) / 10000,
		BillingMode: mode,
		UnitPrice:   unit,
	}
}

// modelGroupRatio is used only after validating the configured group.
func modelGroupRatio(groups []model.ModelGroup, group string) float64 {
	group = normalizationGroup(group)
	for _, item := range groups {
		if item.ID == group {
			if item.Ratio > 0 {
				return item.Ratio
			}
			return 1
		}
	}
	return 1
}

func announcementPublishTime(value string) (time.Time, error) {
	value = strings.TrimSpace(value)
	if value == "" {
		return time.Time{}, nil
	}
	if len(value) == len(time.DateOnly) {
		return time.ParseInLocation(time.DateOnly, value, time.Local)
	}
	return time.Parse(time.RFC3339Nano, value)
}

func validateAnnouncements(notices []model.Announcement) error {
	if len(notices) > 100 {
		return safeMessageError{message: "公告不能超过 100 条"}
	}
	seen := map[string]bool{}
	for _, notice := range notices {
		id := strings.TrimSpace(notice.ID)
		if len(id) > 128 || (id != "" && seen[id]) {
			return safeMessageError{message: "公告 ID 不能重复或超过 128 字节"}
		}
		seen[id] = id != ""
		if strings.TrimSpace(notice.Title) == "" || utf8.RuneCountInString(notice.Title) > 200 {
			return safeMessageError{message: "公告标题须为 1 至 200 个字符"}
		}
		if strings.TrimSpace(notice.Content) == "" || utf8.RuneCountInString(notice.Content) > 20000 {
			return safeMessageError{message: "公告内容须为 1 至 20000 个字符"}
		}
		if notice.Type != "info" && notice.Type != "success" && notice.Type != "warning" {
			return safeMessageError{message: "公告类型须为 info、success 或 warning"}
		}
		if _, err := announcementPublishTime(notice.PublishDate); err != nil {
			return safeMessageError{message: "公告发布日期须为空、有效日期或带时区的 ISO 时间"}
		}
	}
	return nil
}

func publishedAnnouncements(notices []model.Announcement, current time.Time) []model.Announcement {
	result := []model.Announcement{}
	for _, notice := range notices {
		published, err := announcementPublishTime(notice.PublishDate)
		if notice.Enabled && err == nil && !published.After(current) && validateAnnouncements([]model.Announcement{notice}) == nil {
			result = append(result, notice)
		}
	}
	return result
}

func normalizePrivateSetting(setting model.PrivateSetting) model.PrivateSetting {
	if setting.Channels == nil {
		setting.Channels = []model.ModelChannel{}
	}
	setting.PromptSync = normalizePromptSyncSetting(setting.PromptSync)
	setting.AILog = normalizeAILogSetting(setting.AILog)
	setting.Storage = normalizePrivateStorageSetting(setting.Storage)
	setting.ChannelHealth = normalizeChannelHealthSetting(setting.ChannelHealth)
	for i := range setting.Channels {
		if setting.Channels[i].Protocol == "" {
			setting.Channels[i].Protocol = "openai"
		}
		if setting.Channels[i].ID == "" {
			setting.Channels[i].ID = stableModelChannelID(setting.Channels[i])
		}
		setting.Channels[i].Groups = normalizedChannelGroups(setting.Channels[i].Groups)
		if setting.Channels[i].Models == nil {
			setting.Channels[i].Models = []string{}
		}
		if setting.Channels[i].Weight <= 0 {
			setting.Channels[i].Weight = 1
		}
		if setting.Channels[i].Timeout <= 0 {
			setting.Channels[i].Timeout = 600
		}
	}
	return setting
}

func hidePrivateAPIKeys(settings model.Settings) model.Settings {
	for i := range settings.Private.Channels {
		settings.Private.Channels[i].APIKey = ""
		settings.Private.Channels[i].UploadAPIKey = ""
	}
	for i := range settings.Private.Storage.Providers {
		settings.Private.Storage.Providers[i].SecretAccessKey = ""
		settings.Private.Storage.Providers[i].Password = ""
	}
	settings.Private.Auth.LinuxDo.ClientSecret = ""
	return settings
}

func keepPrivateAPIKeys(settings *model.Settings, saved model.Settings) {
	for i := range settings.Private.Channels {
		if !isWorkflowChannelProtocol(settings.Private.Channels[i].Protocol) {
			if strings.TrimSpace(settings.Private.Channels[i].APIKey) != "" {
				continue
			}
			if channel, ok := findSavedChannel(settings.Private.Channels[i], saved.Private.Channels, i); ok {
				settings.Private.Channels[i].APIKey = channel.APIKey
			}
			continue
		}
		for _, channel := range saved.Private.Channels {
			if channel.ID != settings.Private.Channels[i].ID || channel.Protocol != settings.Private.Channels[i].Protocol {
				continue
			}
			if strings.TrimSpace(settings.Private.Channels[i].APIKey) == "" {
				settings.Private.Channels[i].APIKey = channel.APIKey
			}
			if strings.TrimSpace(settings.Private.Channels[i].UploadAPIKey) == "" {
				settings.Private.Channels[i].UploadAPIKey = channel.UploadAPIKey
			}
			break
		}
	}
}

func keepPrivateAuthSecrets(settings *model.Settings, saved model.Settings) {
	if strings.TrimSpace(settings.Private.Auth.LinuxDo.ClientSecret) == "" {
		settings.Private.Auth.LinuxDo.ClientSecret = saved.Private.Auth.LinuxDo.ClientSecret
	}
}

func findSavedChannel(channel model.ModelChannel, saved []model.ModelChannel, index int) (model.ModelChannel, bool) {
	for _, item := range saved {
		if item.Name == channel.Name && item.BaseURL == channel.BaseURL {
			return item, true
		}
	}
	if index >= 0 && index < len(saved) {
		return saved[index], true
	}
	return model.ModelChannel{}, false
}

func SelectModelChannel(modelName string) (model.ModelChannel, error) {
	return SelectModelChannelForModel(modelName, "", true)
}

func SelectModelChannelForModel(modelName string, channelID string, publicOnly bool) (model.ModelChannel, error) {
	settings, err := repository.GetSettings()
	if err != nil {
		return model.ModelChannel{}, err
	}
	return selectModelChannel(normalizeSettings(settings), modelName, channelID, publicOnly, "")
}

// An empty group is reserved for internal polling and administrator channel tests.
func selectModelChannel(settings model.Settings, modelName, channelID string, publicOnly bool, group string) (model.ModelChannel, error) {
	privateChannels := settings.Private.Channels
	if group != "" {
		if _, err := configuredGroupRatio(settings.Public.ModelChannel.Pricing.Groups, group); err != nil {
			return model.ModelChannel{}, err
		}
		privateChannels = channelsInGroup(privateChannels, group)
	}
	if publicOnly && len(settings.Public.ModelChannel.AvailableModels) > 0 && !slices.Contains(settings.Public.ModelChannel.AvailableModels, modelName) {
		return model.ModelChannel{}, safeMessageError{message: "模型未开放"}
	}
	channels := modelChannelsForModel(privateChannels, modelName)
	if len(channels) == 0 {
		return model.ModelChannel{}, safeMessageError{message: "当前分组没有可用模型渠道"}
	}
	if strings.TrimSpace(channelID) != "" {
		for _, channel := range channels {
			if channel.ID == channelID {
				return channel, nil
			}
		}
		return model.ModelChannel{}, safeMessageError{message: "指定模型渠道不可用或不属于当前分组"}
	}
	candidates := availableModelChannels(channels)
	return weightedShuffleChannels(candidates)[0], nil
}

// availableModelChannels 过滤掉冷却中的渠道；冷却到期渠道放回并触发探活，全部冷却时按到期时间兜底。
func availableModelChannels(channels []model.ModelChannel) []model.ModelChannel {
	health := ChannelHealthMap()
	if len(health) == 0 {
		return channels
	}
	available := make([]model.ModelChannel, 0, len(channels))
	cooling := make([]model.ModelChannel, 0)
	for _, channel := range channels {
		state, found := health[channel.ID]
		if !found || !IsChannelCooling(state) {
			available = append(available, channel)
			continue
		}
		if time.Now().After(state.CooldownUntil) {
			ProbeExpiredChannel(channel)
			available = append(available, channel)
			continue
		}
		cooling = append(cooling, channel)
	}
	if len(available) > 0 {
		return available
	}
	sort.Slice(cooling, func(i, j int) bool {
		return health[cooling[i].ID].CooldownUntil.Before(health[cooling[j].ID].CooldownUntil)
	})
	return cooling
}

// ChannelFailoverCandidates 返回同号池（同协议 + 同接口地址）内可换号重试的渠道，首选渠道排在最前。
func ChannelFailoverCandidates(selected model.ModelChannel, modelName string) []model.ModelChannel {
	settings, err := repository.GetSettings()
	if err != nil {
		return []model.ModelChannel{selected}
	}
	return channelFailoverCandidates(normalizePrivateSetting(settings.Private).Channels, selected, modelName)
}

func channelFailoverCandidates(configured []model.ModelChannel, selected model.ModelChannel, modelName string) []model.ModelChannel {
	channels := modelChannelsForModel(configured, modelName)
	pool := make([]model.ModelChannel, 0, len(channels))
	for _, channel := range channels {
		if channel.ID == selected.ID {
			continue
		}
		if channel.Protocol != selected.Protocol || normalizeModelChannelBaseURL(channel.BaseURL) != normalizeModelChannelBaseURL(selected.BaseURL) {
			continue
		}
		pool = append(pool, channel)
	}
	result := make([]model.ModelChannel, 0, len(pool)+1)
	result = append(result, selected)
	if len(pool) == 0 {
		return result
	}
	return append(result, weightedShuffleChannels(availableModelChannels(pool))...)
}

// weightedShuffleChannels 按权重不放回随机排序。
func weightedShuffleChannels(channels []model.ModelChannel) []model.ModelChannel {
	remaining := append([]model.ModelChannel(nil), channels...)
	result := make([]model.ModelChannel, 0, len(remaining))
	for len(remaining) > 0 {
		total := 0
		for _, channel := range remaining {
			total += channel.Weight
		}
		index := 0
		if total > 0 {
			hit := rand.Intn(total)
			for i, channel := range remaining {
				hit -= channel.Weight
				if hit < 0 {
					index = i
					break
				}
			}
		}
		result = append(result, remaining[index])
		remaining = append(remaining[:index], remaining[index+1:]...)
	}
	return result
}

func HTTPClientForChannel(channel model.ModelChannel) *http.Client {
	timeout := channel.Timeout
	if timeout <= 0 {
		timeout = 600
	}
	return &http.Client{Timeout: time.Duration(timeout) * time.Second}
}

func BuildModelChannelURL(channel model.ModelChannel, path string) string {
	return modelProtocolForChannel(channel).buildURL(channel, path)
}

func buildOpenAIModelChannelURL(channel model.ModelChannel, path string) string {
	baseURL := normalizeModelChannelBaseURL(channel.BaseURL)
	lowerBaseURL := strings.ToLower(baseURL)
	if !strings.HasSuffix(lowerBaseURL, "/v1") && !strings.HasSuffix(lowerBaseURL, "/api/v3") && !strings.HasSuffix(lowerBaseURL, "/api/plan/v3") && !strings.HasSuffix(lowerBaseURL, "/api/paas/v4") {
		baseURL += "/v1"
	}
	return baseURL + path
}

func normalizeModelChannelBaseURL(baseURL string) string {
	baseURL = strings.TrimRight(strings.TrimSpace(baseURL), "/")
	parsed, err := url.Parse(baseURL)
	if err == nil && parsed.Scheme != "" && parsed.Host != "" {
		path := strings.TrimRight(parsed.Path, "/")
		lowerPath := strings.ToLower(path)
		for _, versionPath := range []string{"/api/plan/v3", "/api/paas/v4"} {
			if index := strings.Index(lowerPath, versionPath); index >= 0 {
				end := index + len(versionPath)
				if len(lowerPath) == end || lowerPath[end] == '/' {
					parsed.Path = path[:end]
					parsed.RawPath = ""
					parsed.RawQuery = ""
					parsed.Fragment = ""
					return strings.TrimRight(parsed.String(), "/")
				}
			}
		}
	}
	return baseURL
}

func isArkAgentPlanChannel(channel model.ModelChannel) bool {
	if !IsArkChannel(channel) {
		return false
	}
	baseURL := strings.ToLower(normalizeModelChannelBaseURL(channel.BaseURL))
	return strings.HasSuffix(baseURL, "/api/plan/v3")
}

func enabledChannelModels(channels []model.ModelChannel) []string {
	models := []string{}
	for _, channel := range channels {
		if !channel.Enabled || channel.BaseURL == "" || channel.APIKey == "" || isWorkflowChannelProtocol(channel.Protocol) {
			continue
		}
		models = append(models, channel.Models...)
	}
	return uniqueModelNames(models)
}

func filterEnabledModels(models []string, options []string) []string {
	allowed := map[string]bool{}
	for _, modelName := range options {
		allowed[modelName] = true
	}
	result := []string{}
	for _, modelName := range uniqueModelNames(models) {
		if allowed[modelName] {
			result = append(result, modelName)
		}
	}
	return result
}

func uniqueModelNames(models []string) []string {
	result := []string{}
	seen := map[string]bool{}
	for _, item := range models {
		name := strings.TrimSpace(item)
		if name == "" || seen[name] {
			continue
		}
		seen[name] = true
		result = append(result, name)
	}
	return result
}

func repairDefaultModel(current string, models []string, preferred func(string) bool) string {
	current = strings.TrimSpace(current)
	for _, item := range models {
		if item == current {
			return current
		}
	}
	for _, item := range models {
		if preferred(item) {
			return item
		}
	}
	if len(models) > 0 {
		return models[0]
	}
	return ""
}

func isVideoModelName(modelName string) bool {
	name := strings.ToLower(strings.TrimSpace(modelName))
	if kind := AutoDLModelKind(modelName); kind != "unsupported" {
		return kind == "video"
	}
	return name == "minimax-h3" || strings.Contains(name, "seedance") || strings.Contains(name, "video") || (strings.Contains(name, "sd") && !strings.Contains(name, "sdxl"))
}

func isImageModelName(modelName string) bool {
	if AutoDLModelKind(modelName) != "unsupported" {
		return false
	}
	name := strings.ToLower(strings.TrimSpace(modelName))
	return strings.Contains(name, "seedream") || strings.Contains(name, "gpt-image") || strings.Contains(name, "image")
}

func isTextModelName(modelName string) bool {
	return AutoDLModelKind(modelName) != "audio" && !isImageModelName(modelName) && !isVideoModelName(modelName)
}

func normalizeModelChannel(channel model.ModelChannel) model.ModelChannel {
	if channel.Protocol == "" {
		channel.Protocol = "openai"
	}
	if channel.ID == "" {
		channel.ID = stableModelChannelID(channel)
	}
	if channel.Models == nil {
		channel.Models = []string{}
	}
	if channel.Weight <= 0 {
		channel.Weight = 1
	}
	if channel.Timeout <= 0 {
		channel.Timeout = 600
	}
	return channel
}

func isWorkflowChannelProtocol(protocol string) bool {
	return protocol == "runninghub" || protocol == "comfyui"
}

func resolveAdminChannel(index *int, channel model.ModelChannel) (model.ModelChannel, error) {
	resolved := normalizeModelChannel(channel)
	if strings.TrimSpace(resolved.APIKey) == "" {
		settings, err := repository.GetSettings()
		if err != nil {
			return model.ModelChannel{}, err
		}
		saved := normalizePrivateSetting(settings.Private).Channels
		if index != nil && *index >= 0 && *index < len(saved) {
			if resolved.APIKey == "" {
				resolved.APIKey = saved[*index].APIKey
			}
			if resolved.BaseURL == "" {
				resolved.BaseURL = saved[*index].BaseURL
			}
			if resolved.Name == "" {
				resolved.Name = saved[*index].Name
			}
		}
		if resolved.APIKey == "" {
			if savedChannel, ok := findSavedChannel(resolved, saved, -1); ok {
				resolved.APIKey = savedChannel.APIKey
			}
		}
	}
	if strings.TrimSpace(resolved.BaseURL) == "" {
		return model.ModelChannel{}, safeMessageError{message: "缺少接口地址"}
	}
	if strings.TrimSpace(resolved.APIKey) == "" {
		return model.ModelChannel{}, safeMessageError{message: "缺少 API Key"}
	}
	return resolved, nil
}

func fetchAdminChannelModels(channel model.ModelChannel) ([]string, error) {
	adapter, _ := matchModelProtocol(modelDiscoveryRules, channel, "")
	return adapter.models(channel)
}

func fetchOpenAIAdminChannelModels(channel model.ModelChannel) ([]string, error) {
	request, err := http.NewRequest(http.MethodGet, BuildModelChannelURL(channel, "/models"), nil)
	if err != nil {
		return nil, err
	}
	SetModelChannelAuthHeader(request, channel)
	response, err := adminModelHTTPClient.Do(request)
	if err != nil {
		return nil, safeMessageError{message: "读取模型失败：上游接口无响应或网络不可达"}
	}
	defer response.Body.Close()
	body, _ := io.ReadAll(response.Body)
	if response.StatusCode >= http.StatusBadRequest {
		if response.StatusCode == http.StatusNotFound && isArkAgentPlanChannel(channel) {
			return nil, safeMessageError{message: "火山方舟 Agent Plan 未提供 OpenAI /models 模型列表接口，请手动填写模型名称，例如 doubao-seedance-2.0。"}
		}
		return nil, readAdminChannelError(body, response.StatusCode, "读取模型失败")
	}
	var payload struct {
		Data []struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	_ = json.Unmarshal(body, &payload)
	result := make([]string, 0, len(payload.Data))
	for _, item := range payload.Data {
		if strings.TrimSpace(item.ID) != "" {
			result = append(result, item.ID)
		}
	}
	sort.Strings(result)
	return result, nil
}

func isKIEAdminChannel(channel model.ModelChannel) bool {
	protocol := strings.ToLower(strings.TrimSpace(channel.Protocol))
	baseURL := strings.ToLower(strings.TrimSpace(channel.BaseURL))
	return protocol == "kie" || strings.Contains(baseURL, "kie.ai")
}

func kieMarketModels() []string {
	return []string{
		"bytedance/seedream",
		"bytedance/seedream-v4-text-to-image",
		"bytedance/seedream-v4-edit",
		"seedream/4.5-text-to-image",
		"seedream/4.5-edit",
		"seedream/5-lite-text-to-image",
		"seedream/5-lite-image-to-image",
		"seedream/5-pro-text-to-image",
		"seedream/5-pro-image-to-image",
		"seedream/5-pro-layer-decomposition",
		"z-image",
		"nano-banana-2",
		"nano-banana-2-lite",
		"google/imagen4-fast",
		"google/imagen4-ultra",
		"google/imagen4",
		"google/nano-banana-edit",
		"google/nano-banana",
		"nano-banana-pro",
		"flux-2/pro-image-to-image",
		"flux-2/pro-text-to-image",
		"flux-2/flex-image-to-image",
		"flux-2/flex-text-to-image",
		"grok-imagine-image-2-0/text-to-image",
		"grok-imagine/text-to-image",
		"grok-imagine/image-to-image",
		"gpt-image/1.5-text-to-image",
		"gpt-image/1.5-image-to-image",
		"gpt-image-2-text-to-image",
		"gpt-image-2-image-to-image",
		"topaz/image-upscale",
		"recraft/remove-background",
		"recraft/crisp-upscale",
		"ideogram/character-edit",
		"ideogram/character-remix",
		"ideogram/character",
		"ideogram/v3-text-to-image",
		"ideogram/v3-edit",
		"ideogram/v3-remix",
		"qwen/text-to-image",
		"qwen/image-to-image",
		"qwen/image-edit",
		"qwen2/image-edit",
		"qwen2/text-to-image",
		"wan/2-7-image",
		"wan/2-7-image-pro",
		"grok-imagine/text-to-video",
		"grok-imagine/image-to-video",
		"grok-imagine/upscale",
		"grok-imagine/extend",
		"grok-imagine-video-1-5-preview",
		"minimax-h3/text-to-video",
		"minimax-h3/image-to-video",
		"minimax-h3/reference-to-video",
		"kling-2.6/text-to-video",
		"kling-2.6/image-to-video",
		"kling/v2-5-turbo-image-to-video-pro",
		"kling/v2-5-turbo-text-to-video-pro",
		"kling/ai-avatar-standard",
		"kling/ai-avatar-pro",
		"kling/v2-1-master-image-to-video",
		"kling/v2-1-master-text-to-video",
		"kling/v2-1-pro",
		"kling/v2-1-standard",
		"kling-2.6/motion-control",
		"kling-3.0/motion-control",
		"kling-3.0/video",
		"kling-3.0-omni/text-to-video",
		"kling-3.0-omni/image-to-video",
		"kling-3.0-omni/reference-to-video",
		"kling-3.0-omni/transformation",
		"kling/v3-turbo-text-to-video",
		"kling/v3-turbo-image-to-video",
		"bytedance/seedance-2",
		"bytedance/seedance-2-fast",
		"bytedance/seedance-2-mini",
		"bytedance/seedance-1.5-pro",
		"bytedance/v1-pro-fast-image-to-video",
		"bytedance/v1-pro-image-to-video",
		"bytedance/v1-pro-text-to-video",
		"bytedance/v1-lite-image-to-video",
		"bytedance/v1-lite-text-to-video",
		"hailuo/2-3-image-to-video-pro",
		"hailuo/2-3-image-to-video-standard",
		"hailuo/02-text-to-video-pro",
		"hailuo/02-image-to-video-pro",
		"hailuo/02-text-to-video-standard",
		"hailuo/02-image-to-video-standard",
		"wan/2-2-a14b-image-to-video-turbo",
		"wan/2-2-a14b-speech-to-video-turbo",
		"wan/2-2-a14b-text-to-video-turbo",
		"wan/2-2-animate-move",
		"wan/2-2-animate-replace",
		"wan/2-6-image-to-video",
		"wan/2-6-text-to-video",
		"wan/2-6-video-to-video",
		"wan/2-6-flash-image-to-video",
		"wan/2-6-flash-video-to-video",
		"wan/2-5-image-to-video",
		"wan/2-5-text-to-video",
		"wan/2-7-text-to-video",
		"wan/2-7-image-to-video",
		"wan/2-7-videoedit",
		"wan/2-7-r2v",
		"topaz/video-upscale",
		"infinitalk/from-audio",
		"happyhorse/text-to-video",
		"happyhorse/image-to-video",
		"happyhorse/reference-to-video",
		"happyhorse/video-edit",
		"happyhorse-1-1/text-to-video",
		"happyhorse-1-1/image-to-video",
		"happyhorse-1-1/reference-to-video",
		"happyhorse-1-1/text-to-video",
		"happyhorse-1-1/image-to-video",
		"happyhorse-1-1/reference-to-video",
		"gemini-omni-video",
	}
}

func testAdminChannelModel(channel model.ModelChannel, modelName string) (string, error) {
	if strings.TrimSpace(modelName) == "" {
		return "", errors.New("缺少模型名称")
	}
	adapter, _ := matchModelProtocol(modelGenerationTestRules, channel, modelName)
	return adapter.testModel(channel, modelName)
}

func testOpenAIChannelModel(channel model.ModelChannel, modelName string) (string, error) {
	body, _ := json.Marshal(map[string]any{
		"model": modelName,
		"messages": []map[string]string{{
			"role":    "user",
			"content": "hi",
		}},
	})
	request, err := http.NewRequest(http.MethodPost, BuildModelChannelURL(channel, "/chat/completions"), strings.NewReader(string(body)))
	if err != nil {
		return "", err
	}
	request.Header.Set("Authorization", "Bearer "+channel.APIKey)
	request.Header.Set("Content-Type", "application/json")
	response, err := adminModelHTTPClient.Do(request)
	if err != nil {
		return "", safeMessageError{message: "测试失败：上游接口无响应或网络不可达"}
	}
	defer response.Body.Close()
	responseBody, _ := io.ReadAll(response.Body)
	if response.StatusCode >= http.StatusBadRequest {
		return "", readAdminChannelError(responseBody, response.StatusCode, "测试失败")
	}
	var payload struct {
		Choices []struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
	}
	_ = json.Unmarshal(responseBody, &payload)
	if len(payload.Choices) > 0 && strings.TrimSpace(payload.Choices[0].Message.Content) != "" {
		return payload.Choices[0].Message.Content, nil
	}
	return "ok", nil
}

func fetchGeminiAdminChannelModels(channel model.ModelChannel) ([]string, error) {
	result := []string{}
	pageToken := ""
	for {
		path := "/v1beta/models"
		if pageToken != "" {
			path += "?pageToken=" + url.QueryEscape(pageToken)
		}
		request, err := http.NewRequest(http.MethodGet, BuildGeminiChannelURL(channel, path), nil)
		if err != nil {
			return nil, err
		}
		SetModelChannelAuthHeader(request, channel)
		response, err := adminModelHTTPClient.Do(request)
		if err != nil {
			return nil, safeMessageError{message: "读取模型失败：上游接口无响应或网络不可达"}
		}
		body, _ := io.ReadAll(response.Body)
		response.Body.Close()
		if response.StatusCode >= http.StatusBadRequest {
			return nil, readAdminChannelError(body, response.StatusCode, "读取模型失败")
		}
		var payload struct {
			Models []struct {
				Name                       string   `json:"name"`
				SupportedGenerationMethods []string `json:"supportedGenerationMethods"`
			} `json:"models"`
			NextPageToken string `json:"nextPageToken"`
		}
		if json.Unmarshal(body, &payload) != nil {
			return nil, safeMessageError{message: "读取模型失败：上游响应无法解析"}
		}
		for _, item := range payload.Models {
			name := strings.TrimPrefix(strings.TrimSpace(item.Name), "models/")
			methods := strings.Join(item.SupportedGenerationMethods, ",")
			if name != "" && !strings.Contains(strings.ToLower(name), "embed") && (strings.Contains(methods, "generateContent") || strings.Contains(methods, "predictLongRunning") || strings.HasPrefix(strings.ToLower(name), "veo-") || strings.HasPrefix(strings.ToLower(name), "imagen-")) {
				result = append(result, name)
			}
		}
		pageToken = strings.TrimSpace(payload.NextPageToken)
		if pageToken == "" {
			break
		}
	}
	seen := map[string]bool{}
	unique := result[:0]
	for _, name := range result {
		if !seen[name] {
			seen[name] = true
			unique = append(unique, name)
		}
	}
	result = unique
	sort.Strings(result)
	if len(result) == 0 {
		return nil, safeMessageError{message: "Gemini 模型列表为空"}
	}
	return result, nil
}

func testGeminiChannelModel(channel model.ModelChannel, modelName string) (string, error) {
	lowerModel := strings.ToLower(strings.TrimSpace(modelName))
	if strings.HasPrefix(lowerModel, "veo-") || strings.Contains(lowerModel, "image") || strings.Contains(lowerModel, "tts") {
		return "模型列表与渠道配置有效；图片、视频和语音模型未执行付费生成测试。", nil
	}
	body := GeminiTextRequestBody(modelName, "hi")
	body, _ = StripGeminiModelField(body, "application/json")
	request, err := http.NewRequest(http.MethodPost, BuildGeminiChannelURL(channel, GeminiModelActionPath(modelName, "generateContent")), strings.NewReader(string(body)))
	if err != nil {
		return "", err
	}
	SetModelChannelAuthHeader(request, channel)
	request.Header.Set("Content-Type", "application/json")
	response, err := adminModelHTTPClient.Do(request)
	if err != nil {
		return "", safeMessageError{message: "测试失败：上游接口无响应或网络不可达"}
	}
	defer response.Body.Close()
	responseBody, _ := io.ReadAll(response.Body)
	if response.StatusCode >= http.StatusBadRequest {
		return "", readAdminChannelError(responseBody, response.StatusCode, "测试失败")
	}
	if text := GeminiResponseText(responseBody); text != "" {
		return text, nil
	}
	return "ok", nil
}

func testGLMTTSChannelModel(channel model.ModelChannel, modelName string) (string, error) {
	body, _ := json.Marshal(map[string]any{
		"model":           modelName,
		"input":           "你好，这是语音模型测试。",
		"voice":           "tongtong",
		"response_format": "wav",
		"speed":           1,
	})
	request, err := http.NewRequest(http.MethodPost, BuildModelChannelURL(channel, "/audio/speech"), strings.NewReader(string(body)))
	if err != nil {
		return "", err
	}
	request.Header.Set("Authorization", "Bearer "+channel.APIKey)
	request.Header.Set("Content-Type", "application/json")
	response, err := adminModelHTTPClient.Do(request)
	if err != nil {
		return "", safeMessageError{message: "测试失败：上游接口无响应或网络不可达"}
	}
	defer response.Body.Close()
	responseBody, _ := io.ReadAll(response.Body)
	if response.StatusCode >= http.StatusBadRequest {
		return "", readAdminChannelError(responseBody, response.StatusCode, "测试失败")
	}
	if len(responseBody) == 0 {
		return "", safeMessageError{message: "测试失败：GLM-TTS 未返回音频数据"}
	}
	return "ok", nil
}

func testMiMoTTSChannelModel(channel model.ModelChannel, modelName string) (string, error) {
	if strings.EqualFold(strings.TrimSpace(modelName), "mimo-v2.5-tts-voiceclone") {
		return "MiMo VoiceClone 需要画布连接 MP3/WAV 参考音频，后台不发送克隆样本，因此未执行上游生成测试。", nil
	}
	messages := []map[string]string{{"role": "assistant", "content": "你好，这是语音模型测试。"}}
	audio := map[string]any{"format": "wav"}
	if strings.EqualFold(strings.TrimSpace(modelName), "mimo-v2.5-tts-voicedesign") {
		messages = append([]map[string]string{{"role": "user", "content": "自然清晰的年轻女声"}}, messages...)
	} else {
		audio["voice"] = "冰糖"
	}
	body, _ := json.Marshal(map[string]any{"model": modelName, "messages": messages, "audio": audio})
	request, err := http.NewRequest(http.MethodPost, BuildModelChannelURL(channel, "/chat/completions"), strings.NewReader(string(body)))
	if err != nil {
		return "", err
	}
	request.Header.Set("Authorization", "Bearer "+channel.APIKey)
	request.Header.Set("Content-Type", "application/json")
	response, err := adminModelHTTPClient.Do(request)
	if err != nil {
		return "", safeMessageError{message: "测试失败：上游接口无响应或网络不可达"}
	}
	defer response.Body.Close()
	responseBody, _ := io.ReadAll(response.Body)
	if response.StatusCode >= http.StatusBadRequest {
		return "", readAdminChannelError(responseBody, response.StatusCode, "测试失败")
	}
	var payload struct {
		Choices []struct {
			Message struct {
				Audio *struct {
					Data string `json:"data"`
				} `json:"audio"`
			} `json:"message"`
		} `json:"choices"`
	}
	if json.Unmarshal(responseBody, &payload) != nil || len(payload.Choices) == 0 || payload.Choices[0].Message.Audio == nil || strings.TrimSpace(payload.Choices[0].Message.Audio.Data) == "" {
		return "", safeMessageError{message: "测试失败：MiMo TTS 未返回音频数据"}
	}
	return "ok", nil
}

func testArkSeedanceChannelModel(channel model.ModelChannel, modelName string) (string, error) {
	if strings.TrimSpace(modelName) == "" {
		return "", errors.New("缺少模型名称")
	}
	if strings.TrimSpace(channel.BaseURL) == "" {
		return "", safeMessageError{message: "缺少接口地址"}
	}
	if strings.TrimSpace(channel.APIKey) == "" {
		return "", safeMessageError{message: "缺少 API Key"}
	}
	if !isArkAgentPlanChannel(channel) {
		return "Seedance 视频模型不会发送 /chat/completions 文本测试。已检查 Base URL、API Key 和模型名非空；未调用视频生成接口，因此未验证套餐额度或模型权限。", nil
	}
	return "Agent Plan / Seedance 视频模型配置格式已通过。后台测试不会调用视频生成接口，因此未验证 API Key、套餐额度或模型权限；请在画布中使用视频生成验证。", nil
}

func readAdminChannelError(body []byte, statusCode int, fallback string) error {
	var payload struct {
		Error *struct {
			Message string `json:"message"`
		} `json:"error"`
		Msg string `json:"msg"`
	}
	if len(body) > 0 && json.Unmarshal(body, &payload) == nil {
		if payload.Error != nil && strings.TrimSpace(payload.Error.Message) != "" {
			return safeMessageError{message: payload.Error.Message}
		}
		if strings.TrimSpace(payload.Msg) != "" {
			return safeMessageError{message: payload.Msg}
		}
	}
	if statusCode == http.StatusUnauthorized || statusCode == http.StatusForbidden {
		return safeMessageError{message: fmt.Sprintf("上游接口鉴权失败（%d），请检查 API Key、套餐权限或模型权限", statusCode)}
	}
	if statusCode == http.StatusTooManyRequests {
		return safeMessageError{message: "上游接口限流或额度不足（429），请稍后重试或检查额度"}
	}
	if statusCode > 0 {
		return safeMessageError{message: fmt.Sprintf("%s：%d", fallback, statusCode)}
	}
	return safeMessageError{message: fallback}
}

type safeMessageError struct {
	message string
}

func (err safeMessageError) Error() string {
	return err.message
}

func (err safeMessageError) SafeMessage() string {
	return err.message
}

func keepPrivateStorageSecrets(settings *model.Settings, saved model.Settings) {
	for i := range settings.Private.Storage.Providers {
		current := &settings.Private.Storage.Providers[i]
		if strings.TrimSpace(current.SecretAccessKey) != "" && strings.TrimSpace(current.Password) != "" {
			continue
		}
		if provider, ok := findSavedStorageProvider(*current, saved.Private.Storage.Providers, i); ok {
			if strings.TrimSpace(current.SecretAccessKey) == "" {
				current.SecretAccessKey = provider.SecretAccessKey
			}
			if strings.TrimSpace(current.Password) == "" {
				current.Password = provider.Password
			}
		}
	}
}

func findSavedStorageProvider(provider model.StorageProvider, saved []model.StorageProvider, index int) (model.StorageProvider, bool) {
	for _, item := range saved {
		if provider.ID != "" && item.ID == provider.ID {
			return item, true
		}
		if item.Type == provider.Type && item.Name == provider.Name && item.Endpoint == provider.Endpoint && item.Bucket == provider.Bucket && (provider.Type != model.StorageProviderTypeWebDAV || item.PathPrefix == provider.PathPrefix) {
			return item, true
		}
	}
	if index >= 0 && index < len(saved) && saved[index].Type == provider.Type {
		return saved[index], true
	}
	return model.StorageProvider{}, false
}

func validateEnabledStorageProviderTypes(providers []model.StorageProvider) error {
	enabledType := ""
	for _, provider := range providers {
		if provider.Type != model.StorageProviderTypeS3 && provider.Type != model.StorageProviderTypeWebDAV {
			return safeMessageError{message: "存储类型不支持"}
		}
		if !provider.Enabled {
			continue
		}
		if enabledType == "" {
			enabledType = provider.Type
			continue
		}
		if enabledType != provider.Type {
			return safeMessageError{message: "S3/R2 与 WebDAV 不能同时启用"}
		}
	}
	return nil
}

func normalizePrivateStorageSetting(setting model.PrivateStorageSetting) model.PrivateStorageSetting {
	if setting.Mode == "" {
		setting.Mode = "local_indexeddb"
		setting.AllowUserGlobalProvider = true
	}
	if setting.CapacityLimitBytes <= 0 {
		setting.CapacityLimitBytes = 9 * 1024 * 1024 * 1024
	}
	setting.CapacityCheck = normalizeStorageCapacityCheckSetting(setting.CapacityCheck)
	if setting.Providers == nil {
		setting.Providers = []model.StorageProvider{}
	}
	for i := range setting.Providers {
		setting.Providers[i] = normalizeStorageProvider(setting.Providers[i])
	}
	return setting
}

func normalizeStorageCapacityCheckSetting(setting model.StorageCapacityCheckSetting) model.StorageCapacityCheckSetting {
	if setting.Cron == "" {
		setting.Cron = "0 */6 * * *"
	}
	if setting.Enabled == nil {
		enabled := false
		setting.Enabled = &enabled
	}
	return setting
}

func normalizeStorageProvider(provider model.StorageProvider) model.StorageProvider {
	provider.Name = strings.TrimSpace(provider.Name)
	provider.Type = strings.ToLower(strings.TrimSpace(provider.Type))
	if provider.Type == "" {
		provider.Type = model.StorageProviderTypeS3
	}
	provider.Endpoint = strings.TrimRight(strings.TrimSpace(provider.Endpoint), "/")
	provider.Bucket = strings.TrimSpace(provider.Bucket)
	provider.AccessKeyID = strings.TrimSpace(provider.AccessKeyID)
	if provider.Type == model.StorageProviderTypeWebDAV {
		provider.PathPrefix = strings.Trim(strings.TrimSpace(provider.PathPrefix), "/")
		if provider.PathPrefix == "" {
			provider.PathPrefix = "canvas"
		}
	}
	provider.Username = strings.TrimSpace(provider.Username)
	if provider.Type == model.StorageProviderTypeS3 && provider.Region == "" {
		provider.Region = "auto"
	}
	if provider.ID == "" {
		provider.ID = stableStorageProviderID(provider)
	}
	if provider.Weight <= 0 {
		provider.Weight = 1
	}
	return provider
}

func stableStorageProviderID(provider model.StorageProvider) string {
	webDAVPath := ""
	if provider.Type == model.StorageProviderTypeWebDAV {
		webDAVPath = provider.PathPrefix
	}
	return "storage-" + providerSecureHash([]string{provider.OwnerUserID, provider.Type, provider.Name, provider.Endpoint, provider.Bucket, webDAVPath})
}

func stableModelChannelID(channel model.ModelChannel) string {
	return "channel-" + providerSecureHash([]string{channel.Name, channel.BaseURL})
}

func providerSecureHash(parts []string) string {
	sum := sha256.Sum256([]byte(strings.Join(parts, "|")))
	return hex.EncodeToString(sum[:])[:16]
}

func modelChannelsForModel(channels []model.ModelChannel, modelName string) []model.ModelChannel {
	result := []model.ModelChannel{}
	for _, channel := range channels {
		if isWorkflowChannelProtocol(channel.Protocol) {
			continue
		}
		if !channel.Enabled || channel.BaseURL == "" || channel.APIKey == "" {
			continue
		}
		for _, item := range channel.Models {
			if strings.TrimSpace(item) == modelName {
				result = append(result, channel)
				break
			}
		}
	}
	return result
}

func publicChannelInfos(channels []model.ModelChannel, availableModels, availableWorkflows []string) []model.PublicModelChannelInfo {
	result := []model.PublicModelChannelInfo{}
	allowed := map[string]bool{}
	for _, name := range availableWorkflows {
		allowed[name] = true
	}
	for _, channel := range channels {
		if !channel.Enabled || (channel.Protocol == "runninghub" && strings.TrimSpace(channel.APIKey) == "") {
			continue
		}
		if isWorkflowChannelProtocol(channel.Protocol) {
			workflows := []model.WorkflowSummary{}
			for _, entry := range channel.Workflows {
				if !entry.Enabled || entry.Provider != channel.Protocol || (len(availableWorkflows) > 0 && !allowed[workflowBillingName(WorkflowRef{Scope: "system", ChannelID: channel.ID, Kind: entry.Kind, WorkflowID: entry.WorkflowID})]) {
					continue
				}
				workflows = append(workflows, model.WorkflowSummary{
					Provider: entry.Provider, Kind: entry.Kind, WorkflowID: entry.WorkflowID,
					Title: entry.Title, Capability: entry.Capability, Enabled: true,
				})
			}
			if len(workflows) > 0 {
				result = append(result, model.PublicModelChannelInfo{
					ID: channel.ID, Protocol: channel.Protocol, Name: channel.Name, Enabled: channel.Enabled,
					Models: []string{}, Groups: normalizedChannelGroups(channel.Groups), Workflows: workflows,
				})
			}
			continue
		}
		if !channel.Enabled || channel.BaseURL == "" || channel.APIKey == "" || len(channel.Models) == 0 {
			continue
		}
		models := append([]string{}, channel.Models...)
		if len(availableModels) > 0 {
			models = filterEnabledModels(models, availableModels)
			if len(models) == 0 {
				continue
			}
		}
		modelCapabilities := map[string]string{}
		for _, name := range models {
			if capability, ok := channel.ModelCapabilities[name]; ok {
				modelCapabilities[name] = capability
			}
		}
		translated, _ := ParameterTranslationModels(channel.ParameterTranslation)
		translated = filterEnabledModels(translated, models)
		result = append(result, model.PublicModelChannelInfo{
			ParameterTranslationModels: translated,
			ID:                         channel.ID,
			Protocol:                   channel.Protocol,
			Name:                       channel.Name,
			BaseURL:                    channel.BaseURL,
			Models:                     models,
			Groups:                     normalizedChannelGroups(channel.Groups),
			Weight:                     channel.Weight,
			Timeout:                    channel.Timeout,
			Enabled:                    channel.Enabled,
			Remark:                     channel.Remark,

			ModelCapabilities: modelCapabilities,
		})
	}
	return result
}

func collectChannelModels(channels []model.ModelChannel) []string {
	seen := map[string]bool{}
	result := []string{}
	for _, channel := range channels {
		if !channel.Enabled || channel.BaseURL == "" {
			continue
		}
		for _, item := range channel.Models {
			modelName := strings.TrimSpace(item)
			if modelName == "" || seen[modelName] {
				continue
			}
			seen[modelName] = true
			result = append(result, modelName)
		}
	}
	sort.Strings(result)
	return result
}
