package model

type ModelBillingSnapshot struct {
	Group        string  `json:"group"`
	GroupRatio   float64 `json:"groupRatio"`
	Model        string  `json:"model,omitempty"`
	Resolution   string  `json:"resolution,omitempty"`
	UsageCredits float64 `json:"usageCredits,omitempty"`
	UsagePrice   float64 `json:"usagePrice,omitempty"`
	BillingMode  string  `json:"billingMode,omitempty"`
	HasUsageCost bool    `json:"hasUsageCost,omitempty"`
}
