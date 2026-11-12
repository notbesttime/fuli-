package model

// EmailCode 邮箱验证码，只保存 SHA-256 哈希；时间字段为 Unix 秒。
type EmailCode struct {
	ID         string `json:"id" gorm:"primaryKey"`
	Email      string `json:"email" gorm:"size:254;index"`
	Purpose    string `json:"purpose" gorm:"size:16"`
	CodeHash   string `json:"-" gorm:"size:64"`
	ExpiresAt  int64  `json:"expiresAt"`
	Attempts   int    `json:"attempts"`
	ConsumedAt int64  `json:"consumedAt"`
	CreatedAt  int64  `json:"createdAt" gorm:"index"`
}
