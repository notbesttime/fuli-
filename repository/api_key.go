package repository

import (
	"errors"

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
