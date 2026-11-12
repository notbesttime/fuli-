package model

import "encoding/json"

type SettingKey string

const (
	SettingKeyPublic                 SettingKey = "public"
	SettingKeyPrivate                SettingKey = "private"
	SettingKeyAgentSkillsInitialized SettingKey = "agent-skills-initialized"

	StorageProviderTypeS3     = "s3"
	StorageProviderTypeWebDAV = "webdav"
)

// ModelChannel 模型渠道配置。
type ModelChannel struct {
	ID           string          `json:"id"`
	Protocol     string          `json:"protocol"`
	Name         string          `json:"name"`
	BaseURL      string          `json:"baseUrl"`
	APIKey       string          `json:"apiKey"`
	Models       []string        `json:"models"`
	Groups       []string        `json:"groups,omitempty"`
	Weight       int             `json:"weight"`
	Timeout      int             `json:"timeout"`
	Enabled      bool            `json:"enabled"`
	Remark       string          `json:"remark"`
	UploadAPIKey string          `json:"uploadApiKey,omitempty"`
	BridgeID     string          `json:"bridgeId,omitempty"`
	ComfyURL     string          `json:"comfyUrl,omitempty"`
	WorkflowDir  string          `json:"workflowDir,omitempty"`
	Workflows    []WorkflowEntry `json:"workflows,omitempty"`

	ModelCapabilities    map[string]string `json:"modelCapabilities,omitempty"`
	ParameterTranslation string            `json:"parameterTranslation,omitempty"`
}

type WorkflowFieldMapping struct {
	ID                 string `json:"id,omitempty"`
	NodeID             string `json:"nodeId"`
	ClassType          string `json:"classType,omitempty"`
	FieldName          string `json:"fieldName"`
	FieldType          string `json:"fieldType,omitempty"`
	Label              string `json:"label,omitempty"`
	Role               string `json:"role,omitempty"`
	SafeToOverride     *bool  `json:"safeToOverride,omitempty"`
	OptionsSource      string `json:"optionsSource,omitempty"`
	Source             string `json:"source,omitempty"`
	SourceIndex        int    `json:"sourceIndex,omitempty"`
	ImageOrder         int    `json:"imageOrder,omitempty"`
	FieldValue         any    `json:"fieldValue,omitempty"`
	Value              any    `json:"value,omitempty"`
	Default            any    `json:"default,omitempty"`
	DefaultValue       any    `json:"defaultValue,omitempty"`
	Enabled            *bool  `json:"enabled,omitempty"`
	Required           bool   `json:"required,omitempty"`
	RandomEnabled      bool   `json:"randomEnabled,omitempty"`
	BindPrompt         bool   `json:"bindPrompt,omitempty"`
	SourceFromUpstream bool   `json:"sourceFromUpstream,omitempty"`
	SourceAutomatic    *bool  `json:"sourceAutomatic,omitempty"`
	Options            []any  `json:"options,omitempty"`
	Min                any    `json:"min,omitempty"`
	Max                any    `json:"max,omitempty"`
	Step               any    `json:"step,omitempty"`
}

type WorkflowEntry struct {
	Provider      string                 `json:"provider"`
	Kind          string                 `json:"kind"`
	WorkflowID    string                 `json:"workflowId"`
	Title         string                 `json:"title"`
	Capability    string                 `json:"capability"`
	Enabled       bool                   `json:"enabled"`
	Fields        []WorkflowFieldMapping `json:"fields"`
	WorkflowJSON  map[string]any         `json:"workflowJson,omitempty"`
	WorkflowGraph map[string]any         `json:"workflowGraph,omitempty"`
}

type WorkflowSummary struct {
	Provider   string `json:"provider"`
	Kind       string `json:"kind"`
	WorkflowID string `json:"workflowId"`
	Title      string `json:"title"`
	Capability string `json:"capability"`
	Enabled    bool   `json:"enabled"`
}

// 模型计费方式。
const (
	BillingModeImage   = "image"   // 按张
	BillingModeSecond  = "second"  // 按秒
	BillingModeRequest = "request" // 按次
)

// ModelCost 模型计费配置。Price 的单位由 BillingMode 决定，均为人民币参考价。
type ModelCost struct {
	Model       string   `json:"model"`
	Resolution  string   `json:"resolution,omitempty"`
	BillingMode string   `json:"billingMode,omitempty"`
	Price       float64  `json:"price,omitempty"`
	Credits     float64  `json:"credits"`
	Vendor      string   `json:"vendor,omitempty"`
	Tags        []string `json:"tags,omitempty"`
}

// ModelGroup 模型分组，ratio 为该分组的价格倍率。
type ModelGroup struct {
	ID    string  `json:"id"`
	Name  string  `json:"name"`
	Ratio float64 `json:"ratio"`
	Desc  string  `json:"desc,omitempty"`
}

// PricingSetting 计费与分组配置。
type PricingSetting struct {
	Currency   string       `json:"currency"`
	CreditRate float64      `json:"creditRate"` // 每算力点对应的人民币金额（元/点）。
	Groups     []ModelGroup `json:"groups"`
}

// PublicModelChannelSetting 公开模型渠道配置。
type PublicModelChannelSetting struct {
	AvailableModels        []string                 `json:"availableModels"`
	AvailableWorkflows     []string                 `json:"availableWorkflows"`
	ModelCosts             []ModelCost              `json:"modelCosts"`
	Pricing                PricingSetting           `json:"pricing"`
	Channels               []PublicModelChannelInfo `json:"channels"`
	DefaultModel           string                   `json:"defaultModel"`
	DefaultImageModel      string                   `json:"defaultImageModel"`
	DefaultVideoModel      string                   `json:"defaultVideoModel"`
	DefaultTextModel       string                   `json:"defaultTextModel"`
	SystemPrompt           string                   `json:"systemPrompt"`
	SystemPrompts          SystemPromptSetting      `json:"systemPrompts"`
	AllowCustomChannel     *bool                    `json:"allowCustomChannel"`
	AllowUserRemoteChannel *bool                    `json:"allowUserRemoteChannel"`
}

type SystemPromptSetting struct {
	Image         string `json:"image"`
	Video         string `json:"video"`
	Text          string `json:"text"`
	Workflow      string `json:"workflow"`
	WorkflowAgent string `json:"workflowAgent"`
}

type PublicModelChannelInfo struct {
	ParameterTranslationModels []string          `json:"parameterTranslationModels,omitempty"`
	ID                         string            `json:"id"`
	Protocol                   string            `json:"protocol"`
	Name                       string            `json:"name"`
	BaseURL                    string            `json:"baseUrl"`
	Models                     []string          `json:"models"`
	Groups                     []string          `json:"groups,omitempty"`
	Weight                     int               `json:"weight"`
	Timeout                    int               `json:"timeout"`
	Enabled                    bool              `json:"enabled"`
	Remark                     string            `json:"remark"`
	Workflows                  []WorkflowSummary `json:"workflows,omitempty"`

	ModelCapabilities map[string]string `json:"modelCapabilities,omitempty"`
}

// PublicSetting 公开配置。
type Announcement struct {
	ID          string `json:"id"`
	Title       string `json:"title"`
	Content     string `json:"content"`
	Type        string `json:"type"`
	PublishDate string `json:"publishDate"`
	Enabled     bool   `json:"enabled"`
	Pinned      bool   `json:"pinned"`
}

type PublicSetting struct {
	Announcements []Announcement            `json:"announcements"`
	Recharge      RechargeSetting           `json:"recharge"`
	ModelChannel  PublicModelChannelSetting `json:"modelChannel"`
	Auth          PublicAuthSetting         `json:"auth"`
	Storage       PublicStorageSetting      `json:"storage"`
}

// RechargeSetting 外部购码入口；不表示外部订单或支付状态已同步。
type RechargeSetting struct {
	Enabled     *bool          `json:"enabled"`
	StoreURL    string         `json:"storeUrl"`
	Notice      string         `json:"notice"`
	Contact     string         `json:"contact"`
	LargeAmount float64        `json:"largeAmount"`
	Tiers       []RechargeTier `json:"tiers"`
}

type RechargeTier struct {
	Amount float64 `json:"amount"`
	URL    string  `json:"url"`
}

type PublicStorageSetting struct {
	Mode                    string `json:"mode"`
	AllowUserProvider       bool   `json:"allowUserProvider"`
	AllowUserGlobalProvider bool   `json:"allowUserGlobalProvider"`
}

type PublicStorageConfig struct {
	PublicStorageSetting
	AutoSyncAllAssets bool `json:"autoSyncAllAssets"`
}

type PublicAuthSetting struct {
	AllowRegister     *bool                    `json:"allowRegister"`
	EmailVerification bool                     `json:"emailVerification"`
	LinuxDo           PublicLinuxDoAuthSetting `json:"linuxDo"`
}

type PublicLinuxDoAuthSetting struct {
	Enabled bool `json:"enabled"`
}

// PrivateSetting 私有配置。
type PrivateSetting struct {
	Channels      []ModelChannel        `json:"channels"`
	PromptSync    PromptSyncSetting     `json:"promptSync"`
	AILog         AILogSetting          `json:"aiLog"`
	Auth          PrivateAuthSetting    `json:"auth"`
	Storage       PrivateStorageSetting `json:"storage"`
	ChannelHealth ChannelHealthSetting  `json:"channelHealth"`
}

// ChannelHealthSetting 渠道换号重试与熔断配置。
type ChannelHealthSetting struct {
	RetryTimes              int  `json:"retryTimes"`              // 换号重试次数，0 表示关闭
	DeadCooldownMinutes     int  `json:"deadCooldownMinutes"`     // 密钥失效/封禁/额度耗尽冷却分钟数
	RateLimitCooldownSec    int  `json:"rateLimitCooldownSec"`    // 限流冷却秒数
	UpstreamFailureLimit    int  `json:"upstreamFailureLimit"`    // 上游波动连续失败熔断阈值
	UpstreamCooldownMinutes int  `json:"upstreamCooldownMinutes"` // 上游波动冷却分钟数
	TimeoutRetry            bool `json:"timeoutRetry"`            // 网络错误/5xx 是否换号重试
}

type AILogSetting struct {
	LocalDirectReportEnabled *bool               `json:"localDirectReportEnabled"`
	Cleanup                  AILogCleanupSetting `json:"cleanup"`
}

type AILogCleanupSetting struct {
	Enabled       *bool  `json:"enabled"`
	RetentionDays int    `json:"retentionDays"`
	Cron          string `json:"cron"`
}

type PrivateStorageSetting struct {
	Mode                    string                      `json:"mode"`
	AllowUserProvider       bool                        `json:"allowUserProvider"`
	AllowUserGlobalProvider bool                        `json:"allowUserGlobalProvider"`
	AutoSyncAllAssets       bool                        `json:"autoSyncAllAssets"`
	Providers               []StorageProvider           `json:"providers"`
	RoundRobinCursor        int                         `json:"roundRobinCursor"`
	CapacityCheck           StorageCapacityCheckSetting `json:"capacityCheck"`
	CapacityLimitBytes      int64                       `json:"capacityLimitBytes"`
}

type StorageProvider struct {
	ID                  string `json:"id"`
	Name                string `json:"name"`
	Type                string `json:"type"`
	Endpoint            string `json:"endpoint"`
	AllowPrivateNetwork bool   `json:"allowPrivateNetwork,omitempty"`
	Region              string `json:"region"`
	Bucket              string `json:"bucket"`
	BucketInHost        bool   `json:"bucketInHost,omitempty"`
	AccessKeyID         string `json:"accessKeyId"`
	SecretAccessKey     string `json:"secretAccessKey"`
	PublicBaseURL       string `json:"publicBaseUrl"`
	PathPrefix          string `json:"pathPrefix"`
	Username            string `json:"username"`
	Password            string `json:"password"`
	Weight              int    `json:"weight"`
	Enabled             bool   `json:"enabled"`
	OwnerUserID         string `json:"ownerUserId"`
	CapacityBytes       int64  `json:"capacityBytes"`
	CapacityCheckedAt   string `json:"capacityCheckedAt"`
	CapacityExceeded    bool   `json:"capacityExceeded"`
}

type StorageCapacityCheckSetting struct {
	Enabled *bool  `json:"enabled"`
	Cron    string `json:"cron"`
}

// PromptSyncSetting 提示词定时同步配置。
type PromptSyncSetting struct {
	Enabled *bool  `json:"enabled"`
	Cron    string `json:"cron"`
}

type PrivateAuthSetting struct {
	LinuxDo PrivateLinuxDoAuthSetting `json:"linuxDo"`
}

type PrivateLinuxDoAuthSetting struct {
	ClientID     string `json:"clientId"`
	ClientSecret string `json:"clientSecret"`
}

// Setting 系统配置。
type Setting struct {
	Key       SettingKey      `json:"key" gorm:"primaryKey"`
	Value     json.RawMessage `json:"value" gorm:"serializer:json"`
	CreatedAt string          `json:"createdAt" gorm:"size:64"`
	UpdatedAt string          `json:"updatedAt" gorm:"size:64"`
}

// Settings 系统公开和私有配置。
type Settings struct {
	Public  PublicSetting  `json:"public"`
	Private PrivateSetting `json:"private"`
}
