package repository

import (
	"errors"
	"strings"

	"github.com/tigerowo/infinite-canvas/model"
	"gorm.io/gorm"
)

func CreateAPIKey(key model.APIKey) error {
	db, err := DB()
	if err != nil {
		return err
	}
	return db.Create(&key).Error
}
func ListUserAPIKeys(userID string) ([]model.APIKey, error) {
	db, err := DB()
	if err != nil {
		return nil, err
	}
	var keys []model.APIKey
	err = db.Where("user_id = ?", userID).Order("created_at desc").Find(&keys).Error
	return keys, err
}
func GetActiveAPIKeyByHash(hash string) (model.APIKey, bool, error) {
	db, err := DB()
	if err != nil {
		return model.APIKey{}, false, err
	}
	var key model.APIKey
	err = db.Where("key_hash = ? AND active = ?", hash, true).First(&key).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return model.APIKey{}, false, nil
	}
	return key, err == nil, err
}
func TouchAPIKey(id, usedAt string) error {
	db, err := DB()
	if err != nil {
		return err
	}
	return db.Model(&model.APIKey{}).Where("id = ? AND active = ?", id, true).Update("last_used_at", usedAt).Error
}
func RevokeUserAPIKey(id, userID string) (bool, error) {
	db, err := DB()
	if err != nil {
		return false, err
	}
	var key model.APIKey
	if err := db.Select("id", "active").Where("id = ? AND user_id = ?", id, userID).First(&key).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return false, nil
		}
		return false, err
	}
	return true, db.Model(&key).Update("active", false).Error
}

// ListAdminAPIKeys 后台分页查询全站 API Key，联表带出用户名，不返回密钥哈希。
func ListAdminAPIKeys(q model.Query) ([]model.AdminAPIKey, int64, error) {
	db, err := DB()
	if err != nil {
		return nil, 0, err
	}
	q.Normalize()
	tx := db.Table("api_keys").Joins("LEFT JOIN users ON users.id = api_keys.user_id")
	if keyword := strings.TrimSpace(q.Keyword); keyword != "" {
		like := "%" + keyword + "%"
		tx = tx.Where("api_keys.name LIKE ? OR api_keys.prefix LIKE ? OR users.username LIKE ? OR users.display_name LIKE ?", like, like, like, like)
	}
	if group := strings.TrimSpace(q.Group); group != "" {
		tx = tx.Where("api_keys.calling_group = ?", group)
	}
	switch strings.TrimSpace(q.Status) {
	case "active":
		tx = tx.Where("api_keys.active = ?", true)
	case "disabled":
		tx = tx.Where("api_keys.active = ?", false)
	}
	var total int64
	if err := tx.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	items := []model.AdminAPIKey{}
	err = tx.Select("api_keys.id AS id, api_keys.user_id AS user_id, users.username AS username, COALESCE(NULLIF(users.display_name, ''), users.username) AS user_display_name, api_keys.name AS name, api_keys.prefix AS prefix, api_keys.calling_group AS calling_group, api_keys.active AS active, api_keys.expires_at AS expires_at, api_keys.created_at AS created_at, api_keys.last_used_at AS last_used_at").
		Order("api_keys.created_at desc, api_keys.id desc").Offset(q.Offset()).Limit(q.PageSize).Scan(&items).Error
	return items, total, err
}

// GetAdminAPIKey 后台按 ID 查询单条 API Key（联表带用户名，不含哈希）。
func GetAdminAPIKey(id string) (model.AdminAPIKey, bool, error) {
	db, err := DB()
	if err != nil {
		return model.AdminAPIKey{}, false, err
	}
	var item model.AdminAPIKey
	err = db.Table("api_keys").Joins("LEFT JOIN users ON users.id = api_keys.user_id").
		Select("api_keys.id AS id, api_keys.user_id AS user_id, users.username AS username, COALESCE(NULLIF(users.display_name, ''), users.username) AS user_display_name, api_keys.name AS name, api_keys.prefix AS prefix, api_keys.calling_group AS calling_group, api_keys.active AS active, api_keys.expires_at AS expires_at, api_keys.created_at AS created_at, api_keys.last_used_at AS last_used_at").
		Where("api_keys.id = ?", id).Limit(1).Scan(&item).Error
	if err != nil {
		return model.AdminAPIKey{}, false, err
	}
	if item.ID == "" {
		return model.AdminAPIKey{}, false, nil
	}
	return item, true, nil
}

// GetAPIKeyByID 后台按 ID 查询 API Key（含哈希，仅供内部修改/鉴权使用）。
func GetAPIKeyByID(id string) (model.APIKey, bool, error) {
	db, err := DB()
	if err != nil {
		return model.APIKey{}, false, err
	}
	var key model.APIKey
	err = db.Where("id = ?", id).First(&key).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return model.APIKey{}, false, nil
	}
	return key, err == nil, err
}

// UpdateAdminAPIKey 后台按字段更新 API Key。
func UpdateAdminAPIKey(id string, updates map[string]any) error {
	db, err := DB()
	if err != nil {
		return err
	}
	return db.Model(&model.APIKey{}).Where("id = ?", id).Updates(updates).Error
}

// DeleteAPIKey 物理删除 API Key。
func DeleteAPIKey(id string) error {
	db, err := DB()
	if err != nil {
		return err
	}
	return db.Delete(&model.APIKey{}, "id = ?", id).Error
}
