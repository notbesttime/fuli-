package service

import (
	"context"
	"math"
	"slices"
	"strings"

	"github.com/tigerowo/infinite-canvas/model"
	"github.com/tigerowo/infinite-canvas/repository"
)

// ModelBillingSnapshot records the group and unit price that charged a call.
type ModelBillingSnapshot = model.ModelBillingSnapshot

type modelGroupContextKey struct{}
type modelGroupSnapshot struct {
	billing  ModelBillingSnapshot
	settings model.Settings
}

// WithModelGroupSnapshot freezes routing and prices for this call and its children.
// The authenticated user's saved preference is independent of account entitlements.
func WithModelGroupSnapshot(ctx context.Context, user model.AuthUser, requestedGroup ...string) (context.Context, error) {
	group := user.PreferredGroup
	if len(requestedGroup) > 0 && strings.TrimSpace(requestedGroup[0]) != "" {
		group = requestedGroup[0]
	}
	return WithPersistedModelGroupSnapshot(ctx, user, ModelBillingSnapshot{Group: group})
}

func WithPersistedModelGroupSnapshot(ctx context.Context, user model.AuthUser, billing ModelBillingSnapshot) (context.Context, error) {
	if _, ok := ctx.Value(modelGroupContextKey{}).(modelGroupSnapshot); ok {
		return ctx, nil
	}
	settings, err := repository.GetSettings()
	if err != nil {
		return ctx, err
	}
	settings = normalizeSettings(settings)
	group := billing.Group
	if strings.TrimSpace(group) == "" {
		group = user.PreferredGroup
	}
	group = normalizationGroup(group)
	ratio := billing.GroupRatio
	if ratio <= 0 || math.IsNaN(ratio) || math.IsInf(ratio, 0) {
		ratio, err = configuredGroupRatio(settings.Public.ModelChannel.Pricing.Groups, group)
		if err != nil {
			return ctx, err
		}
	}
	billing.Group, billing.GroupRatio = group, ratio
	snapshot := modelGroupSnapshot{billing: billing, settings: settings}
	return context.WithValue(ctx, modelGroupContextKey{}, snapshot), nil
}

func WithCanvasTaskBillingSnapshot(ctx context.Context, user model.AuthUser, billing ModelBillingSnapshot) (context.Context, error) {
	if current, ok := ctx.Value(modelGroupContextKey{}).(modelGroupSnapshot); ok {
		if billing.Group == "" {
			return ctx, nil
		}
		if billing.GroupRatio <= 0 {
			billing.GroupRatio = current.billing.GroupRatio
		}
		return context.WithValue(ctx, modelGroupContextKey{}, modelGroupSnapshot{billing: billing, settings: current.settings}), nil
	}
	return WithPersistedModelGroupSnapshot(ctx, user, billing)
}

func CopyModelGroupSnapshot(ctx, source context.Context) context.Context {
	if snapshot, ok := source.Value(modelGroupContextKey{}).(modelGroupSnapshot); ok {
		return context.WithValue(ctx, modelGroupContextKey{}, snapshot)
	}
	return ctx
}

func RequestBillingSnapshot(ctx context.Context) ModelBillingSnapshot {
	snapshot, _ := ctx.Value(modelGroupContextKey{}).(modelGroupSnapshot)
	return snapshot.billing
}

func SelectModelChannelInContext(ctx context.Context, modelName, channelID string, publicOnly bool) (model.ModelChannel, error) {
	snapshot, ok := ctx.Value(modelGroupContextKey{}).(modelGroupSnapshot)
	if !ok {
		return model.ModelChannel{}, safeMessageError{message: "缺少调用分组快照"}
	}
	return selectModelChannel(snapshot.settings, modelName, channelID, publicOnly, snapshot.billing.Group)
}

func ResolveModelUsageCostInContext(ctx context.Context, modelName string, resolutions ...string) (ModelUsageCost, error) {
	snapshot, ok := ctx.Value(modelGroupContextKey{}).(modelGroupSnapshot)
	if !ok {
		return ModelUsageCost{}, safeMessageError{message: "缺少调用分组快照"}
	}
	resolution := ""
	if len(resolutions) > 0 {
		resolution = resolutions[0]
	}
	if snapshot.billing.HasUsageCost && snapshot.billing.Model == modelName && snapshot.billing.Resolution == resolution {
		return ModelUsageCost{Credits: snapshot.billing.UsageCredits, Price: snapshot.billing.UsagePrice, UnitPrice: snapshot.billing.UsagePrice, BillingMode: snapshot.billing.BillingMode}, nil
	}
	return resolveModelUsageCostWithRatio(snapshot.settings.Public.ModelChannel, modelName, snapshot.billing.Group, resolution, snapshot.billing.GroupRatio), nil
}

func ChannelFailoverCandidatesInContext(ctx context.Context, selected model.ModelChannel, modelName string) []model.ModelChannel {
	snapshot, ok := ctx.Value(modelGroupContextKey{}).(modelGroupSnapshot)
	if !ok {
		return []model.ModelChannel{selected}
	}
	channels := channelsInGroup(snapshot.settings.Private.Channels, snapshot.billing.Group)
	return channelFailoverCandidates(channels, selected, modelName)
}

func normalizedChannelGroups(groups []string) []string {
	result := []string{}
	for _, group := range groups {
		group = strings.TrimSpace(group)
		if group != "" && !slices.Contains(result, group) {
			result = append(result, group)
		}
	}
	if len(result) == 0 {
		return []string{model.DefaultUserGroup}
	}
	return result
}

func channelsInGroup(channels []model.ModelChannel, group string) []model.ModelChannel {
	result := []model.ModelChannel{}
	for _, channel := range channels {
		if slices.Contains(normalizedChannelGroups(channel.Groups), group) {
			result = append(result, channel)
		}
	}
	return result
}

func configuredGroupRatio(groups []model.ModelGroup, group string) (float64, error) {
	for _, item := range groups {
		if item.ID == group {
			if item.Ratio <= 0 || math.IsNaN(item.Ratio) || math.IsInf(item.Ratio, 0) {
				break
			}
			return item.Ratio, nil
		}
	}
	return 0, safeMessageError{message: "调用分组不存在、已删除或倍率无效，请重新选择分组"}
}

func validatePricingGroups(groups []model.ModelGroup) error {
	seen := map[string]bool{}
	for _, group := range groups {
		id := strings.TrimSpace(group.ID)
		if id == "" || len(id) > 64 || seen[id] || group.Ratio <= 0 || math.IsNaN(group.Ratio) || math.IsInf(group.Ratio, 0) {
			return safeMessageError{message: "价格分组 ID 须非空且唯一，倍率须为有效正数"}
		}
		seen[id] = true
	}
	return nil
}
