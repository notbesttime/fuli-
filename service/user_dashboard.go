package service

import (
	"context"
	"encoding/json"
	"sort"
	"strings"
	"time"

	"github.com/tigerowo/infinite-canvas/model"
	"github.com/tigerowo/infinite-canvas/repository"
)

func ListUserCreditLogs(ctx context.Context, q model.Query, earnedOnly bool) (model.UserCreditLogPage, error) {
	user, err := requireDashboardUser(ctx)
	if err != nil {
		return model.UserCreditLogPage{}, err
	}
	if q.Page < 1 {
		q.Page = 1
	}
	if q.PageSize < 1 {
		q.PageSize = 10
	}
	items, total, err := repository.ListUserCreditLogs(user.ID, q, earnedOnly)
	if err != nil {
		return model.UserCreditLogPage{}, err
	}
	if items == nil {
		items = []model.CreditLog{}
	}
	summary, err := repository.UserCreditLogSummary(user.ID)
	return model.UserCreditLogPage{Items: items, Total: total, Summary: summary}, err
}

func DashboardOverview(ctx context.Context) (model.DashboardOverview, error) {
	user, err := requireDashboardUser(ctx)
	if err != nil {
		return model.DashboardOverview{}, err
	}
	account, found, err := repository.GetUserByID(user.ID)
	if err != nil {
		return model.DashboardOverview{}, err
	}
	if !found {
		return model.DashboardOverview{}, safeMessageError{message: "用户不存在"}
	}
	logs, err := repository.ListUserAICreditLogs(user.ID)
	if err != nil {
		return model.DashboardOverview{}, err
	}
	recent, err := repository.ListRecentUserCreditLogs(user.ID, 8)
	if err != nil {
		return model.DashboardOverview{}, err
	}
	if recent == nil {
		recent = []model.CreditLog{}
	}

	now := time.Now()
	today := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location())
	weekStart := today.AddDate(0, 0, -6)
	modelStart := today.AddDate(0, 0, -29)
	todayEnd := today.AddDate(0, 0, 1)
	daily := make([]model.DashboardDailySpending, 7)
	dailyByDate := make(map[string]int, len(daily))
	for i := range daily {
		date := weekStart.AddDate(0, 0, i).Format(time.DateOnly)
		daily[i].Date = date
		dailyByDate[date] = i
	}
	type modelUsage struct {
		spent float64
		calls int64
	}
	byModel := map[string]modelUsage{}
	overview := model.DashboardOverview{
		Balance:          account.Credits,
		DailySpending:    daily,
		ModelSpending:    []model.DashboardModelSpending{},
		RecentCreditLogs: recent,
	}
	for _, log := range logs {
		spent := -log.Amount
		overview.TotalSpent += spent
		overview.TotalCalls++
		created, ok := parseCreditLogTime(log.CreatedAt)
		if !ok {
			continue
		}
		created = created.In(now.Location())
		if !created.Before(today) && created.Before(todayEnd) {
			overview.TodaySpent += spent
			overview.TodayCalls++
		}
		if !created.Before(weekStart) && created.Before(todayEnd) {
			if index, ok := dailyByDate[created.Format(time.DateOnly)]; ok {
				daily[index].Spent += spent
				daily[index].Calls++
			}
		}
		if created.Before(modelStart) || !created.Before(todayEnd) {
			continue
		}
		var extra struct {
			Model string
		}
		if json.Unmarshal([]byte(log.Extra), &extra) != nil || strings.TrimSpace(extra.Model) == "" {
			continue
		}
		name := strings.TrimSpace(extra.Model)
		usage := byModel[name]
		usage.spent += spent
		usage.calls++
		byModel[name] = usage
	}
	for name, usage := range byModel {
		overview.ModelSpending = append(overview.ModelSpending, model.DashboardModelSpending{Model: name, Spent: usage.spent, Calls: usage.calls})
	}
	sort.Slice(overview.ModelSpending, func(i, j int) bool {
		if overview.ModelSpending[i].Spent == overview.ModelSpending[j].Spent {
			return overview.ModelSpending[i].Model < overview.ModelSpending[j].Model
		}
		return overview.ModelSpending[i].Spent > overview.ModelSpending[j].Spent
	})
	return overview, nil
}

func UserPreferences(ctx context.Context) (model.UserPreferences, error) {
	user, err := requireDashboardUser(ctx)
	if err != nil {
		return model.UserPreferences{}, err
	}
	account, found, err := repository.GetUserByID(user.ID)
	if err != nil {
		return model.UserPreferences{}, err
	}
	if !found {
		return model.UserPreferences{}, safeMessageError{message: "用户不存在"}
	}
	preferredGroup := normalizationGroup(account.PreferredGroup)
	settings, err := repository.GetSettings()
	if err != nil {
		return model.UserPreferences{}, err
	}
	if _, err := configuredGroupRatio(normalizePricingSetting(settings.Public.ModelChannel.Pricing).Groups, preferredGroup); err != nil {
		return model.UserPreferences{}, err
	}
	return model.UserPreferences{
		BillingStrategy: normalizedBillingStrategy(account.BillingStrategy),
		PreferredGroup:  preferredGroup,
	}, nil
}

func SaveUserPreferences(ctx context.Context, preferences model.UserPreferences) (model.UserPreferences, error) {
	user, err := requireDashboardUser(ctx)
	if err != nil {
		return model.UserPreferences{}, err
	}
	strategy := strings.TrimSpace(preferences.BillingStrategy)
	if strategy != "" && strategy != "subscription_first" && strategy != "subscription_only" && strategy != "wallet_only" {
		return model.UserPreferences{}, safeMessageError{message: "扣费策略无效"}
	}
	account, found, err := repository.GetUserByID(user.ID)
	if err != nil {
		return model.UserPreferences{}, err
	}
	if !found {
		return model.UserPreferences{}, safeMessageError{message: "用户不存在"}
	}
	preferredGroup := strings.TrimSpace(preferences.PreferredGroup)
	if preferredGroup == "" {
		preferredGroup = normalizationGroup(account.PreferredGroup)
	}
	settings, err := repository.GetSettings()
	if err != nil {
		return model.UserPreferences{}, err
	}
	if _, err := configuredGroupRatio(normalizePricingSetting(settings.Public.ModelChannel.Pricing).Groups, preferredGroup); err != nil {
		return model.UserPreferences{}, err
	}
	if err := repository.UpdateUserPreferences(user.ID, strategy, strings.TrimSpace(preferences.PreferredGroup), now()); err != nil {
		return model.UserPreferences{}, err
	}
	return UserPreferences(ctx)
}

func requireDashboardUser(ctx context.Context) (model.AuthUser, error) {
	user, ok := UserFromContext(ctx)
	if !ok || user.ID == "" || (user.Role != model.UserRoleUser && user.Role != model.UserRoleAdmin) {
		return model.AuthUser{}, safeMessageError{message: "未登录或权限不足"}
	}
	return user, nil
}

func normalizedBillingStrategy(strategy string) string {
	switch strategy {
	case "subscription_first", "subscription_only", "wallet_only":
		return strategy
	default:
		return model.DefaultBillingStrategy
	}
}

func parseCreditLogTime(value string) (time.Time, bool) {
	value = strings.TrimSpace(value)
	for _, layout := range []string{time.RFC3339Nano, time.RFC3339, "2006-01-02 15:04:05", time.DateOnly} {
		var parsed time.Time
		var err error
		if layout == "2006-01-02 15:04:05" || layout == time.DateOnly {
			parsed, err = time.ParseInLocation(layout, value, time.Local)
		} else {
			parsed, err = time.Parse(layout, value)
		}
		if err == nil {
			return parsed, true
		}
	}
	return time.Time{}, false
}
