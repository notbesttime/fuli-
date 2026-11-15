package service

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/tigerowo/infinite-canvas/model"
	"github.com/tigerowo/infinite-canvas/repository"
)

var ErrInvalidAPIKey = errors.New("invalid api key")

func ListAPIKeys(userID string) ([]model.APIKeySummary, error) {
	keys, err := repository.ListUserAPIKeys(userID)
	if err != nil {
		return nil, err
	}
	items := make([]model.APIKeySummary, 0, len(keys))
	for _, key := range keys {
		items = append(items, key.Summary())
	}
	return items, nil
}

func CreateAPIKey(userID, name, group string) (model.APIKeyCreated, error) {
	name, group = strings.TrimSpace(name), strings.TrimSpace(group)
	if name == "" || utf8.RuneCountInString(name) > 191 {
		return model.APIKeyCreated{}, safeMessageError{message: "密钥名称不能为空且不能超过 191 个字符"}
	}
	if group == "" {
		return model.APIKeyCreated{}, safeMessageError{message: "请选择调用分组"}
	}
	settings, err := repository.GetSettings()
	if err != nil {
		return model.APIKeyCreated{}, err
	}
	settings = normalizeSettings(settings)
	if _, err := configuredGroupRatio(settings.Public.ModelChannel.Pricing.Groups, group); err != nil {
		return model.APIKeyCreated{}, err
	}
	secret, err := generateAPIKeySecret()
	if err != nil {
		return model.APIKeyCreated{}, err
	}
	createdAt := now()
	key := model.APIKey{ID: newID("apikey"), UserID: userID, Name: name, KeyHash: hashAPIKeySecret(secret), Prefix: secret[:12], Group: group, Active: true, CreatedAt: createdAt}
	if err := repository.CreateAPIKey(key); err != nil {
		return model.APIKeyCreated{}, err
	}
	return model.APIKeyCreated{ID: key.ID, Name: key.Name, Secret: secret, Group: key.Group, CreatedAt: key.CreatedAt}, nil
}

func RevokeAPIKey(id, userID string) error {
	id = strings.TrimSpace(id)
	if id == "" {
		return safeMessageError{message: "密钥不存在"}
	}
	ok, err := repository.RevokeUserAPIKey(id, userID)
	if err != nil {
		return err
	}
	if !ok {
		return safeMessageError{message: "密钥不存在"}
	}
	return nil
}

func AuthenticateAPIKey(secret string) (model.AuthUser, error) {
	if !strings.HasPrefix(secret, "sk-fuli-") {
		return model.AuthUser{}, ErrInvalidAPIKey
	}
	key, ok, err := repository.GetActiveAPIKeyByHash(hashAPIKeySecret(secret))
	if err != nil {
		return model.AuthUser{}, err
	}
	if !ok {
		return model.AuthUser{}, ErrInvalidAPIKey
	}
	if apiKeyExpired(key.ExpiresAt) {
		return model.AuthUser{}, ErrInvalidAPIKey
	}
	user, ok, err := repository.GetUserByID(key.UserID)
	if err != nil {
		return model.AuthUser{}, err
	}
	if !ok || user.Status != model.UserStatusActive || user.Role == model.UserRoleGuest {
		return model.AuthUser{}, ErrInvalidAPIKey
	}
	if err := repository.TouchAPIKey(key.ID, now()); err != nil {
		return model.AuthUser{}, err
	}
	authUser := model.PublicUser(user)
	authUser.PreferredGroup = key.Group
	return authUser, nil
}

// AdminAPIKeyInput 后台可编辑的 API Key 字段。
type AdminAPIKeyInput struct {
	Name      string `json:"name"`
	Group     string `json:"group"`
	ExpiresAt string `json:"expiresAt"`
	Active    *bool  `json:"active"`
}

// ListAdminAPIKeys 后台全站 API Key 列表，附带过期标记。
func ListAdminAPIKeys(q model.Query) (model.AdminAPIKeyList, error) {
	items, total, err := repository.ListAdminAPIKeys(q)
	if err != nil {
		return model.AdminAPIKeyList{}, err
	}
	for i := range items {
		items[i].Expired = apiKeyExpired(items[i].ExpiresAt)
	}
	return model.AdminAPIKeyList{Items: items, Total: total}, nil
}

// SaveAdminAPIKey 后台编辑 API Key 的名称、调用组、过期时间与启用状态。
func SaveAdminAPIKey(id string, input AdminAPIKeyInput) (model.AdminAPIKey, error) {
	id = strings.TrimSpace(id)
	if _, ok, err := repository.GetAPIKeyByID(id); err != nil {
		return model.AdminAPIKey{}, err
	} else if !ok {
		return model.AdminAPIKey{}, safeMessageError{message: "密钥不存在"}
	}
	updates := map[string]any{}
	if name := strings.TrimSpace(input.Name); name != "" {
		if utf8.RuneCountInString(name) > 191 {
			return model.AdminAPIKey{}, safeMessageError{message: "密钥名称不能超过 191 个字符"}
		}
		updates["name"] = name
	}
	if group := strings.TrimSpace(input.Group); group != "" {
		settings, err := repository.GetSettings()
		if err != nil {
			return model.AdminAPIKey{}, err
		}
		settings = normalizeSettings(settings)
		if _, err := configuredGroupRatio(settings.Public.ModelChannel.Pricing.Groups, group); err != nil {
			return model.AdminAPIKey{}, err
		}
		updates["calling_group"] = group
	}
	expiresAt := strings.TrimSpace(input.ExpiresAt)
	if expiresAt != "" {
		if _, err := time.Parse(time.RFC3339, expiresAt); err != nil {
			return model.AdminAPIKey{}, safeMessageError{message: "到期时间格式无效"}
		}
	}
	updates["expires_at"] = expiresAt
	if input.Active != nil {
		updates["active"] = *input.Active
	}
	if len(updates) > 0 {
		if err := repository.UpdateAdminAPIKey(id, updates); err != nil {
			return model.AdminAPIKey{}, err
		}
	}
	return adminAPIKeyByID(id)
}

// SetAdminAPIKeyActive 后台启用或禁用 API Key。
func SetAdminAPIKeyActive(id string, active bool) (model.AdminAPIKey, error) {
	id = strings.TrimSpace(id)
	if _, ok, err := repository.GetAPIKeyByID(id); err != nil {
		return model.AdminAPIKey{}, err
	} else if !ok {
		return model.AdminAPIKey{}, safeMessageError{message: "密钥不存在"}
	}
	if err := repository.UpdateAdminAPIKey(id, map[string]any{"active": active}); err != nil {
		return model.AdminAPIKey{}, err
	}
	return adminAPIKeyByID(id)
}

// DeleteAdminAPIKey 后台删除 API Key。
func DeleteAdminAPIKey(id string) error {
	return repository.DeleteAPIKey(strings.TrimSpace(id))
}

func adminAPIKeyByID(id string) (model.AdminAPIKey, error) {
	item, ok, err := repository.GetAdminAPIKey(id)
	if err != nil {
		return model.AdminAPIKey{}, err
	}
	if !ok {
		return model.AdminAPIKey{}, safeMessageError{message: "密钥不存在"}
	}
	item.Expired = apiKeyExpired(item.ExpiresAt)
	return item, nil
}

func apiKeyExpired(expiresAt string) bool {
	expiresAt = strings.TrimSpace(expiresAt)
	if expiresAt == "" {
		return false
	}
	expireTime, err := time.Parse(time.RFC3339, expiresAt)
	if err != nil {
		return false
	}
	return time.Now().After(expireTime)
}

func generateAPIKeySecret() (string, error) {
	entropy := make([]byte, 32)
	if _, err := rand.Read(entropy); err != nil {
		return "", err
	}
	return "sk-fuli-" + base64.RawURLEncoding.EncodeToString(entropy), nil
}
func hashAPIKeySecret(secret string) string {
	hash := sha256.Sum256([]byte(secret))
	return hex.EncodeToString(hash[:])
}
