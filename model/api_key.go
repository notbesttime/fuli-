package model

type APIKey struct {
	ID         string `json:"-" gorm:"primaryKey;size:64"`
	UserID     string `json:"-" gorm:"size:64;index:idx_api_keys_user_created,priority:1"`
	Name       string `json:"-" gorm:"size:191"`
	KeyHash    string `json:"-" gorm:"size:64;uniqueIndex"`
	Prefix     string `json:"-" gorm:"size:32"`
	Group      string `json:"-" gorm:"column:calling_group;size:64"`
	Active     bool   `json:"-" gorm:"not null;default:true"`
	CreatedAt  string `json:"-" gorm:"size:64;index:idx_api_keys_user_created,priority:2"`
	LastUsedAt string `json:"-" gorm:"size:64"`
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
