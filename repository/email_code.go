package repository

import (
	"errors"
	"time"

	"github.com/tigerowo/infinite-canvas/model"
	"gorm.io/gorm"
)

// SaveEmailCode 写入验证码，并顺带清理全局已过期记录。
func SaveEmailCode(code model.EmailCode) error {
	db, err := DB()
	if err != nil {
		return err
	}
	if err := db.Where("expires_at < ?", time.Now().Unix()).Delete(&model.EmailCode{}).Error; err != nil {
		return err
	}
	return db.Create(&code).Error
}

// LatestEmailCode 返回该邮箱该用途最新一条未消费的验证码。
func LatestEmailCode(email, purpose string) (model.EmailCode, bool, error) {
	db, err := DB()
	if err != nil {
		return model.EmailCode{}, false, err
	}
	var code model.EmailCode
	err = db.Where("email = ? AND purpose = ? AND consumed_at = 0", email, purpose).Order("created_at desc").First(&code).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return model.EmailCode{}, false, nil
	}
	if err != nil {
		return model.EmailCode{}, false, err
	}
	return code, true, nil
}

// CountEmailCodesSince 统计邮箱在给定 Unix 秒之后的验证码次数。
func CountEmailCodesSince(email string, since int64) (int64, error) {
	db, err := DB()
	if err != nil {
		return 0, err
	}
	var count int64
	err = db.Model(&model.EmailCode{}).Where("email = ? AND created_at > ?", email, since).Count(&count).Error
	return count, err
}

// UpdateEmailCode 更新验证码的尝试次数与消费状态。
func UpdateEmailCode(code model.EmailCode) error {
	db, err := DB()
	if err != nil {
		return err
	}
	return db.Save(&code).Error
}
