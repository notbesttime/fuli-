package model

type RedeemCodeStatus string

const (
	RedeemCodeUnused  RedeemCodeStatus = "unused"
	RedeemCodeUsed    RedeemCodeStatus = "used"
	RedeemCodeVoid    RedeemCodeStatus = "void"
	RedeemCodeExpired RedeemCodeStatus = "expired"
)

// RedeemCode 金额和算力点在生成时锁定，不跟随之后的汇率变化。
type RedeemCode struct {
	ID              string           `json:"id" gorm:"primaryKey"`
	Code            string           `json:"code" gorm:"size:64;uniqueIndex"`
	Amount          float64          `json:"amount" gorm:"type:decimal(20,2)"`
	Credits         float64          `json:"credits" gorm:"type:decimal(20,4)"`
	Status          RedeemCodeStatus `json:"status" gorm:"size:16;index"`
	Batch           string           `json:"batch" gorm:"size:64;index"`
	UsedBy          string           `json:"usedBy" gorm:"size:64;index"`
	UsedAt          string           `json:"usedAt" gorm:"size:64"`
	ExpiresAt       string           `json:"expiresAt" gorm:"size:64;index"`
	Remark          string           `json:"remark" gorm:"size:1000"`
	CreatedAt       string           `json:"createdAt" gorm:"size:64;index"`
	UserDisplayName string           `json:"userDisplayName" gorm:"->;-:migration"`
}

type RedeemCodeList struct {
	Items []RedeemCode `json:"items"`
	Total int          `json:"total"`
}

// RedeemRecord 仅包含当前用户可见的兑换结果，不暴露管理备注或其他用户。
type RedeemRecord struct {
	ID        string  `json:"id"`
	Code      string  `json:"code"`
	Amount    float64 `json:"amount"`
	Credits   float64 `json:"credits"`
	UsedAt    string  `json:"usedAt"`
	CreatedAt string  `json:"createdAt"`
}

type RedeemRecordList struct {
	Items []RedeemRecord `json:"items"`
	Total int            `json:"total"`
}
