package model

type AICallLog struct {
	ID              string  `json:"id" gorm:"primaryKey"`
	UserID          string  `json:"userId" gorm:"index"`
	UserDisplayName string  `json:"userDisplayName" gorm:"->;-:migration"`
	Endpoint        string  `json:"endpoint" gorm:"index"`
	Method          string  `json:"method" gorm:"size:16"`
	Model           string  `json:"model" gorm:"index"`
	ChannelID       string  `json:"channelId" gorm:"index"`
	ChannelName     string  `json:"channelName" gorm:"size:191"`
	Status          int     `json:"status" gorm:"index"`
	Failed          bool    `json:"failed" gorm:"-"`
	DurationMs      int64   `json:"durationMs"`
	Credits         float64 `json:"credits" gorm:"type:decimal(20,4)"`
	RequestBody     string  `json:"requestBody" gorm:"type:text"`
	ResponseBody    string  `json:"responseBody" gorm:"type:text"`
	Error           string  `json:"error" gorm:"type:text"`
	CreatedAt       string  `json:"createdAt" gorm:"index"`
}

type AICallLogList struct {
	Items []AICallLog `json:"items"`
	Total int         `json:"total"`
}

// AICallLogGroupStat 按模型、用户或渠道聚合的用量统计。
type AICallLogGroupStat struct {
	Key           string  `json:"key"`
	Calls         int64   `json:"calls"`
	Failed        int64   `json:"failed"`
	FailureRate   float64 `json:"failureRate"`
	AvgDurationMs float64 `json:"avgDurationMs"`
	Credits       float64 `json:"credits"`
}

// AICallLogDailyStat 单日调用汇总。
type AICallLogDailyStat struct {
	Date    string  `json:"date"`
	Calls   int64   `json:"calls"`
	Failed  int64   `json:"failed"`
	Credits float64 `json:"credits"`
}

// AICallLogStats 调用日志的用量总览，供管理后台用量看板使用。
type AICallLogStats struct {
	Total         int64                `json:"total"`
	Success       int64                `json:"success"`
	Failed        int64                `json:"failed"`
	FailureRate   float64              `json:"failureRate"`
	AvgDurationMs float64              `json:"avgDurationMs"`
	P95DurationMs int64                `json:"p95DurationMs"`
	Credits       float64              `json:"credits"`
	UserCount     int64                `json:"userCount"`
	ModelCount    int64                `json:"modelCount"`
	ChannelCount  int64                `json:"channelCount"`
	Models        []string             `json:"models"`
	Channels      []string             `json:"channels"`
	Daily         []AICallLogDailyStat `json:"daily"`
	ByModel       []AICallLogGroupStat `json:"byModel"`
	ByUser        []AICallLogGroupStat `json:"byUser"`
	ByChannel     []AICallLogGroupStat `json:"byChannel"`
}

// AICallLogExport 调用日志导出结果，内容为 CSV 文本。
type AICallLogExport struct {
	FileName  string `json:"fileName"`
	Content   string `json:"content"`
	Total     int    `json:"total"`
	Truncated bool   `json:"truncated"`
}
