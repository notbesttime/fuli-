package model

type APIKey struct {
	ID         string `json:"-" gorm:"primaryKey;size:64"`
	UserID     string `json:"-" gorm:"size:64;index:idx_api_keys_user_created,priority:1"`
	Name       string `json:"-" gorm:"size:191"`
	KeyHash    string `json:"-" gorm:"size:64;uniqueIndex"`
	Prefix     string `json:"-" gorm:"size:32"`
	Group      string `json:"-" gorm:"column:calling_group;size:64"`
	Active     bool   `json:"-" gorm:"not null;default:true"`
	ExpiresAt  string `json:"-" gorm:"size:64"`
	CreatedAt  string `json:"-" gorm:"size:64;index:idx_api_keys_user_created,priority:2"`
	LastUsedAt string `json:"-" gorm:"size:64"`
}

// AdminAPIKey 后台视角的 API Key 摘要，永不包含密钥哈希或明文。
type AdminAPIKey struct {
	ID              string `json:"id" gorm:"column:id"`
	UserID          string `json:"userId" gorm:"column:user_id"`
	Username        string `json:"username" gorm:"column:username"`
	UserDisplayName string `json:"userDisplayName" gorm:"column:user_display_name"`
	Name            string `json:"name" gorm:"column:name"`
	Prefix          string `json:"prefix" gorm:"column:prefix"`
	Group           string `json:"group" gorm:"column:calling_group"`
	Active          bool   `json:"active" gorm:"column:active"`
	ExpiresAt       string `json:"expiresAt" gorm:"column:expires_at"`
	CreatedAt       string `json:"createdAt" gorm:"column:created_at"`
	LastUsedAt      string `json:"lastUsedAt" gorm:"column:last_used_at"`
	Expired         bool   `json:"expired" gorm:"-"`
}

type AdminAPIKeyList struct {
	Items []AdminAPIKey `json:"items"`
	Total int64         `json:"total"`
}

type APIKeySummary struct {
	ID         string `json:"id"`
	Name       string `json:"name"`
	Prefix     string `json:"prefix"`
	Group      string `json:"group"`
	Active     bool   `json:"active"`
	CreatedAt  string `json:"createdAt"`
	LastUsedAt string `json:"lastUsedAt,omitempty"`
}

type APIKeyCreated struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	Secret    string `json:"secret"`
	Group     string `json:"group"`
	CreatedAt string `json:"createdAt"`
}

func (key APIKey) Summary() APIKeySummary {
	return APIKeySummary{ID: key.ID, Name: key.Name, Prefix: key.Prefix, Group: key.Group, Active: key.Active, CreatedAt: key.CreatedAt, LastUsedAt: key.LastUsedAt}
}
