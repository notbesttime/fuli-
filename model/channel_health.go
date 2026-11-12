package model

import "time"

// 渠道熔断状态。
const (
	ChannelStatusCooling = "cooling"
)

// 渠道失败原因分类。
const (
	ChannelReasonKeyInvalid    = "key_invalid"    // 密钥失效
	ChannelReasonSuspended     = "suspended"      // 账号封禁/无权限
	ChannelReasonQuota         = "quota"          // 额度耗尽
	ChannelReasonRateLimit     = "rate_limit"     // 限流
	ChannelReasonUpstreamError = "upstream_error" // 上游波动
)

// ChannelHealth 渠道熔断记录。没有记录表示渠道正常。
type ChannelHealth struct {
	ID            string    `json:"id" gorm:"primaryKey;size:64"` // 渠道 ID
	Status        string    `json:"status" gorm:"size:16"`        // cooling 表示冷却中
	Reason        string    `json:"reason" gorm:"size:32"`        // 失败原因分类
	UpstreamError string    `json:"upstreamError"`                // 上游原始错误摘要
	Failures      int       `json:"failures"`                     // 上游波动连续失败次数
	CircuitCount  int       `json:"circuitCount"`                 // 累计熔断次数，用于退避递增
	CooldownUntil time.Time `json:"cooldownUntil"`                // 冷却截止时间
	LastFailedAt  time.Time `json:"lastFailedAt"`                 // 最近一次失败时间
	UpdatedAt     time.Time `json:"updatedAt"`
}
