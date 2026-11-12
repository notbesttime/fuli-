package service

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"strings"
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
