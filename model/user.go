package model

import "strings"

type UserRole string

const (
	UserRoleGuest UserRole = "guest"
	UserRoleUser  UserRole = "user"
	UserRoleAdmin UserRole = "admin"
)

// DefaultUserGroup 默认价格分组，对应 pricing.groups 中倍率为 1 的分组。
const DefaultUserGroup = "default"

const DefaultBillingStrategy = "subscription_first"

type UserStatus string

const (
	UserStatusActive UserStatus = "active"
	UserStatusBan    UserStatus = "ban"
)

// User 系统用户。
type User struct {
	ID              string     `json:"id" gorm:"primaryKey"`
	Username        string     `json:"username" gorm:"size:64;uniqueIndex"`
	Password        string     `json:"password,omitempty" gorm:"size:60"`
	Email           string     `json:"email" gorm:"size:254"`
	DisplayName     string     `json:"displayName" gorm:"size:191"`
	AvatarURL       string     `json:"avatarUrl"`
	Role            UserRole   `json:"role" gorm:"size:32"`
	Group           string     `json:"group" gorm:"size:64"`
	BillingStrategy string     `json:"billingStrategy" gorm:"size:32;default:subscription_first"`
	PreferredGroup  string     `json:"preferredGroup" gorm:"size:64"`
	Credits         float64    `json:"credits" gorm:"type:decimal(20,4)"`
	GithubID        string     `json:"githubId" gorm:"size:191"`
	LinuxDoID       string     `json:"linuxDoId" gorm:"index"`
	WechatID        string     `json:"wechatId" gorm:"size:191"`
	Status          UserStatus `json:"status" gorm:"size:32"`
	LastLoginAt     string     `json:"lastLoginAt" gorm:"size:64"`
	Extra           string     `json:"extra" gorm:"type:text"`
	CreatedAt       string     `json:"createdAt" gorm:"size:64"`
	UpdatedAt       string     `json:"updatedAt" gorm:"size:64"`
}

// UserList 用户分页结果。
type UserList struct {
	Items []User `json:"items"`
	Total int    `json:"total"`
}

// AuthUser 用户公开信息。
type AuthUser struct {
	ID             string   `json:"id"`
	Username       string   `json:"username"`
	Email          string   `json:"email"`
	DisplayName    string   `json:"displayName"`
	AvatarURL      string   `json:"avatarUrl"`
	Role           UserRole `json:"role"`
	Group          string   `json:"group"`
	PreferredGroup string   `json:"preferredGroup"`
	Credits        float64  `json:"credits"`
	CreatedAt      string   `json:"createdAt"`
	UpdatedAt      string   `json:"updatedAt"`
}

// AuthSession 登录会话信息。
type AuthSession struct {
	Token string   `json:"token"`
	User  AuthUser `json:"user"`
}

func PublicUser(user User) AuthUser {
	user.PreferredGroup = strings.TrimSpace(user.PreferredGroup)
	if user.PreferredGroup == "" {
		user.PreferredGroup = DefaultUserGroup
	}
	return AuthUser{
		ID:             user.ID,
		Username:       user.Username,
		Email:          user.Email,
		DisplayName:    user.DisplayName,
		AvatarURL:      user.AvatarURL,
		Role:           user.Role,
		Group:          user.Group,
		PreferredGroup: user.PreferredGroup,
		Credits:        user.Credits,
		CreatedAt:      user.CreatedAt,
		UpdatedAt:      user.UpdatedAt,
	}
}

type CreditLogType string

const (
	CreditLogTypeRedeem      CreditLogType = "redeem"
	CreditLogTypeAdminAdjust CreditLogType = "admin_adjust"
	CreditLogTypeAIConsume   CreditLogType = "ai_consume"
	CreditLogTypeAIRefund    CreditLogType = "ai_refund"
)

// CreditLog 用户算力点变更流水。
type CreditLog struct {
	ID        string        `json:"id" gorm:"primaryKey"`
	UserID    string        `json:"userId" gorm:"index"`
	Type      CreditLogType `json:"type" gorm:"size:32"`
	Amount    float64       `json:"amount" gorm:"type:decimal(20,4)"`
	Balance   float64       `json:"balance" gorm:"type:decimal(20,4)"`
	RelatedID string        `json:"relatedId" gorm:"size:191"`
	Remark    string        `json:"remark"`
	Extra     string        `json:"extra" gorm:"type:text"`
	CreatedAt string        `json:"createdAt" gorm:"size:64;index"`

	UserDisplayName string `json:"userDisplayName" gorm:"->;-:migration"`
}

type CreditLogList struct {
	Items []CreditLog `json:"items"`
	Total int         `json:"total"`
}

type UserCreditLogSummary struct {
	TotalSpent     float64 `json:"totalSpent"`
	BilledRequests int64   `json:"billedRequests"`
}

type UserCreditLogPage struct {
	Items   []CreditLog          `json:"items"`
	Total   int64                `json:"total"`
	Summary UserCreditLogSummary `json:"summary"`
}

type DashboardDailySpending struct {
	Date  string  `json:"date"`
	Spent float64 `json:"spent"`
	Calls int64   `json:"calls"`
}

type DashboardModelSpending struct {
	Model string  `json:"model"`
	Spent float64 `json:"spent"`
	Calls int64   `json:"calls"`
}

type DashboardOverview struct {
	Balance          float64                  `json:"balance"`
	TodaySpent       float64                  `json:"todaySpent"`
	TodayCalls       int64                    `json:"todayCalls"`
	TotalSpent       float64                  `json:"totalSpent"`
	TotalCalls       int64                    `json:"totalCalls"`
	DailySpending    []DashboardDailySpending `json:"dailySpending"`
	ModelSpending    []DashboardModelSpending `json:"modelSpending"`
	RecentCreditLogs []CreditLog              `json:"recentCreditLogs"`
}

type UserPreferences struct {
	BillingStrategy string `json:"billingStrategy"`
	PreferredGroup  string `json:"preferredGroup"`
}
