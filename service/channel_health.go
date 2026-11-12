package service

import (
	"context"
	"log"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/tigerowo/infinite-canvas/model"
	"github.com/tigerowo/infinite-canvas/repository"
)

const (
	channelHealthMaxCooldown   = 24 * time.Hour
	channelHealthFailureWindow = 30 * time.Minute
	channelHealthProbeTimeout  = 15 * time.Second
	channelHealthErrorLimit    = 512
)

var probingChannels sync.Map

// normalizeChannelHealthSetting 补齐渠道熔断配置默认值。
func normalizeChannelHealthSetting(setting model.ChannelHealthSetting) model.ChannelHealthSetting {
	if setting == (model.ChannelHealthSetting{}) {
		setting.RetryTimes = 3 // 从未配置过时默认开启换号重试
	}
	if setting.RetryTimes < 0 {
		setting.RetryTimes = 0
	}
	if setting.DeadCooldownMinutes <= 0 {
		setting.DeadCooldownMinutes = 300
	}
	if setting.RateLimitCooldownSec <= 0 {
		setting.RateLimitCooldownSec = 60
	}
	if setting.UpstreamFailureLimit <= 0 {
		setting.UpstreamFailureLimit = 5
	}
	if setting.UpstreamCooldownMinutes <= 0 {
		setting.UpstreamCooldownMinutes = 5
	}
	return setting
}

// ChannelHealthSetting 返回当前渠道熔断配置。
func ChannelHealthSetting() model.ChannelHealthSetting {
	settings, err := repository.GetSettings()
	if err != nil {
		return normalizeChannelHealthSetting(model.ChannelHealthSetting{})
	}
	return normalizeChannelHealthSetting(settings.Private.ChannelHealth)
}

// ChannelRetryLimit 返回换号重试次数，0 表示不重试。
func ChannelRetryLimit() int {
	return ChannelHealthSetting().RetryTimes
}

// ClassifyChannelFailure 根据状态码和上游错误正文判断失败原因，空字符串表示不建议熔断。
func ClassifyChannelFailure(status int, body string) string {
	text := strings.ToLower(body)
	hasQuota := containsAnyText(text, "insufficient_quota", "quota exceeded", "exceeded your current quota", "余额不足", "额度不足", "额度已用完", "欠费", "billing")
	switch {
	case status == http.StatusUnauthorized:
		return model.ChannelReasonKeyInvalid
	case status == http.StatusForbidden:
		return model.ChannelReasonSuspended
	case status == http.StatusPaymentRequired:
		return model.ChannelReasonQuota
	case status == http.StatusTooManyRequests && hasQuota:
		return model.ChannelReasonQuota
	case status == http.StatusTooManyRequests:
		return model.ChannelReasonRateLimit
	case status >= http.StatusInternalServerError || status == 0:
		return model.ChannelReasonUpstreamError
	}
	return ""
}

func containsAnyText(text string, words ...string) bool {
	for _, word := range words {
		if strings.Contains(text, word) {
			return true
		}
	}
	return false
}

// channelReasonCooldown 返回某类失败的基础冷却时长。
func channelReasonCooldown(reason string, setting model.ChannelHealthSetting) time.Duration {
	switch reason {
	case model.ChannelReasonRateLimit:
		return time.Duration(setting.RateLimitCooldownSec) * time.Second
	case model.ChannelReasonUpstreamError:
		return time.Duration(setting.UpstreamCooldownMinutes) * time.Minute
	case "":
		return 0
	default:
		return time.Duration(setting.DeadCooldownMinutes) * time.Minute
	}
}

// escalatedCooldown 按累计熔断次数退避递增，最多 24 小时。
func escalatedCooldown(base time.Duration, circuitCount int) time.Duration {
	if base <= 0 {
		return 0
	}
	if circuitCount <= 1 {
		return base
	}
	cooldown := base * time.Duration(1<<min(circuitCount-1, 5))
	if cooldown > channelHealthMaxCooldown || cooldown <= 0 {
		cooldown = channelHealthMaxCooldown
	}
	return cooldown
}

// IsChannelCooling 判断渠道是否处于冷却中。
func IsChannelCooling(item model.ChannelHealth) bool {
	return item.Status == model.ChannelStatusCooling && time.Now().Before(item.CooldownUntil)
}

// ChannelHealthMap 返回渠道 ID 到熔断记录的映射。
func ChannelHealthMap() map[string]model.ChannelHealth {
	items, err := repository.ListChannelHealth()
	if err != nil {
		return map[string]model.ChannelHealth{}
	}
	result := make(map[string]model.ChannelHealth, len(items))
	for _, item := range items {
		result[item.ID] = item
	}
	return result
}

// ReportChannelFailure 记录一次渠道失败，必要时熔断。
func ReportChannelFailure(channelID string, status int, upstreamError string) {
	channelID = strings.TrimSpace(channelID)
	if channelID == "" {
		return
	}
	setting := ChannelHealthSetting()
	reason := ClassifyChannelFailure(status, upstreamError)
	if reason == "" {
		return
	}
	item, _, err := repository.GetChannelHealth(channelID)
	if err != nil {
		log.Printf("read channel health failed: channel=%s err=%v", channelID, err)
		return
	}
	now := time.Now()
	item.ID = channelID
	item.Reason = reason
	item.UpstreamError = truncateRunes(upstreamError, channelHealthErrorLimit)
	if reason == model.ChannelReasonUpstreamError {
		if !item.LastFailedAt.IsZero() && now.Sub(item.LastFailedAt) > channelHealthFailureWindow {
			item.Failures = 0
		}
		item.Failures++
		item.LastFailedAt = now
		if item.Failures < setting.UpstreamFailureLimit {
			item.UpdatedAt = now
			if err := repository.SaveChannelHealth(item); err != nil {
				log.Printf("save channel health failed: channel=%s err=%v", channelID, err)
			}
			return
		}
		item.Failures = 0
	}
	item.LastFailedAt = now
	item.CircuitCount++
	item.Status = model.ChannelStatusCooling
	item.CooldownUntil = now.Add(escalatedCooldown(channelReasonCooldown(reason, setting), item.CircuitCount))
	item.UpdatedAt = now
	if err := repository.SaveChannelHealth(item); err != nil {
		log.Printf("save channel health failed: channel=%s err=%v", channelID, err)
	}
}

// ReportChannelSuccess 清除渠道熔断与失败计数。
func ReportChannelSuccess(channelID string) {
	channelID = strings.TrimSpace(channelID)
	if channelID == "" {
		return
	}
	if _, found, err := repository.GetChannelHealth(channelID); err != nil || !found {
		return
	}
	if err := repository.DeleteChannelHealth(channelID); err != nil {
		log.Printf("reset channel health failed: channel=%s err=%v", channelID, err)
	}
}

// ChannelHealthList 返回全部熔断记录（管理后台使用）。
func ChannelHealthList() ([]model.ChannelHealth, error) {
	return repository.ListChannelHealth()
}

// RestoreChannelHealth 管理员手动放回号池。
func RestoreChannelHealth(channelID string) error {
	return repository.DeleteChannelHealth(strings.TrimSpace(channelID))
}

// ProbeExpiredChannel 对冷却到期渠道异步探活：401/403 重新熔断，其余视为恢复。
func ProbeExpiredChannel(channel model.ModelChannel) {
	if strings.TrimSpace(channel.ID) == "" || strings.TrimSpace(channel.APIKey) == "" || strings.TrimSpace(channel.BaseURL) == "" {
		return
	}
	if _, busy := probingChannels.LoadOrStore(channel.ID, struct{}{}); busy {
		return
	}
	go func() {
		defer probingChannels.Delete(channel.ID)
		ctx, cancel := context.WithTimeout(context.Background(), channelHealthProbeTimeout)
		defer cancel()
		request, err := http.NewRequestWithContext(ctx, http.MethodGet, BuildModelChannelURL(channel, "/models"), nil)
		if err != nil {
			return
		}
		SetModelChannelAuthHeader(request, channel)
		response, err := (&http.Client{Timeout: channelHealthProbeTimeout}).Do(request)
		if err != nil {
			return
		}
		defer response.Body.Close()
		if response.StatusCode == http.StatusUnauthorized || response.StatusCode == http.StatusForbidden {
			if item, found, _ := repository.GetChannelHealth(channel.ID); found && item.Status == model.ChannelStatusCooling {
				ReportChannelFailure(channel.ID, response.StatusCode, "")
			}
			return
		}
		ReportChannelSuccess(channel.ID)
	}()
}

func truncateRunes(text string, limit int) string {
	text = strings.TrimSpace(text)
	runes := []rune(text)
	if len(runes) <= limit {
		return text
	}
	return string(runes[:limit])
}
