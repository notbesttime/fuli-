package repository

import (
	"github.com/tigerowo/infinite-canvas/model"
	"gorm.io/gorm/clause"
)

// GetChannelHealth 读取单个渠道熔断记录。
func GetChannelHealth(id string) (model.ChannelHealth, bool, error) {
	db, err := DB()
	if err != nil {
		return model.ChannelHealth{}, false, err
	}
	var item model.ChannelHealth
	result := db.Where("id = ?", id).Limit(1).Find(&item)
	if result.Error != nil {
		return model.ChannelHealth{}, false, result.Error
	}
	return item, result.RowsAffected > 0, nil
}

// ListChannelHealth 返回全部渠道熔断记录。
func ListChannelHealth() ([]model.ChannelHealth, error) {
	db, err := DB()
	if err != nil {
		return nil, err
	}
	items := []model.ChannelHealth{}
	if err := db.Find(&items).Error; err != nil {
		return nil, err
	}
	return items, nil
}

// SaveChannelHealth 保存渠道熔断记录。
func SaveChannelHealth(item model.ChannelHealth) error {
	db, err := DB()
	if err != nil {
		return err
	}
	return db.Clauses(clause.OnConflict{
		Columns:   []clause.Column{{Name: "id"}},
		DoUpdates: clause.AssignmentColumns([]string{"status", "reason", "upstream_error", "failures", "circuit_count", "cooldown_until", "last_failed_at", "updated_at"}),
	}).Create(&item).Error
}

// DeleteChannelHealth 删除渠道熔断记录，等同于恢复健康。
func DeleteChannelHealth(id string) error {
	db, err := DB()
	if err != nil {
		return err
	}
	return db.Where("id = ?", id).Delete(&model.ChannelHealth{}).Error
}
