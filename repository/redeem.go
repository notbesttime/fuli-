package repository

import (
	"errors"
	"strings"

	"github.com/tigerowo/infinite-canvas/model"
	"gorm.io/gorm"
)

var errRedeemUserUnavailable = errors.New("redeem user unavailable")

func CreateRedeemCodes(items []model.RedeemCode) error {
	db, err := DB()
	if err != nil {
		return err
	}
	return db.Transaction(func(tx *gorm.DB) error { return tx.CreateInBatches(&items, 100).Error })
}

func ListRedeemCodes(q model.Query, cutoff string) ([]model.RedeemCode, int64, error) {
	db, err := DB()
	if err != nil {
		return nil, 0, err
	}
	q.Normalize()
	tx := db.Model(&model.RedeemCode{}).Joins("LEFT JOIN users ON users.id = redeem_codes.used_by")
	if keyword := strings.TrimSpace(q.Keyword); keyword != "" {
		like := "%" + keyword + "%"
		tx = tx.Where("redeem_codes.code LIKE ? OR redeem_codes.batch LIKE ? OR redeem_codes.remark LIKE ? OR users.username LIKE ? OR users.display_name LIKE ?", like, like, like, like, like)
	}
	switch model.RedeemCodeStatus(q.Type) {
	case model.RedeemCodeExpired:
		tx = tx.Where("redeem_codes.status = ? OR (redeem_codes.status = ? AND redeem_codes.expires_at <> '' AND redeem_codes.expires_at <= ?)", model.RedeemCodeExpired, model.RedeemCodeUnused, cutoff)
	case model.RedeemCodeUnused:
		tx = tx.Where("redeem_codes.status = ? AND (redeem_codes.expires_at = '' OR redeem_codes.expires_at > ?)", model.RedeemCodeUnused, cutoff)
	case model.RedeemCodeUsed, model.RedeemCodeVoid:
		tx = tx.Where("redeem_codes.status = ?", q.Type)
	}
	var total int64
	if err := tx.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	items := []model.RedeemCode{}
	err = tx.Select("redeem_codes.*, COALESCE(NULLIF(users.display_name, ''), users.username, '') AS user_display_name").Order("redeem_codes.created_at DESC, redeem_codes.id DESC").Offset(q.Offset()).Limit(q.PageSize).Find(&items).Error
	return items, total, err
}

func VoidRedeemCode(id, cutoff string) (bool, error) {
	db, err := DB()
	if err != nil {
		return false, err
	}
	result := db.Model(&model.RedeemCode{}).Where("id = ? AND status = ? AND (expires_at = '' OR expires_at > ?)", id, model.RedeemCodeUnused, cutoff).Update("status", model.RedeemCodeVoid)
	return result.RowsAffected == 1, result.Error
}

// RedeemCode 原子认领在先，余额和流水任一步失败均回滚；并发请求只有一次可认领。
func RedeemCode(code, userID, timestamp string, log model.CreditLog) (model.RedeemCode, model.User, bool, error) {
	db, err := DB()
	if err != nil {
		return model.RedeemCode{}, model.User{}, false, err
	}
	var item model.RedeemCode
	var user model.User
	claimed := false
	err = db.Transaction(func(tx *gorm.DB) error {
		claim := tx.Model(&model.RedeemCode{}).Where("code = ? AND status = ? AND (expires_at = '' OR expires_at > ?)", code, model.RedeemCodeUnused, timestamp).Updates(map[string]any{"status": model.RedeemCodeUsed, "used_by": userID, "used_at": timestamp})
		if claim.Error != nil || claim.RowsAffected == 0 {
			return claim.Error
		}
		if err := tx.Where("code = ?", code).First(&item).Error; err != nil {
			return err
		}
		update := tx.Model(&model.User{}).Where("id = ? AND status <> ? AND role IN ? AND credits <= ?", userID, model.UserStatusBan, []model.UserRole{model.UserRoleUser, model.UserRoleAdmin}, 1e12-item.Credits).Updates(map[string]any{
			"credits": gorm.Expr("ROUND(credits + CAST(? AS DECIMAL(20,4)), 4)", item.Credits), "updated_at": timestamp,
		})
		if update.Error != nil {
			return update.Error
		}
		if update.RowsAffected != 1 {
			return errRedeemUserUnavailable
		}
		if err := tx.Where("id = ?", userID).First(&user).Error; err != nil {
			return err
		}
		log.Amount, log.Balance, log.RelatedID = item.Credits, user.Credits, item.ID
		if err := tx.Create(&log).Error; err != nil {
			return err
		}
		claimed = true
		return nil
	})
	return item, user, claimed && err == nil, err
}

func ListUserRedeemCodes(userID string, q model.Query) ([]model.RedeemCode, int64, error) {
	db, err := DB()
	if err != nil {
		return nil, 0, err
	}
	q.Normalize()
	tx := db.Model(&model.RedeemCode{}).Where("used_by = ? AND status = ?", userID, model.RedeemCodeUsed)
	var total int64
	if err := tx.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	items := []model.RedeemCode{}
	err = tx.Order("used_at DESC, id DESC").Offset(q.Offset()).Limit(q.PageSize).Find(&items).Error
	return items, total, err
}
